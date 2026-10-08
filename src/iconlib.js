// The full Tabler icon library (filled + outline, ~5,000 icons) for the icon picker.
// The curated icons the app ships with live in assets/icons.js. Everything else is loaded from the
// jsDelivr CDN only when somebody searches (the list) or when an icon that is not bundled is shown (its picture).
// Outline icons are stored in the database as "outline--name" (the database only allows a-z, 0-9 and "-").
const VERSION = '3.49.0';
const BASE = `https://cdn.jsdelivr.net/npm/@tabler/icons@${VERSION}`;

export const OUTLINE = 'outline--';
export const isOutline = (name) => name.startsWith(OUTLINE);
export const iconUrl = (name) => (isOutline(name) ? `${BASE}/icons/outline/${name.slice(OUTLINE.length)}.svg` : `${BASE}/icons/filled/${name}.svg`);

let catalog = null, loading = null;
export function loadCatalog() {
  if (catalog) return Promise.resolve(catalog);
  if (!loading) {
    loading = fetch(`${BASE}/icons.json`).then((r) => { if (!r.ok) throw new Error('catalog'); return r.json(); }).then((j) => {
      catalog = Object.values(j).map((x) => ({
        name: x.name, filled: !!(x.styles && x.styles.filled), outline: !!(x.styles && x.styles.outline),
        text: (x.name.replace(/-/g, ' ') + ' ' + (x.tags || []).join(' ') + ' ' + (x.category || '')).toLowerCase(),
      }));
      return catalog;
    }).catch((e) => { loading = null; throw e; });
  }
  return loading;
}

// Search by name, tags and category (all words must match). Names that start with the search come first.
export function searchIcons(list, query, style) {
  const words = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const x of list) {
    if (!x[style]) continue;
    if (!words.every((w) => x.text.includes(w))) continue;
    const rank = x.name === words[0] ? 0 : x.name.startsWith(words[0]) ? 1 : x.name.includes(words[0]) ? 2 : 3;
    out.push([rank, x.name]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || a[1].localeCompare(b[1])).map((x) => (style === 'outline' ? OUTLINE : '') + x[1]);
}
