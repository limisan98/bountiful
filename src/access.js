// "Larger text and buttons" for people who find the normal size small. Remembered on this phone.
const KEY = 'bountiful.bigText';
export const bigTextOn = () => { try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; } };
export function setBigText(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) { /* ignore */ }
  document.documentElement.classList.toggle('big-text', !!on);
}
export const initAccess = () => document.documentElement.classList.toggle('big-text', bigTextOn());
