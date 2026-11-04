# Servicio de folios de SEGULA Travel (Google Apps Script)

Web app que entrega los folios `STRA-VJ-<año>-<consecutivo de 6 dígitos>` de la página `/segula-travel`. Un bloqueo (`LockService`) asegura que dos personas que piden folio al mismo tiempo nunca reciban el mismo número. La página lo pide al pasar el modal de acceso y lo muestra desde ese momento; el PDF lleva ese mismo número. Cada folio queda registrado en la hoja **Folios**.

## Qué guarda

- **Consecutivo:** en las *Propiedades del script*, una clave por año (`seq-2026`, `seq-2027`…). Cada año arranca en `000001`.
- **Registro:** una fila por folio en la hoja `Folios` con las columnas **Folio**, **Reservado** (hora en que se reservó al entrar a la página), **Correo** y **Descargado** (hora de la primera descarga del PDF). La hoja se crea sola con su encabezado la primera vez.
- **Reservas abandonadas:** una fila con **Descargado** vacío es un folio que se reservó pero cuyo PDF nunca se descargó (la persona cerró la página). Es un salto explicado del consecutivo, no un número perdido.
- **Números saltados:** si el registro falla después de avanzar el consecutivo, ese número se salta. Nunca se entrega dos veces.

Borrar filas de la hoja **no** reinicia ni reutiliza números. Para corregir el consecutivo, edita `seq-<año>` en las Propiedades del script.

## Despliegue

1. **Crear la hoja.** Crea una hoja de Google Sheets con una cuenta del área (no personal), por ejemplo "SEGULA Travel · Folios".
2. **Pegar el código.** En la hoja abre **Extensiones → Apps Script** y pega el contenido de `Code.gs`.
3. **Zona horaria.** En **Configuración del proyecto**, pon la zona horaria `America/Mexico_City`; de ella sale el año del folio. Otra opción es copiar `appsscript.json`, activando "Mostrar el archivo de manifiesto".
4. **Desplegar.** Ve a **Implementar → Nueva implementación → Aplicación web** y usa:
   - *Ejecutar como:* **Yo**.
   - *Quién tiene acceso:* **Cualquier usuario**. La página llama sin sesión de Google.
5. **Copiar la URL.** Copia la URL que termina en `/exec` y ponla en el sitio como `PUBLIC_TRAVEL_FOLIO_URL` (en `.env` o en las variables del build), y vuelve a publicar el sitio.

Si cambias `Code.gs`, crea una **nueva versión** de la misma implementación (**Implementar → Administrar implementaciones → Editar**); así la URL no cambia. El script nunca sobreescribe datos de la hoja: si la pestaña `Folios` está vacía le pone el encabezado; si la fila 1 ya tiene un folio (pestaña creada a mano sin encabezado) inserta el encabezado arriba; si tiene el encabezado de la primera versión (Folio, Emitido, Correo) solo renombra "Emitido" a "Reservado" y agrega "Descargado"; cualquier otro contenido de la fila 1 se deja como está.

**Orden al actualizar:** publica primero el `Code.gs` nuevo y después la página. Un `Code.gs` anterior no conoce la acción "downloaded" y la trataría como una reserva; la página lo detecta y no lo reintenta, pero ese intento ya habría gastado un número.

## Contrato

`POST` con cuerpo JSON enviado como `text/plain`, porque Apps Script no responde el *preflight* de CORS. Hay dos acciones.

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

## Límites

- **Correo:** la validación solo revisa que el dominio sea `@segulagrp.com`. **No autentica** a la persona, y cualquiera con la URL puede pedir folios con un correo inventado del dominio. Si eso importa, el siguiente paso es Google Identity Services con verificación del token de Google en este script.
- **Espera del bloqueo:** si el bloqueo no se libera en 10 s, la respuesta es `busy` y la página pide intentar de nuevo.
