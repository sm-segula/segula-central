// Shows what the next build would read from Heyzine, without printing the key.
// PowerShell:  $env:HEYZINE_API_KEY="..."; npm run gazzette:check
import { fetchFlipbooks, parseTitle } from '../src/lib/gazzette/editions.ts';

const key = process.env.HEYZINE_API_KEY;
if (!key) {
  console.error('Falta HEYZINE_API_KEY en el entorno.');
  process.exit(1);
}

try {
  const list = await fetchFlipbooks(key);
  console.log(`Heyzine devolvió ${list.length} flipbooks.\n`);
  for (const f of list) {
    const p = parseTitle(String(f.title ?? ''));
    const mark = p ? `Gazzette ${p.month} ${p.year}` : 'se ignora (el título no es "Gazzette <Mes> <Año>")';
    console.log(`- ${f.id}  "${f.title ?? ''}"  ${f.date ?? ''}  →  ${mark}`);
  }
} catch (err) {
  console.error(`No se pudo leer Heyzine: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
