# Servicio de folios de SEGULA Travel (Google Apps Script)

Web app que entrega los folios `STRA-VJ-<año>-<consecutivo de 6 dígitos>` de la página `/segula-travel`. Un bloqueo (`LockService`) asegura que dos personas que descargan al mismo tiempo nunca reciban el mismo número. Cada folio queda registrado en la hoja **Folios**.

## Qué guarda

- **Consecutivo:** en las *Propiedades del script*, una clave por año (`seq-2026`, `seq-2027`…). Cada año arranca en `000001`.
- **Registro:** una fila por folio en la hoja `Folios` (Folio, Emitido, Correo). La hoja se crea sola con su encabezado la primera vez.
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

Si cambias `Code.gs`, crea una **nueva versión** de la misma implementación (**Implementar → Administrar implementaciones → Editar**); así la URL no cambia.

## Contrato

`POST` con cuerpo JSON enviado como `text/plain`, porque Apps Script no responde el *preflight* de CORS:

```json
{ "email": "nombre.apellido@segulagrp.com" }
```

Respuestas:

- `{ "ok": true, "folio": "STRA-VJ-2026-000001" }`
- `{ "ok": false, "error": "invalid_email" | "busy" | "bad_request" | "server_error" }`

## Límites

- **Correo:** la validación solo revisa que el dominio sea `@segulagrp.com`. **No autentica** a la persona, y cualquiera con la URL puede pedir folios con un correo inventado del dominio. Si eso importa, el siguiente paso es Google Identity Services con verificación del token de Google en este script.
- **Espera del bloqueo:** si el bloqueo no se libera en 10 s, la respuesta es `busy` y la página pide intentar de nuevo.
