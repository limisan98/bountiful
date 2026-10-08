import { html } from '../assets/vendor/htm-preact.js';
import { ICONS } from '../assets/icons.js';

// PROVISIONAL logo: a white sparkle on a violet rounded square. Replace it with your own design
// by swapping this file and the pictures inside assets/logo/.
export function LogoMark({ size = 64 }) {
  return html`<span class="logo-mark" style=${`--s:${size}px`} aria-hidden="true">
    <svg viewBox="0 0 24 24" width=${size * 0.56} height=${size * 0.56} fill="currentColor"
      dangerouslySetInnerHTML=${{ __html: ICONS['sparkles'] }}></svg>
  </span>`;
}
