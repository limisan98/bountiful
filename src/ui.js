import { html, useEffect, useState, useRef, createContext, useContext } from '../assets/vendor/htm-preact.js';
import { ICONS } from '../assets/icons.js';
import { FLAGS } from '../assets/flags.js';
import { PALETTE } from './config.js';
import { roleInfo } from './roles.js';
import { colorStyle } from './color.js';
import { t, LANGS, setLang } from './i18n.js';
import { useStore } from './store.js';

// ---- Icon: draws one of the Tabler "filled" icons by name ----
export function Icon({ name, size = 24, class: cls = '' }) {
  const inner = ICONS[name] || ICONS['circle-check'];
  return html`<svg class=${'ic ' + cls} width=${size} height=${size} viewBox="0 0 24 24"
    fill="currentColor" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: inner }}></svg>`;
}

// ---- Avatar: profile photo, or initials; the ring has the color of the person's role ----
export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function Avatar({ profile, name, role, url, size = 48, ring = true }) {
  const r = roleInfo(role || (profile && profile.role));
  const photo = url !== undefined ? url : profile && profile.avatar_url;
  const label = name || (profile && profile.display_name) || '';
  return html`<span class=${'avatar' + (ring ? ' ring' : '')} style=${`--s:${size}px;--ring:${r.color};--soft:${r.soft};--ink:${r.ink}`}>
    ${photo ? html`<img src=${photo} alt="" loading="lazy" />` : html`<span class="initials">${initials(label)}</span>`}
  </span>`;
}

// ---- Role pill: icon + the role's name, in the role's color ----
export function RoleChip({ role, small }) {
  const r = roleInfo(role);
  return html`<span class=${'chip role' + (small ? ' small' : '')} style=${`--c:${r.color};--soft:${r.soft};--ink:${r.ink}`}>
    <${Icon} name=${r.icon} size=${small ? 14 : 16} />${r.name}
  </span>`;
}

// ---- A task's colored icon square ----
export function TaskBadge({ icon, color, size = 46 }) {
  return html`<span class="badge" style=${`--s:${size}px;${colorStyle(color)}`}><${Icon} name=${icon} size=${Math.round(size * 0.52)} /></span>`;
}

// ---- Segmented control: a row of pills with a sliding highlight ----
export function Segmented({ options, value, onChange, label }) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  return html`<div class="segmented" role="radiogroup" aria-label=${label || ''} style=${`--n:${options.length};--i:${i}`}>
    <span class="seg-ind"></span>
    ${options.map((o) => html`<button type="button" role="radio" key=${o.value} aria-checked=${value === o.value}
      class=${'seg' + (value === o.value ? ' on' : '')} onClick=${() => onChange(o.value)}>
      ${o.icon && html`<${Icon} name=${o.icon} size=${16} />`}<span>${o.label}</span>
    </button>`)}
  </div>`;
}

// ---- Field: a labelled box ----
export function Field({ label, hint, children }) {
  return html`<label class="field"><span class="field-label">${label}</span>${children}${hint ? html`<span class="field-hint">${hint}</span>` : null}</label>`;
}

export function PasswordInput({ value, onInput, autocomplete = 'current-password', id }) {
  const [show, setShow] = useState(false);
  return html`<span class="pw">
    <input class="input" id=${id} type=${show ? 'text' : 'password'} value=${value} onInput=${onInput}
      autocomplete=${autocomplete} required minlength="6" />
    <button type="button" class="pw-toggle" onClick=${() => setShow(!show)}>${show ? t('auth.hide') : t('auth.show')}</button>
  </span>`;
}

// ---- Sheet: a panel that slides up (a centered window on big screens). Sheets can open on top of each other;
// Escape closes only the top one, and every close slides away smoothly. ----
const stack = [];
const SheetCtx = createContext(() => {});
export const useSheetClose = () => useContext(SheetCtx);
// A component that renders its own Sheet gets a way to close it (with the slide-away) from its own code.
export function useSheetControl() {
  const ref = useRef(null);
  return useRef({ ref, close: () => ref.current && ref.current() }).current;
}

export function Sheet({ title, onClose, children, kicker, control }) {
  const [out, setOut] = useState(false);
  const me = useRef({}).current;
  const closing = useRef(false);
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    setOut(true);
    setTimeout(onClose, 190);
  };
  const latest = useRef(close);
  latest.current = close;
  if (control) control.ref.current = close;
  useEffect(() => {
    stack.push(me);
    const onKey = (e) => { if (e.key === 'Escape' && stack[stack.length - 1] === me) latest.current(); };
    addEventListener('keydown', onKey);
    document.body.classList.add('noscroll');
    return () => {
      stack.splice(stack.indexOf(me), 1);
      removeEventListener('keydown', onKey);
      if (!stack.length) document.body.classList.remove('noscroll');
    };
  }, []);
  return html`<${SheetCtx.Provider} value=${close}>
    <div class=${'sheet-root' + (out ? ' out' : '')} role="dialog" aria-modal="true" aria-label=${title}>
      <div class="scrim" onClick=${close}></div>
      <div class="sheet">
        <div class="sheet-grab"></div>
        <div class="sheet-head">
          <div class="sheet-titles">${kicker ? html`<span class="kicker">${kicker}</span>` : null}<h2>${title}</h2></div>
          <button class="icon-btn" aria-label=${t('common.close')} onClick=${close}><${Icon} name="x" size=${22} /></button>
        </div>
        <div class="sheet-body">${children}</div>
      </div>
    </div>
  <//>`;
}

// ---- Toast ----
export function Toast({ toast }) {
  if (!toast) return null;
  return html`<div class=${'toast ' + (toast.kind || 'ok') + (toast.out ? ' out' : '')} role="status">
    <${Icon} name=${toast.kind === 'bad' ? 'alert-circle' : 'circle-check'} size=${20} />${toast.msg}
  </div>`;
}

// ---- Language menu: a dropdown with small rectangular flags ----
export function Flag({ code }) {
  return html`<span class="flag" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: FLAGS[code] || '' }}></span>`;
}

export function LangMenu({ onPick, align = 'right' }) {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('pointerdown', away); addEventListener('keydown', esc);
    return () => { removeEventListener('pointerdown', away); removeEventListener('keydown', esc); };
  }, [open]);
  const cur = LANGS.find((l) => l.code === s.lang) || LANGS[0];
  const pick = (code) => { setOpen(false); setLang(code); if (onPick) onPick(code); };
  return html`<div class=${'lang-menu ' + align} ref=${box}>
    <button type="button" class=${'lang-btn' + (open ? ' open' : '')} aria-haspopup="listbox" aria-expanded=${open}
      aria-label=${t('profile.language')} onClick=${() => setOpen(!open)}>
      <${Flag} code=${cur.code} /><span class="lang-code">${cur.short}</span><${Icon} name="caret-down" size=${14} class="caret" />
    </button>
    ${open && html`<ul class="lang-list" role="listbox">
      ${LANGS.map((l) => html`<li key=${l.code}><button type="button" role="option" aria-selected=${l.code === cur.code}
        class=${l.code === cur.code ? 'on' : ''} onClick=${() => pick(l.code)}>
        <${Flag} code=${l.code} /><span>${l.name}</span>${l.code === cur.code ? html`<${Icon} name="check" size=${16} class="tick" />` : null}
      </button></li>`)}
    </ul>`}
  </div>`;
}

// ---- Pickers used by the editors ----
export function ColorPicker({ value, onChange }) {
  const list = PALETTE.includes((value || '').toUpperCase()) ? PALETTE : [...PALETTE, value];
  return html`<div class="swatches" role="radiogroup">
    ${list.map((c) => html`<button type="button" key=${c} role="radio" aria-checked=${c.toUpperCase() === (value || '').toUpperCase()}
      class=${'swatch' + (c.toUpperCase() === (value || '').toUpperCase() ? ' on' : '')} style=${`--c:${c}`} aria-label=${c}
      onClick=${() => onChange(c)}><${Icon} name="check" size=${18} /></button>`)}
  </div>`;
}

export function IconPicker({ value, onChange, icons, color }) {
  return html`<div class="icon-grid" role="radiogroup" style=${colorStyle(color)}>
    ${icons.map((n) => html`<button type="button" key=${n} role="radio" aria-checked=${n === value} aria-label=${n}
      class=${'icon-opt' + (n === value ? ' on' : '')} onClick=${() => onChange(n)}><${Icon} name=${n} size=${22} /></button>`)}
  </div>`;
}

// ---- Someone in a list: photo, name, role (and nothing else) ----
export function PersonLine({ profile, size = 44, extra }) {
  if (!profile) return null;
  const r = roleInfo(profile.role);
  return html`<span class="pline">
    <${Avatar} profile=${profile} size=${size} />
    <span class="pline-main"><span class="pline-name">${profile.display_name}</span>
      <span class="pline-role" style=${`--ink:${r.ink}`}><${Icon} name=${r.icon} size=${13} />${r.name}</span></span>
    ${extra || null}
  </span>`;
}

// ---- Empty state / coming soon page ----
export function Empty({ icon = 'clipboard-check', text, children }) {
  return html`<div class="empty-card"><span class="empty-icon"><${Icon} name=${icon} size=${30} /></span><p>${text}</p>${children}</div>`;
}

export function ComingSoon({ icon, title, color }) {
  return html`<div class="soon-page">
    <div class="soon-badge" style=${colorStyle(color)}><${Icon} name=${icon} size=${44} /></div>
    <h2>${title}</h2>
    <p>${t('soon.text')}</p>
    <span class="chip soon-chip">${t('soon.badge')}</span>
  </div>`;
}
