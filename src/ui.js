import { html, useEffect, useState } from '../assets/vendor/htm-preact.js';
import { ICONS } from '../assets/icons.js';
import { ROLES } from './config.js';
import { t } from './i18n.js';

// ---- Icon: draws one of the Tabler "filled" icons by name ----
export function Icon({ name, size = 24, class: cls = '' }) {
  const inner = ICONS[name] || '';
  return html`<svg class=${'ic ' + cls} width=${size} height=${size} viewBox="0 0 24 24"
    fill="currentColor" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: inner }}></svg>`;
}

// ---- Avatar: profile photo, or initials on the role's color ----
export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function Avatar({ profile, name, role, url, size = 48, ring = true }) {
  const r = role || (profile && profile.role);
  const colors = ROLES[r] || { color: '#7B8196', soft: '#ECEDF5', ink: '#4A4F66' };
  const photo = url !== undefined ? url : profile && profile.avatar_url;
  const label = name || (profile && profile.display_name) || '';
  const style = `--s:${size}px;--ring:${colors.color};--soft:${colors.soft};--ink:${colors.ink}`;
  return html`<span class=${'avatar' + (ring ? ' ring' : '')} style=${style}>
    ${photo
      ? html`<img src=${photo} alt="" loading="lazy" />`
      : html`<span class="initials">${initials(label)}</span>`}
  </span>`;
}

// ---- Role pill: "Supervisor" in blue, "Custodian" in yellow, "Reception" in orange ----
export function RoleChip({ role, small }) {
  const c = ROLES[role];
  if (!c) return null;
  return html`<span class=${'chip role' + (small ? ' small' : '')} style=${`--c:${c.color};--soft:${c.soft};--ink:${c.ink}`}>
    <${Icon} name=${c.icon} size=${small ? 14 : 16} />${t('role.' + role)}
  </span>`;
}

// ---- Segmented control: a row of pills where one is selected ----
export function Segmented({ options, value, onChange, label }) {
  return html`<div class="segmented" role="radiogroup" aria-label=${label || ''}>
    ${options.map((o) => html`<button type="button" role="radio" aria-checked=${value === o.value}
      class=${'seg' + (value === o.value ? ' on' : '')}
      style=${o.color ? `--c:${o.color};--soft:${o.soft || ''};--ink:${o.ink || ''}` : ''}
      onClick=${() => onChange(o.value)}>
      ${o.icon && html`<${Icon} name=${o.icon} size=${16} />`}${o.label}
    </button>`)}
  </div>`;
}

// ---- Field: a labelled text box ----
export function Field({ label, hint, children }) {
  return html`<label class="field"><span class="field-label">${label}</span>${children}${hint && html`<span class="field-hint">${hint}</span>`}</label>`;
}

export function PasswordInput({ value, onInput, autocomplete = 'current-password', id }) {
  const [show, setShow] = useState(false);
  return html`<span class="pw">
    <input class="input" id=${id} type=${show ? 'text' : 'password'} value=${value} onInput=${onInput}
      autocomplete=${autocomplete} required minlength="6" />
    <button type="button" class="pw-toggle" onClick=${() => setShow(!show)}>${show ? t('auth.hide') : t('auth.show')}</button>
  </span>`;
}

// ---- Sheet: a panel that slides up from the bottom (a centered window on big screens) ----
export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    document.body.classList.add('noscroll');
    return () => { removeEventListener('keydown', onKey); document.body.classList.remove('noscroll'); };
  }, []);
  return html`<div class="sheet-root" role="dialog" aria-modal="true" aria-label=${title}>
    <div class="scrim" onClick=${onClose}></div>
    <div class="sheet">
      <div class="sheet-grab"></div>
      <div class="sheet-head">
        <h2>${title}</h2>
        <button class="icon-btn" aria-label=${t('common.close')} onClick=${onClose}><${Icon} name="x" size=${22} /></button>
      </div>
      <div class="sheet-body">${children}</div>
    </div>
  </div>`;
}

// ---- Toast: a small message that appears for a moment ----
export function Toast({ toast }) {
  if (!toast) return null;
  return html`<div class=${'toast ' + (toast.kind || 'ok')} role="status">
    <${Icon} name=${toast.kind === 'bad' ? 'alert-circle' : 'circle-check'} size=${20} />${toast.msg}
  </div>`;
}

// ---- Empty / coming soon page ----
export function ComingSoon({ icon, title, color = '#6D4AFF' }) {
  return html`<div class="soon-page">
    <div class="soon-badge" style=${`--c:${color}`}><${Icon} name=${icon} size=${44} /></div>
    <h2>${title}</h2>
    <p>${t('soon.text')}</p>
    <span class="chip soon-chip">${t('soon.badge')}</span>
  </div>`;
}
