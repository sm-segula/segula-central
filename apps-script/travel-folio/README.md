# Servicio de SEGULA Central (Google Apps Script)

Web app que hace dos cosas para el sitio, siempre ejecutándose como la cuenta **segula-central@segula.mx** (todos los correos salen de ahí, con el nombre "SEGULA Central"):

- **Acceso con código (OTP):** envía por correo un código de 6 dígitos a direcciones `@segulagrp.com` y lo verifica.
- **Folios y PDF de SEGULA Travel:** entrega los folios `STRA-VJ-<año>-<consecutivo de 6 dígitos>` de la página `/segula-travel` y envía el PDF por correo a quien lo solicitó. Un bloqueo (`LockService`) asegura que dos personas que piden folio al mismo tiempo nunca reciban el mismo número. Cada folio queda registrado en la hoja **Folios**.

Sin la propiedad `AUTH_SHARED_SECRET` el script rechaza toda acción con `not_configured`.

## Qué guarda

- **Códigos de acceso:** solo un hash (HMAC) del código, en `CacheService` del script, 10 minutos; nunca el código ni el correo en claro. Máximo **5 intentos fallidos por correo** (sumando todos sus códigos): al 5.º ese correo queda **bloqueado 24 horas**, tanto para pedir códigos como para validarlos. El bloqueo se guarda en las Propiedades del script como `fail-<hash del correo>` (nunca el correo) y se borra solo al vencer; un inicio de sesión correcto reinicia la cuenta. Además, 60 s entre códigos por correo y como máximo 8 códigos por correo cada 6 horas. Un código correcto se consume.
- **Consecutivo:** en las *Propiedades del script*, una clave por año (`seq-2026`, `seq-2027`…). Cada año arranca en `000001`.
- **Registro:** una fila por folio en la hoja `Folios` con las columnas **Folio**, **Reservado** (hora en que se reservó al entrar a la página), **Correo** (el del ticket firmado, nunca uno escrito a mano), **Descargado** (hora del primer envío del PDF por correo; se conserva el nombre de la columna para no cambiar el formato de la hoja) y **Archivo** (link a la copia interna del PDF en Drive). La hoja se crea sola con su encabezado la primera vez.
- **Copia interna en Drive:** al enviar el PDF, el script lo guarda como `<folio>.pdf` en la carpeta configurada en `DRIVE_FOLDER_ID` y pone el link en **Archivo**. Es solo para control interno: la página no le muestra nada de esto a quien hace la solicitud, ni si la copia falla (la causa queda en **Ejecuciones**). El archivo hereda los permisos de la carpeta y nunca se comparte por link. Se guarda una sola copia por folio, la primera.
- **Reservas abandonadas:** una fila con **Descargado** vacío es un folio que se reservó pero cuyo PDF nunca se envió. Es un salto explicado del consecutivo, no un número perdido.
- **Números saltados:** si el registro falla después de avanzar el consecutivo, ese número se salta. Nunca se entrega dos veces.

Borrar filas de la hoja **no** reinicia ni reutiliza números. Para corregir el consecutivo, edita `seq-<año>` en las Propiedades del script.

## Despliegue (primera vez)

1. **Crear la hoja.** Crea una hoja de Google Sheets con la cuenta **segula-central@segula.mx**, por ejemplo "SEGULA Travel · Folios".
2. **Pegar el código.** En la hoja abre **Extensiones → Apps Script** y pega el contenido de `Code.gs`.
3. **Manifiesto.** En **Configuración del proyecto** activa "Mostrar el archivo de manifiesto `appsscript.json` en el editor" y reemplaza su contenido con el de `appsscript.json`: declara los permisos `spreadsheets.currentonly`, `drive` y `script.send_mail`. Sin eso, si el proyecto ya tenía permisos fijados, Google no pide Drive ni el envío de correo.
4. **Propiedades del script** (**Configuración del proyecto → Propiedades del script**):
   - `AUTH_SHARED_SECRET`: una cadena larga y aleatoria. Es **el mismo valor** que la variable `AUTH_SHARED_SECRET` de Vercel. Con ella el sitio autentica sus llamadas y firma los tickets de SEGULA Travel.
   - `DRIVE_FOLDER_ID`: el ID de la carpeta "Viajes" (la parte final de `https://drive.google.com/drive/folders/<ID>`), sin compartir con quienes hacen solicitudes. Sin esta propiedad el script no guarda copias y **Archivo** queda vacío; folios y correos funcionan igual.
5. **Zona horaria.** `America/Mexico_City` (de ella sale el año del folio); ya viene en `appsscript.json`.
6. **Autorizar.** En el editor elige la función `checkSetup` y pulsa **Ejecutar**: Google pide autorizar Drive y el envío de correo. El registro muestra `AUTH_SHARED_SECRET OK`, `Carpeta OK: "<nombre>"` y la cuota diaria de correo restante (`MailApp.getRemainingDailyQuota()`).
7. **Desplegar.** **Implementar → Nueva implementación → Aplicación web**:
   - *Ejecutar como:* **Yo** (segula-central@segula.mx).
   - *Quién tiene acceso:* **Cualquier usuario**. El sitio llama sin sesión de Google; la autenticación es la clave `AUTH_SHARED_SECRET` y los tickets firmados.
8. **Copiar la URL** que termina en `/exec` y ponla en Vercel como `PUBLIC_TRAVEL_FOLIO_URL`; vuelve a desplegar el sitio.

Si cambias `Code.gs`, crea una **nueva versión** de la misma implementación (**Implementar → Administrar implementaciones → Editar**); así la URL no cambia. Si la versión usa un permiso nuevo, autorízalo ejecutando `checkSetup` desde el editor. El script nunca sobreescribe datos de la hoja: si la pestaña `Folios` está vacía le pone el encabezado; si la fila 1 ya tiene un folio inserta el encabezado arriba; si tiene un encabezado anterior solo renombra "Emitido" a "Reservado" y agrega "Descargado" y "Archivo" si faltan; cualquier otro contenido de la fila 1 se deja como está.

## Migración a segula-central@segula.mx

Si el servicio ya corría con otra cuenta (por ejemplo software.manager), el script debe pasar a ejecutarse como **segula-central@segula.mx** para que los correos salgan de ahí.

1. **Hoja y carpeta.** Con la cuenta actual, transfiere la propiedad de la hoja "Folios" y de la carpeta de Drive "Viajes" a segula-central@segula.mx (**Compartir → ese usuario → Propietario**). Si no se puede transferir (dominios distintos), compártelas con esa cuenta como **Editor**.
2. **Mismo proyecto de script.** Abre desde segula-central@segula.mx **el mismo proyecto vinculado a la hoja** (**Extensiones → Apps Script**), no uno nuevo. Así se conservan las Propiedades del script (`seq-<año>`, `DRIVE_FOLDER_ID`).
   > **Advertencia:** un proyecto nuevo no tiene `seq-<año>`: el consecutivo reiniciaría en `000001` y **duplicaría folios ya entregados**. Si por fuerza usas un proyecto nuevo, antes copia el valor de `seq-<año>` al nuevo proyecto.
3. **Secreto.** Agrega la propiedad `AUTH_SHARED_SECRET` (el mismo valor que en Vercel).
4. **Código.** Pega `Code.gs` y `appsscript.json` actualizados.
5. **Autorizar.** Ejecuta `checkSetup` y autoriza Drive y el envío de correo con segula-central@segula.mx.
6. **Nueva implementación.** **Implementar → Nueva implementación → Aplicación web**, *Ejecutar como:* **Yo (segula-central@segula.mx)**, *Quién tiene acceso:* **Cualquier usuario**.
7. **URL.** Pon la nueva URL `/exec` en Vercel como `PUBLIC_TRAVEL_FOLIO_URL` y vuelve a desplegar.
8. **Archivar la implementación vieja.** Cuando el sitio nuevo ya esté publicado en producción, entra en **Implementar → Administrar implementaciones** y **archiva** la implementación anterior (la de la otra cuenta). Hasta que la archives, su URL `/exec` sigue respondiendo con el código viejo, que reserva folios con cualquier correo tipeado y sin ticket. No la archives antes de publicar el sitio nuevo, porque el sitio actual la sigue usando.

Notas:

- **Cuota de correo:** Google Workspace permite aproximadamente 1,500 destinatarios por día con `MailApp`. Revisa `MailApp.getRemainingDailyQuota()` en `checkSetup`.
- **Entrega:** los correos salen de segula.mx hacia segulagrp.com. Prueba el código de acceso y el PDF, y revisa la carpeta de spam; si caen ahí, pide a TI permitir el remitente.
- **Orden al actualizar:** publica primero el `Code.gs` nuevo y después el sitio. Las acciones antiguas `downloaded` y `archive` ya no existen: responden `bad_request` sin gastar números.

## Contrato

`POST` con cuerpo JSON enviado como `text/plain`, porque Apps Script no responde el *preflight* de CORS. Toda respuesta es JSON `{ "ok": true, … }` o `{ "ok": false, "error": "<código>" }`. Sin `AUTH_SHARED_SECRET` configurada, cualquier acción responde `not_configured`. Una acción desconocida, retirada o ausente responde `bad_request` (nunca reserva).

### Acceso (lo llama el middleware del sitio con `key`)

`key` debe ser igual a `AUTH_SHARED_SECRET` (si no: `unauthorized`). El correo se normaliza (sin espacios, en minúsculas) y debe cumplir `^[a-z0-9._%+-]+@segulagrp\.com$` (si no: `invalid_email`).

**Pedir código:**

```json
{ "action": "otp_request", "key": "<AUTH_SHARED_SECRET>", "email": "nombre.apellido@segulagrp.com" }
```

- `{ "ok": true }`: se envió el código (vence en 10 minutos).
- `{ "ok": false, "error": "unauthorized" | "invalid_email" | "cooldown" | "busy" | "server_error" }`. `cooldown`: ya se envió un código hace menos de 60 s, o ese correo ya pidió 8 códigos en las últimas 6 horas. `server_error`: falló el envío; el código se descarta.

**Verificar código:**

```json
{ "action": "otp_verify", "key": "<AUTH_SHARED_SECRET>", "email": "nombre.apellido@segulagrp.com", "code": "123456" }
```

- `{ "ok": true }`: código correcto; se consume.
- `{ "ok": false, "error": "unauthorized" | "invalid_email" | "invalid_code" | "expired" | "too_many_attempts" | "busy" | "server_error" }`. `expired`: no hay código pendiente. El 5.º intento fallido del correo (sumando todos sus códigos) responde `too_many_attempts` y bloquea ese correo 24 horas; mientras dure, `otp_request` y `otp_verify` responden `too_many_attempts`. Validar sin código pendiente responde `expired` y no cuenta como intento.

### SEGULA Travel (lo llama el navegador con `ticket`)

`ticket` es `<p>.<s>`: `p` = base64url del JSON `{ "email", "exp" }` (`exp` en segundos Unix) y `s` = base64url de HMAC-SHA256(`AUTH_SHARED_SECRET`, `p`), ambos **sin** relleno `=`. El correo sale **solo** del ticket verificado; cualquier `email` en el cuerpo se ignora. Ticket ausente, falso, vencido o de otro dominio: `unauthorized`.

**Reservar:**

```json
{ "action": "reserve", "ticket": "<ticket>" }
```

- `{ "ok": true, "folio": "STRA-VJ-2026-000001" }`
- `{ "ok": false, "error": "unauthorized" | "busy" | "server_error" }`

**Enviar el PDF por correo:**

```json
{ "action": "deliver", "ticket": "<ticket>", "folio": "STRA-VJ-2026-000001", "pdf": "JVBERi0xLjcK..." }
```

- `{ "ok": true }`: el PDF salió por correo al correo del ticket. Se llenó **Descargado** (se conserva la primera hora) y se intentó la copia interna en Drive (si falla, solo queda en **Ejecuciones** como `archive <folio>: …`; no cambia la respuesta).
- `{ "ok": false, "error": "not_found" }`: el folio no existe o lo reservó otro correo; no se envía nada.
- `{ "ok": false, "error": "bad_request" }`: folio mal formado, falta el PDF, base64 inválido o el contenido no es un PDF.
- `{ "ok": false, "error": "too_large" }`: el PDF pasa de 20 MB.
- `{ "ok": false, "error": "unauthorized" | "busy" | "server_error" }`. `server_error`: falló el envío; **Descargado** no se llena y la persona puede reintentar.

## Límites

- **Autenticación:** el correo ya no se acepta "a ciegas": el acceso exige el código enviado a la dirección y los folios exigen un ticket firmado por el middleware. Quien tenga la URL `/exec` pero no `AUTH_SHARED_SECRET` no puede pedir códigos, reservar ni enviar. Rotar `AUTH_SHARED_SECRET` (aquí y en Vercel) invalida todos los tickets.
- **Espera del bloqueo:** si el bloqueo no se libera en 10 s, la respuesta es `busy` y se pide intentar de nuevo.
- **Tamaño del PDF:** Google no documenta un límite para el cuerpo de un `doPost`. El script rechaza PDFs de más de 20 MB (unos 27 MB en base64) y el correo lleva el PDF adjunto.
- **Cuota:** `MailApp` tiene una cuota diaria; si se agota, los envíos responden `server_error`.
- **Código de acceso:** `CacheService` es una caché y puede descartar entradas antes del vencimiento; en ese caso la persona pide un código nuevo.
