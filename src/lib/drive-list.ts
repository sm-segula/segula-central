// Drive folders listed by the Apps Script web app for the site build
// (actions sabias_list and comunicados_list, same shared key as the login).

export interface DriveFile {
  id: string;
  name: string;
  mime?: string;
  created?: string;
}

export type DriveListAction = 'sabias_list' | 'comunicados_list';

/** POST the action to the Apps Script web app. Throws on any failure so the caller can fall back. */
export async function fetchDriveList(
  url: string,
  key: string,
  action: DriveListAction,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20000,
): Promise<DriveFile[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, key }),
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${action}: HTTP ${res.status}`);
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; files?: unknown } | null;
    if (!body || body.ok !== true || !Array.isArray(body.files)) throw new Error(`${action}: ${body?.error ?? 'unexpected response'}`);
    return body.files as DriveFile[];
  } finally {
    clearTimeout(timer);
  }
}
