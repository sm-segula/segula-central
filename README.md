# SEGULA Central

Intranet de SEGULA Technologies México. Sitio estático construido con **Astro 5** (output `static`), **TypeScript** estricto, **Lenis** para smooth scroll, **Lucide** para iconos y **Preact** únicamente en las islas con estado (hero canvas, slider, buscadores).

La fuente de verdad visual es el handoff de diseño en `../design_handoff_segula_central/` (`README.md` + `reference/*.dc.html`). Este proyecto lo replica pixel-perfect usando los tokens del design system como variables CSS.

## Requisitos

- Node 22.16 o superior (el proyecto está fijado a Astro 5 porque Astro 7 exige Node 22.22+).
- npm 10.

```sh
npm install
npm run dev        # http://localhost:4321
npm run build      # genera dist/
npm run preview    # sirve dist/
npx astro check    # type-check de .astro/.ts/.tsx
```

## Estructura

```text
src/
├── assets/            Fotos optimizadas por <Image> (sharp): viajes, politicas, ayuda, kindle, it
├── components/        Chrome y patrones del DS (Header, Footer, PageHero, Card, Panel, NewsBlock, StepBlock, RuleCard, PlayButton, Button, GradientRule, ImagePlaceholder, SectionHead, Splash)
├── data/              nav.ts (menú y rutas) + JSON de contenido (comunicados, directorio, sabias-que)
├── islands/           Islas Preact: HeroCanvas, Slider, SearchList, DirectorySearch, TravelRequest (+ travel/)
├── layouts/Base.astro Documento HTML, fuentes, Header/Footer y arranque de scripts
├── pages/             Una ruta por archivo (ver mapa en src/data/nav.ts)
├── scripts/           reveal.ts (IntersectionObserver), lenis.ts (smooth scroll), header.ts (menús, hide-on-scroll)
└── styles/            global.css + tokens/*.css del design system
public/assets/         Logos (header, footer, splash)
apps-script/           Servicios de Google Apps Script (travel-folio: folios de SEGULA Travel)
```

## Reemplazar placeholders por imágenes reales

Todas las zonas `<image-slot>` del prototipo se renderizan con `ImagePlaceholder` (`src/components/ImagePlaceholder.astro`). Sin `src` pinta una caja `--surface-panel` con el texto del placeholder; con `src` pinta la imagen con `object-fit: cover`, manteniendo el tamaño y el radio que define el contenedor.

Hay dos formas de pasar la imagen:

1. **Asset optimizado (recomendado).** Copia el archivo a `src/assets/` e impórtalo. Astro genera versiones comprimidas con `sharp` y añade `width`/`height` para evitar CLS.

   ```astro
   ---
   import ImagePlaceholder from '../components/ImagePlaceholder.astro';
   import captura from '../assets/vacaciones-gn3.png';
   ---
   <ImagePlaceholder src={captura} alt="Acceso a GN3" width={1380} height={720} />
   ```

   `width`/`height` son el tamaño de salida (usa el doble del tamaño renderizado para pantallas 2x).

2. **Ruta pública.** Copia el archivo a `public/assets/` y pasa la ruta como string. No se optimiza.

   ```astro
   <ImagePlaceholder src="/assets/vacaciones-gn3.png" alt="Acceso a GN3" />
   ```

Los componentes que envuelven un placeholder (`Card`, `NewsBlock`, `StepBlock`, `RuleCard`) exponen la misma prop `src` (y `alt`) y la pasan hacia adentro:

```astro
<Card title="Onboarding" href="https://…" src={onboarding} imageHeight={300} titleSize="lg" />
<StepBlock number="01" title="Accede a GN3." src={gn3} imageSide="left" />
```

Mientras no exista la imagen, deja `placeholder="Texto del prototipo"` tal cual.

## Añadir una página al menú

El menú y el mapa de rutas viven en `src/data/nav.ts`:

```ts
export const NAV = [
  { label: "Home", href: "/" },
  { label: "Recursos Humanos", children: ["Vacaciones e incidencias", "…"] },
  // …
];

export const ROUTES: Record<string, string> = {
  "Vacaciones e incidencias": "/recursos-humanos/vacaciones-e-incidencias",
  // …
};
```

Pasos:

1. Crea la página en `src/pages/<seccion>/<slug>.astro` usando `Base` y `PageHero`.
2. Añade la etiqueta exacta al array `children` de la sección correspondiente en `NAV` (el orden del array es el orden del menú).
3. Añade la entrada `"Etiqueta": "/ruta"` en `ROUTES`. Si la etiqueta no está en `ROUTES`, el menú la pinta con `href="#"` (así están hoy "Gazzette" y "Política de Calidad").
4. Para enlazar desde otras páginas usa `ROUTES['Etiqueta']` en lugar de escribir la ruta a mano.

El Header (megamenú de escritorio y acordeón móvil) se genera a partir de `NAV`, no hay que tocar markup.

## SEGULA Travel (solicitud de viajes)

La ruta `/segula-travel` (entrada "SEGULA Travel" del menú) es el formulario de solicitud de viaje y autorización. Replica el prototipo `Solicitud de Viajes.dc.html` del proyecto de Claude Design "Aplicación de solicitud de viajes".

- **Isla.** `src/islands/TravelRequest.tsx` pinta la vista. El estado y las acciones viven en `src/islands/travel/useTravelRequest.ts`; campos, validación y totales en `model.ts`; los primitivos del DS (Input, Button, Modal, Dropzone…) en `ui.tsx`; los estilos `tr-*` en `travel.css`, importado desde la página.
- **PDF.** `src/islands/travel/pdf.ts` genera el documento con `pdf-lib`. Se carga con `import()` solo al pulsar "Vista previa" o "Descargar PDF", así que no pesa en la carga inicial. Los adjuntos PDF se fusionan, las imágenes PNG/JPG se agregan como página y el resto de formatos solo se listan. Usa las fuentes estándar del PDF (Helvetica/Courier) porque la licencia web de Proxima Nova y Rakesly no está confirmada.
- **Logo del PDF.** `public/assets/segula-logo-classic-darkblue.png`, derivado del logo blanco. Reemplázalo por el oficial cuando esté disponible.
- **Acceso.** Al entrar se abre un modal que pide el correo corporativo y no se puede cerrar. Si el correo no es del dominio corporativo solo dice "Correo incorrecto.", sin pistas. El correo aceptado llena el campo "Correo SEGULA", que queda de solo lectura; para cambiarlo hay que salir y volver a entrar. "Recordar correo" lo guarda en `localStorage` (`segula.travel.email`). Ojo: esto valida el dominio, **no autentica** a la persona (cualquiera puede escribir un correo inventado del dominio).
- **Folio.** Formato `STRA-VJ-<año>-<consecutivo de 6 dígitos>`. Se reserva al pasar el modal de acceso y se muestra desde ese momento; el PDF siempre lleva ese mismo número, nunca cambia. Si alguien sale sin descargar, ese número queda sin usar (hay saltos, nunca repetidos). "Nueva solicitud" reutiliza el folio si todavía no se descargó; si ya se descargó, reserva uno nuevo. La lógica vive en `createFolioReserver` (`src/islands/travel/folio.ts`). Al descargar, la página marca la columna **Descargado** de la hoja, así las reservas abandonadas se distinguen de los folios con PDF. Mientras espera al Apps Script o genera el PDF, un loader muestra el paso ("Asignando folio…", "Generando vista previa…", "Generando PDF…", "Registrando descarga…"). Si el registro de la descarga falla, queda pendiente en el navegador (`segula.travel.unmarked`) y se reintenta en la siguiente descarga o visita. En el mismo paso la página manda el PDF al Apps Script, que guarda una copia interna en una carpeta de Drive y pone su link en la columna **Archivo**; es control interno, la página no lo menciona y una copia fallida no se reintenta ni se avisa. Al terminar la descarga, un modal muestra el folio emitido con la leyenda "Archivo descargado exitosamente"; al cerrarlo (botón, X, Esc o clic fuera) la página vuelve al inicio del sitio, para no reservar otro folio sin querer. Lo emite el Apps Script de `apps-script/travel-folio/` (consecutivo único entre usuarios, con bloqueo y registro en una hoja de Google Sheets); la guía de despliegue está en su `README.md`. La URL del web app va en la variable `PUBLIC_TRAVEL_FOLIO_URL` (archivo `.env` o variables del build). Sin esa variable, por ejemplo en desarrollo local, se usa el contador del navegador (`segula.viajes.seq`), que **no** es único entre usuarios.
- **Moneda, prefijo y servicio de folios.** Se pasan como props en `src/pages/segula-travel.astro` (`currency="MXN"`, `folioPrefix="STRA-VJ"`, `folioEndpoint`).

## Inicio de sesión (OTP por correo)

Todo el sitio está protegido: sin sesión, cualquier página redirige a `/login` y cualquier otra petición responde 401. Solo se aceptan correos `@segulagrp.com`; el código de 6 dígitos se envía por correo desde el Apps Script (sin base de datos) y la sesión es una cookie firmada (`sc_session`, 7 días).

- **Dónde vive.** `middleware.ts` (Vercel Routing Middleware, corre antes de los archivos estáticos) es solo un adaptador; la lógica está en `src/lib/auth/` y se prueba con `node --experimental-strip-types --test "tests/auth/*.test.ts"`. La página es `src/pages/login.astro` con la isla `src/islands/LoginForm.tsx`. Endpoints: `POST /auth/request`, `POST /auth/verify`, `POST /auth/logout`, `GET /auth/me`, `GET /auth/ticket`.
- **Públicos.** Solo `/login`, `/auth/*`, `/favicon.svg`, el logo del login, y los `.css`/`.js` de `/_astro/` y las fuentes `.woff`/`.woff2`. Las imágenes de contenido (incluidas `/_astro/*.webp` y `/assets/directorio/*`) requieren sesión.
- **Variables en Vercel** (Production y Preview):
  - `SESSION_SECRET`: firma la cookie de sesión. Solo Vercel.
  - `AUTH_SHARED_SECRET`: autentica las llamadas del middleware al Apps Script y firma los tickets de SEGULA Travel. Debe ser el mismo valor en la propiedad de script `AUTH_SHARED_SECRET` del Apps Script.
  - `PUBLIC_TRAVEL_FOLIO_URL`: URL `/exec` del Apps Script (el middleware la lee de `process.env`).
  - Generar cada secreto: `openssl rand -base64 48` o `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`. Si falta alguno el sitio falla cerrado: nada se abre y `/auth/*` responde `not_configured`.
- **Local.** `astro dev` **no** ejecuta el middleware, así que en local el sitio está sin protección y `/login` no puede iniciar sesión. Para probar el flujo completo hay que usar un Preview de Vercel.
- **Limitación (sin base de datos).** Una cookie robada no se puede revocar antes de que expire (7 días). La única forma de invalidar todas las sesiones es rotar `SESSION_SECRET`.

## Convenciones

- **Nada de Tailwind.** Estilos con `<style>` scoped de Astro y siempre `var(--token)`.
- **Reveals.** Añade `data-reveal` y, si aplica, `data-reveal-delay="90"` a cualquier elemento; el estado inicial y la transición están en `global.css`, `reveal.ts` los activa una sola vez. Con `prefers-reduced-motion` todo se muestra sin animar.
- **Clases desde la página.** Los componentes aceptan `class` y hacen spread del resto de props en su raíz, por lo que `.doc { grid-column: span 4 }` definido en la página sí alcanza a `<Card class="doc" />`.
- **Enlaces externos.** `Button` con `href` http(s) añade `target="_blank" rel="noopener"` automáticamente.
- **Iconos.** Importa cada icono por su ruta: `import ArrowRight from 'lucide-astro/ArrowRight'`. Nunca desde el barrel `'lucide-astro'`: carga 1883 módulos en cada petición del dev server y cada página tarda ~3 s.
- **Islas.** Solo Preact y solo donde hay estado. Todo lo demás es HTML estático más scripts vanilla en `src/scripts/`.
- **Textos.** Español de México, "SEGULA" siempre en mayúsculas, sin emoji. El copy se copia literal del prototipo.

## Breakpoints

| Nombre   | Regla                 |
| -------- | --------------------- |
| Desktop  | ≥ 1025 px             |
| Tablet   | ≤ 1024 px             |
| Móvil    | ≤ 640 px              |
