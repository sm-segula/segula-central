// Reproduces how Vercel ships the middleware: every .ts file is transpiled on
// its own to .js (no bundling), keeping the import specifiers as written. The
// Preview failed with "Cannot find module '/var/task/src/lib/auth/handler.ts'
// imported from /var/task/middleware.js", so this loads the transpiled
// middleware.js from a scratch directory and expects it to import cleanly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '../..');
const FILES = ['middleware.ts', ...fs.readdirSync(path.join(ROOT, 'src/lib/auth')).filter((f) => f.endsWith('.ts')).map((f) => `src/lib/auth/${f}`)];

test('the middleware loads after per-file transpilation, as on Vercel', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-load-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
    for (const rel of FILES) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const out = ts.transpileModule(src, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      const dest = path.join(dir, rel.replace(/\.ts$/, '.js'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, out);
    }
    const mod = await import(pathToFileURL(path.join(dir, 'middleware.js')).href);
    assert.equal(typeof mod.default, 'function');
    assert.deepEqual(mod.config, { runtime: 'nodejs' });
  } finally {
    fs.rmSync(path.join(dir, 'node_modules'), { force: true, recursive: false });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
