# Servicio de folios de SEGULA Travel (Google Apps Script)

Web app que entrega los folios `STRA-VJ-<año>-<consecutivo de 6 dígitos>` de la página `/segula-travel`. Un bloqueo (`LockService`) asegura que dos personas que piden folio al mismo tiempo nunca reciban el mismo número. La página lo pide al pasar el modal de acceso y lo muestra desde ese momento; el PDF lleva ese mismo número. Cada folio queda registrado en la hoja **Folios**.

## Qué guarda

- **Consecutivo:** en las *Propiedades del script*, una clave por año (`seq-2026`, `seq-2027`…). Cada año arranca en `000001`.
- **Registro:** una fila por folio en la hoja `Folios` con las columnas **Folio**, **Reservado** (hora en que se reservó al entrar a la página), **Correo**, **Descargado** (hora de la primera descarga del PDF) y **Archivo** (link a la copia interna del PDF en Drive). La hoja se crea sola con su encabezado la primera vez.
- **Copia interna en Drive:** al descargar, la página manda el PDF al script, que lo guarda como `<folio>.pdf` en la carpeta configurada en `DRIVE_FOLDER_ID` y pone el link en **Archivo**. Es solo para control interno: la página no le muestra nada de esto a quien hace la solicitud, ni si la copia falla. El archivo hereda los permisos de la carpeta y nunca se comparte por link. Se guarda una sola copia por folio, la primera.
- **Reservas abandonadas:** una fila con **Descargado** vacío es un folio que se reservó pero cuyo PDF nunca se descargó (la persona cerró la página). Es un salto explicado del consecutivo, no un número perdido.
- **Números saltados:** si el registro falla después de avanzar el consecutivo, ese número se salta. Nunca se entrega dos veces.

Borrar filas de la hoja **no** reinicia ni reutiliza números. Para corregir el consecutivo, edita `seq-<año>` en las Propiedades del script.

## Despliegue

1. **Crear la hoja.** Crea una hoja de Google Sheets con una cuenta del área (no personal), por ejemplo "SEGULA Travel · Folios".
2. **Pegar el código.** En la hoja abre **Extensiones → Apps Script** y pega el contenido de `Code.gs`.
3. **Carpeta de Drive.** Crea una carpeta en el Drive de la misma cuenta, sin compartir con quienes hacen solicitudes, y copia su ID: la parte final de su URL (`https://drive.google.com/drive/folders/<ID>`). En **Configuración del proyecto → Propiedades del script** agrega `DRIVE_FOLDER_ID` con ese ID. Sin esta propiedad el script no guarda copias y la columna **Archivo** queda vacía; folios y descargas funcionan igual.
4. **Zona horaria.** En **Configuración del proyecto**, pon la zona horaria `America/Mexico_City`; de ella sale el año del folio. Otra opción es copiar `appsscript.json`, activando "Mostrar el archivo de manifiesto".
5. **Desplegar.** Ve a **Implementar → Nueva implementación → Aplicación web** y usa:
   - *Ejecutar como:* **Yo**.
   - *Quién tiene acceso:* **Cualquier usuario**. La página llama sin sesión de Google.
   Antes de desplegar, copia `appsscript.json` al proyecto (⚙ **Configuración del proyecto → Mostrar el archivo de manifiesto "appsscript.json" en el editor**, y reemplaza su contenido): declara los permisos `spreadsheets.currentonly` y `drive`. Sin eso, si el proyecto ya tenía permisos fijados, Google no pide Drive y `checkSetup` falla con "You do not have permission to call DriveApp.getFolderById". Luego, en el editor elige la función `checkSetup` y pulsa **Ejecutar**: Google pide autorizar Drive (necesario para las copias) y el registro muestra `Carpeta OK: "<nombre>"`, o qué falta (la propiedad o el acceso a la carpeta). Sin esa autorización las reservas y el registro de descargas funcionan, pero cada copia falla con un error de permisos.
6. **Copiar la URL.** Copia la URL que termina en `/exec` y ponla en el sitio como `PUBLIC_TRAVEL_FOLIO_URL` (en `.env` o en las variables del build), y vuelve a publicar el sitio.

Si cambias `Code.gs`, crea una **nueva versión** de la misma implementación (**Implementar → Administrar implementaciones → Editar**); así la URL no cambia. Si la versión nueva usa un permiso nuevo (la copia en Drive lo usa), autorízalo ejecutando `checkSetup` desde el editor; Google no lo pide por su cuenta al crear la versión. El script nunca sobreescribe datos de la hoja: si la pestaña `Folios` está vacía le pone el encabezado; si la fila 1 ya tiene un folio (pestaña creada a mano sin encabezado) inserta el encabezado arriba; si tiene un encabezado anterior (Folio, Emitido, Correo; o sin "Archivo") solo renombra "Emitido" a "Reservado" y agrega "Descargado" y "Archivo" si faltan; cualquier otro contenido de la fila 1 se deja como está.

**Orden al actualizar:** publica primero el `Code.gs` nuevo y después la página. Un `Code.gs` de la primera versión no conoce las acciones "downloaded" ni "archive" y las trataría como una reserva; la página lo detecta y no lo reintenta, pero ese intento ya habría gastado un número. Un `Code.gs` que ya conoce "downloaded" rechaza "archive" con `bad_request` sin gastar números.

## Contrato

`POST` con cuerpo JSON enviado como `text/plain`, porque Apps Script no responde el *preflight* de CORS. Hay tres acciones.

**Reservar** (la página lo llama al pasar el modal de acceso; sin `action` también reserva):

```json
{ "action": "reserve", "email": "nombre.apellido@segulagrp.com" }
```

- `{ "ok": true, "folio": "STRA-VJ-2026-000001" }`
- `{ "ok": false, "error": "invalid_email" | "busy" | "bad_request" | "server_error" }`

**Marcar descarga** (la página lo llama después de descargar el PDF):

```json
{ "action": "downloaded", "email": "nombre.apellido@segulagrp.com", "folio": "STRA-VJ-2026-000001" }
```

- `{ "ok": true }`: se llenó **Descargado**, o ya estaba lleno; se conserva la primera hora.
- `{ "ok": false, "error": "not_found" }`: el folio no existe o lo reservó otro correo; no se escribe nada.
- `{ "ok": false, "error": "invalid_email" | "bad_request" | "server_error" }`

Si esta llamada falla, la descarga ya ocurrió: la página avisa y guarda el pendiente en el navegador (`localStorage`, `segula.travel.unmarked`); lo reintenta en la siguiente descarga y la próxima vez que esa persona entre a la página, aunque haya pulsado "Nueva solicitud" o recargado. Si el servidor lo rechaza (`not_found`), se descarta.

**Guardar copia interna** (la página lo llama junto con "Marcar descarga", con el PDF en base64):

```json
{ "action": "archive", "email": "nombre.apellido@segulagrp.com", "folio": "STRA-VJ-2026-000001", "pdf": "JVBERi0xLjcK..." }
```

- `{ "ok": true }`: el PDF quedó en la carpeta y su link en **Archivo**, o ese folio ya tenía copia; se conserva la primera.
- `{ "ok": false, "error": "not_found" }`: el folio no existe o lo reservó otro correo; no se guarda nada.
- `{ "ok": false, "error": "bad_request" }`: folio mal formado, falta el PDF, base64 inválido o el contenido no es un PDF.
- `{ "ok": false, "error": "too_large" }`: el PDF pasa de 20 MB.
- `{ "ok": false, "error": "not_configured" }`: falta `DRIVE_FOLDER_ID`.
- `{ "ok": false, "error": "invalid_email" | "busy" | "server_error" }`

La página no reintenta ni avisa si la copia falla: la descarga y su registro siguen igual y **Archivo** queda vacío. La causa queda en el panel **Ejecuciones** del Apps Script, como un error `archive <folio>: …` (por ejemplo, falta de permiso de Drive o de `DRIVE_FOLDER_ID`). El PDF no cabe en `localStorage`, por eso no hay cola de reintentos para la copia.

## Límites

- **Correo:** la validación solo revisa que el dominio sea `@segulagrp.com`. **No autentica** a la persona, y cualquiera con la URL puede pedir folios con un correo inventado del dominio. Si eso importa, el siguiente paso es Google Identity Services con verificación del token de Google en este script.
- **Espera del bloqueo:** si el bloqueo no se libera en 10 s, la respuesta es `busy` y la página pide intentar de nuevo.
- **Tamaño de la copia:** Google no documenta un límite para el cuerpo de un `doPost`. La página no manda PDFs de más de 20 MB (unos 27 MB en base64) y el script los rechaza; esos folios quedan sin copia. La subida se hace durante el paso "Registrando descarga…", con un máximo de 45 s.
- **Copias no deseadas:** como la URL es pública y el correo no se autentica, alguien que reserve un folio con un correo inventado del dominio puede subir un PDF por folio a la carpeta. Cada intento gasta un folio y queda en la hoja con ese correo.
- **Visibilidad:** la página no muestra la copia, pero la llamada se ve en las herramientas de desarrollador del navegador y el código de la página es público.
