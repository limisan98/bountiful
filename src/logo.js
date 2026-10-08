import { html } from '../assets/vendor/htm-preact.js';

// The Bountiful logo (assets/logo/logo.svg is the supplied artwork, only with rounded corners).
export function LogoMark({ size = 64 }) {
  return html`<img class="logo-mark" src="assets/logo/logo.svg" width=${size} height=${size} alt="" draggable="false" style=${`--s:${size}px`} />`;
}
