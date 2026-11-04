// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  integrations: [preact()],
  vite: {
    optimizeDeps: {
      // pdf-lib is only reached through a dynamic import (SEGULA Travel), so the
      // dev scanner misses it and the first click gets a 504 "Outdated Optimize Dep".
      include: ['pdf-lib'],
    },
  },
});
