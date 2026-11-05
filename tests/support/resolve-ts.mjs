// Test-only: lets Node (with --experimental-strip-types) load `./x.js`
// specifiers from the .ts sources. Production code imports `.js` because
// Vercel transpiles each .ts file to .js on its own, without bundling.
import { register } from 'node:module';

register('./resolve-ts-hooks.mjs', import.meta.url);
