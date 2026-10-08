// Small color helpers. The palette colors are pastel, so text on them stays dark, and
// "role colored" text (like a username in the chat) is darkened until it is easy to read.
const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();

export function mix(hex, other, amount) { // amount = how much of `other`
  const a = toRgb(hex), b = toRgb(other);
  return toHex(a.map((v, i) => v * (1 - amount) + b[i] * amount));
}
function lum(rgb) {
  const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (h1, h2) => {
  const a = lum(toRgb(h1)), b = lum(toRgb(h2));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
function toHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function fromHsl([h, s, l]) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

const cache = new Map();
// { c: the color itself, soft: a light tint of it, ink: the same hue, dark enough to read on the tint }
export function colorVars(hex) {
  const key = (hex || '').toUpperCase();
  if (cache.has(key)) return cache.get(key);
  const base = /^#[0-9A-F]{6}$/.test(key) ? key : '#86E3CE';
  const soft = mix(base, '#FFFFFF', 0.68);
  let [h, s, l] = toHsl(toRgb(base));
  let ink = base;
  for (let i = 0; i < 60 && contrast(ink, soft) < 4.6; i++) { l -= 0.012; ink = toHex(fromHsl([h, s, Math.max(l, 0.05)])); }
  const out = { c: base, soft, ink };
  cache.set(key, out);
  return out;
}
export const colorStyle = (hex) => { const v = colorVars(hex); return `--c:${v.c};--soft:${v.soft};--ink:${v.ink}`; };
