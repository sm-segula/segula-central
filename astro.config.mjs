// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  integrations: [preact()],
  image: {
    // ¿Sabías qué? images come from Drive (public by link), optimized at build.
    remotePatterns: [{ protocol: 'https', hostname: 'lh3.googleusercontent.com' }],
  },
  vite: {
    optimizeDeps: {
      // pdf-lib is only reached through a dynamic import (SEGULA Travel), so the
      // dev scanner misses it and the first click gets a 504 "Outdated Optimize Dep".
      include: ['pdf-lib'],
    },
  },
});
