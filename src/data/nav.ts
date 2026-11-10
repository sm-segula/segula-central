export interface NavItem {
  label: string;
  href?: string;
  children?: string[];
  /** Kept (pages and routes stay) but not shown in the menu. */
  hidden?: boolean;
}

export const NAV: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Recursos Humanos", children: ["Vacaciones e incidencias","Políticas y documentos","¿Sabías qué?","Gazzette","Campañas de salud","Comunicados","Videos de capacitación e informativos","Directorio"] },
  { label: "Operaciones", children: ["Política de horas","Manual Ace Project","Shutdown"], hidden: true },
  { label: "Viajes", children: ["Antes de tu viaje","Durante tu viaje","Después de tu viaje"], hidden: true },
  { label: "SEGULA Travel", href: "/segula-travel" },
  { label: "TI", children: ["Campañas","Google Workspace"] },
  { label: "Centro de ayuda", children: ["FAQ's"] },
  { label: "Calidad", children: ["Lessons learned","Política de Calidad"] },
];

/** Items shown in the header menu (desktop and mobile). */
export const MENU: NavItem[] = NAV.filter((item) => !item.hidden);

export const ROUTES: Record<string,string> = {
  "Home":"/", "Vacaciones e incidencias":"/recursos-humanos/vacaciones-e-incidencias", "Políticas y documentos":"/recursos-humanos/politicas-y-documentos", "¿Sabías qué?":"/recursos-humanos/sabias-que", "Campañas de salud":"/recursos-humanos/campanas-de-salud", "Gazzette":"/recursos-humanos/gazzette", "Comunicados":"/recursos-humanos/comunicados", "Videos de capacitación e informativos":"/recursos-humanos/videos", "Directorio":"/recursos-humanos/directorio", "Política de horas":"/operaciones/politica-de-horas", "Manual Ace Project":"/operaciones/manual-ace-project", "Shutdown":"/operaciones/shutdown", "Antes de tu viaje":"/viajes/antes", "Durante tu viaje":"/viajes/durante", "Después de tu viaje":"/viajes/despues", "SEGULA Travel":"/segula-travel", "Campañas":"/ti/campanas", "Google Workspace":"/ti/google-workspace", "Centro de ayuda":"/centro-de-ayuda", "FAQ's":"/centro-de-ayuda/faqs", "Lessons learned":"/calidad/lessons-learned",
};

/** Route for a menu label. Labels without a page yet ("Política de Calidad") resolve to "#". */
export const hrefFor = (label: string): string => ROUTES[label] ?? "#";
