import { useMemo, useState } from 'preact/hooks';

export interface Person {
  name: string;
  role: string;
  phone: string;
  tel: string;
  email: string;
  slot: string;
  initials: string;
}

export interface Team {
  team: string;
  people: Person[];
}

interface Props {
  teams: Team[];
}

/**
 * Directorio: search pill + counter, one section per team with person cards and
 * empty state. Ported from the prototype's renderVals(): accent-insensitive,
 * lowercase `includes` over "name role team email"; teams with no matches are
 * dropped; hrefs are "tel:" + tel and "mailto:" + email. Styles live in the
 * hosting page (`.directorio :global(...)`).
 */
const norm = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const plural = (n: number): string => (n === 1 ? '1 persona' : `${n} personas`);

export default function DirectorySearch({ teams }: Props) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = norm(query.trim());
    return teams
      .map((t) => ({
        team: t.team,
        people: t.people.filter(
          (p) => !q || norm(`${p.name} ${p.role} ${t.team} ${p.email}`).includes(q),
        ),
      }))
      .filter((g) => g.people.length);
  }, [teams, query]);

  const total = groups.reduce((n, g) => n + g.people.length, 0);
  const empty = teams.length > 0 && total === 0;

  return (
    <>
      <section class="dr-search" aria-label="Buscador">
        <div class="dr-toolbar" data-reveal>
          <label class="dr-pill">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.3-4.3"></path>
            </svg>
            <input
              type="search"
              class="dr-input"
              value={query}
              onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
              placeholder="Buscar por nombre, puesto o equipo"
              aria-label="Buscar en el directorio"
            />
          </label>
          <span class="dr-count" aria-live="polite">{plural(total)}</span>
        </div>
      </section>

      {groups.map((g) => (
        <section class="dr-group" key={g.team} aria-label={g.team}>
          <div class="dr-head" data-reveal>
            <h2 class="dr-team">{g.team}</h2>
            <span class="dr-team-count">{plural(g.people.length)}</span>
          </div>
          <div class="dr-grid">
            {g.people.map((p) => (
              <article class="dr-card" key={p.slot} data-reveal>
                <div class="dr-id">
                  <div class="dr-avatar" aria-hidden="true">
                    <span>{p.initials}</span>
                  </div>
                  <div class="dr-meta">
                    <h3 class="dr-name">{p.name}</h3>
                    <span class="dr-role">{p.role}</span>
                  </div>
                </div>
                <div class="dr-links">
                  <a class="dr-link" href={`tel:${p.tel}`}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="dr-icon">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"></path>
                    </svg>
                    <span>{p.phone}</span>
                  </a>
                  <a class="dr-link" href={`mailto:${p.email}`}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="dr-icon">
                      <rect width="20" height="16" x="2" y="4" rx="2"></rect>
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
                    </svg>
                    <span class="dr-email">{p.email}</span>
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      {empty && (
        <section class="dr-empty">
          <p>No encontramos a nadie con ese término.</p>
        </section>
      )}
    </>
  );
}
