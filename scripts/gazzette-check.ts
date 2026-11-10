// Shows what the next build would read from Heyzine, without printing the key.
// PowerShell:  $env:HEYZINE_API_KEY="..."; npm run gazzette:check
import { fetchFlipbooks, mergeEditions } from '../src/lib/gazzette/editions.ts';

const key = process.env.HEYZINE_API_KEY;
if (!key) {
  console.error('Falta HEYZINE_API_KEY en el entorno.');
  process.exit(1);
}

try {
  const list = await fetchFlipbooks(key);
  console.log(`Heyzine devolvió ${list.length} flipbooks.\n`);
  for (const f of list) {
    const [e] = mergeEditions([], [f]);
    const mark = e ? `Gazzette ${e.month} ${e.year}  https://heyzine.com/flip-book/${e.id}.html` : 'se ignora (el título no es "Gazzette <Mes> [Año]")';
    console.log(`- "${f.title ?? ''}"  ${f.date ?? ''}\n    → ${mark}`);
  }
  const all = mergeEditions([], list);
  console.log(all.length ? `\nEdición destacada en el sitio: Gazzette ${all[0]!.month} ${all[0]!.year}` : '\nNinguna edición reconocida.');
} catch (err) {
  console.error(`No se pudo leer Heyzine: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
