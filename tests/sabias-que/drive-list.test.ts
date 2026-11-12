import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchDriveList } from '../../src/lib/drive-list.ts';

test('fetchDriveList posts the action and key as text/plain and returns the files', async () => {
  let seen: { body: unknown; type: string | null } | null = null;
  const files = await fetchDriveList('https://script.example/exec', 'KEY', 'comunicados_list', async (_url, init) => {
    seen = { body: JSON.parse(String(init?.body)), type: new Headers(init?.headers).get('content-type') };
    return new Response('{"ok":true,"files":[{"id":"a","name":"A.pdf"}]}');
  });
  assert.deepEqual(seen, { body: { action: 'comunicados_list', key: 'KEY' }, type: 'text/plain;charset=utf-8' });
  assert.deepEqual(files, [{ id: 'a', name: 'A.pdf' }]);
});

test('fetchDriveList throws with the action name so the build falls back', async () => {
  await assert.rejects(
    fetchDriveList('u', 'K', 'comunicados_list', async () => new Response('{"ok":false,"error":"not_configured"}')),
    /comunicados_list: not_configured/,
  );
  await assert.rejects(fetchDriveList('u', 'K', 'comunicados_list', async () => new Response('x', { status: 500 })), /500/);
});
