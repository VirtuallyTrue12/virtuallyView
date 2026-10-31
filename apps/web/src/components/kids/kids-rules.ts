/** Pages a Kids profile does not see in the menus or can open. The server refuses their data as well. */
export const KIDS_HIDDEN_PAGES = new Set(['/requests', '/downloads', '/settings', '/apps', '/diagnostics', '/statistics', '/themes']);

/** The same menu list with the grown-up pages removed for a Kids profile. */
export function forViewer<T extends { to: string }>(items: readonly T[], kid: boolean | undefined): T[] {
  return kid ? items.filter(item => !KIDS_HIDDEN_PAGES.has(item.to)) : [...items];
}
