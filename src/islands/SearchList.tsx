import { useMemo, useState } from 'preact/hooks';

export interface Comunicado {
  year: string;
  title: string;
  href: string;
}

interface Props {
  items: Comunicado[];
}

/**
 * Comunicados: search pill + counter, groups by year (sticky year column) and
 * empty state. Ported from the prototype's renderVals(): accent-insensitive,
 * lowercase `includes` over the title; years keep the JSON order; the first
 * group's year is lightblue, the rest muted. Styles live in the hosting page
 * (`.comunicados :global(...)`).
 */
const norm = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const plural = (n: number): string => (n === 1 ? '1 comunicado' : `${n} comunicados`);

export default function SearchList({ items }: Props) {
  const [query, setQuery] = useState('');

  const { filtered, groups } = useMemo(() => {
    const q = norm(query.trim());
    const filtered = q ? items.filter((c) => norm(c.title).includes(q)) : items;
    const years = [...new Set(filtered.map((c) => c.year))];
    const groups = years.map((year, i) => ({
      year,
      color: i === 0 ? 'var(--brand-lightblue)' : 'var(--text-muted)',
      items: filtered.filter((c) => c.year === year),
    }));
    return { filtered, groups };
  }, [items, query]);

  const empty = items.length > 0 && filtered.length === 0;

  return (
    <>
      <section class="cm-search" aria-label="Buscador">
        <div class="cm-toolbar" data-reveal>
          <label class="cm-pill">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.3-4.3"></path>
            </svg>
            <input
              type="search"
              class="cm-input"
              value={query}
              onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
              placeholder="Buscar un comunicado"
              aria-label="Buscar un comunicado"
            />
          </label>
          <span class="cm-count" aria-live="polite">{plural(filtered.length)}</span>
        </div>
      </section>

      {groups.map((g) => (
        <section class="cm-group" key={g.year} aria-labelledby={`cm-year-${g.year}`}>
          <div class="cm-year">
            <div class="cm-year-head">
              <h2 id={`cm-year-${g.year}`} class="cm-year-title" style={{ color: g.color }}>{g.year}</h2>
              <span class="cm-year-count">{plural(g.items.length)}</span>
            </div>
            <div class="cm-list">
              {g.items.map((c) => (
                <a class="cm-row" key={c.href} href={c.href} target="_blank" rel="noopener">
                  <span class="cm-row-title">{c.title}</span>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="cm-row-icon">
                    <path d="M7 17 17 7"></path>
                    <path d="M7 7h10v10"></path>
                  </svg>
                </a>
              ))}
            </div>
          </div>
        </section>
      ))}

      {empty && (
        <section class="cm-empty">
          <p>No encontramos comunicados con ese término.</p>
        </section>
      )}
    </>
  );
}
