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
├── islands/           Islas Preact: HeroCanvas, Slider, SearchList, DirectorySearch
├── layouts/Base.astro Documento HTML, fuentes, Header/Footer y arranque de scripts
├── pages/             Una ruta por archivo (ver mapa en src/data/nav.ts)
├── scripts/           reveal.ts (IntersectionObserver), lenis.ts (smooth scroll), header.ts (menús, hide-on-scroll)
└── styles/            global.css + tokens/*.css del design system
public/assets/         Logos (header, footer, splash)
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

## Convenciones

- **Nada de Tailwind.** Estilos con `<style>` scoped de Astro y siempre `var(--token)`.
- **Reveals.** Añade `data-reveal` y, si aplica, `data-reveal-delay="90"` a cualquier elemento; el estado inicial y la transición están en `global.css`, `reveal.ts` los activa una sola vez. Con `prefers-reduced-motion` todo se muestra sin animar.
- **Clases desde la página.** Los componentes aceptan `class` y hacen spread del resto de props en su raíz, por lo que `.doc { grid-column: span 4 }` definido en la página sí alcanza a `<Card class="doc" />`.
- **Enlaces externos.** `Button` con `href` http(s) añade `target="_blank" rel="noopener"` automáticamente.
- **Islas.** Solo Preact y solo donde hay estado. Todo lo demás es HTML estático más scripts vanilla en `src/scripts/`.
- **Textos.** Español de México, "SEGULA" siempre en mayúsculas, sin emoji. El copy se copia literal del prototipo.

## Breakpoints

| Nombre   | Regla                 |
| -------- | --------------------- |
| Desktop  | ≥ 1025 px             |
| Tablet   | ≤ 1024 px             |
| Móvil    | ≤ 640 px              |
