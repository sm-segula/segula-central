import { buildComunicados, mergeComunicados } from '../lib/comunicados';
import type { Comunicado } from '../lib/comunicados';
import { fetchDriveList } from '../lib/drive-list';
import historic from './comunicados.json';

/**
 * Build time: lists the Comunicados Drive folder through the Apps Script
 * (action comunicados_list, same web app and shared key as the login), so a new
 * file appears without a code change. comunicados.json keeps the comunicados
 * published before the folder existed; both lists are merged without repeats.
 * Any failure falls back to comunicados.json alone, so Drive or the script being
 * down never breaks the deploy. The daily rebuild
 * (.github/workflows/gazzette-rebuild.yml) picks up new files.
 */
async function loadComunicados(): Promise<Comunicado[]> {
  const url = import.meta.env.PUBLIC_TRAVEL_FOLIO_URL;
  const key = import.meta.env.AUTH_SHARED_SECRET;
  if (!url || !key) return historic;
  try {
    return mergeComunicados(buildComunicados(await fetchDriveList(url, key, 'comunicados_list')), historic);
  } catch (err) {
    console.warn(`[comunicados] Drive list unavailable, using comunicados.json: ${err instanceof Error ? err.message : err}`);
    return historic;
  }
}

export type { Comunicado };
export const COMUNICADOS: Comunicado[] = await loadComunicados();
