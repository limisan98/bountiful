import { html, useState, useEffect, useLayoutEffect, useRef } from '../assets/vendor/htm-preact.js';
import { t } from './i18n.js';
import { Icon } from './ui.js';
import { parseYmd, ymd, addMonths, addDays, monthGrid, weekdayNames, todayYmd, fmt, pad } from './time.js';

// Date and time pickers drawn by the app (the browser's own ones can't be styled).
// The date field shows no year; the year appears in the calendar that opens when you tap the field.

function Popover({ anchor, onClose, width = 320, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const w = Math.min(width, innerWidth - 24);

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect(), h = ref.current.offsetHeight;
    const left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), innerWidth - w - 12);
    let top = r.bottom + 8;
    if (top + h > innerHeight - 12) top = Math.max(12, r.top - 8 - h);
    setPos({ left, top });
  }, []);

  useEffect(() => {
    // Escape closes just the picker (not the panel behind it); scrolling or resizing closes it too
    const key = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); onClose(); } };
    const away = (e) => { if (!ref.current || !ref.current.contains(e.target)) onClose(); };
    addEventListener('keydown', key, true);
    addEventListener('scroll', away, true);
    addEventListener('resize', onClose);
    return () => { removeEventListener('keydown', key, true); removeEventListener('scroll', away, true); removeEventListener('resize', onClose); };
  }, []);

  return html`<div class="pop-layer" onPointerDown=${onClose}></div>
    <div class="picker-pop pop" role="dialog" ref=${ref} onPointerDown=${(e) => e.stopPropagation()} onClick=${(e) => { e.stopPropagation(); e.preventDefault(); }}
      style=${`width:${w}px;` + (pos ? `left:${pos.left}px;top:${pos.top}px` : 'visibility:hidden;left:0;top:0')}>${children}</div>`;
}

// ---- Date ----
export function DateField({ value, onChange, label }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const d = parseYmd(value);
  return html`<span class="picker">
    <button type="button" ref=${btn} class="input picker-btn" aria-haspopup="dialog" aria-expanded=${open} aria-label=${label}
      onClick=${() => setOpen(true)}>
      <span>${fmt(d, { weekday: 'short', day: 'numeric', month: 'long' })}</span><${Icon} name="calendar-event" size=${20} />
    </button>
    ${open ? html`<${Popover} anchor=${btn.current} onClose=${() => setOpen(false)}>
      <${MonthPick} value=${value} onPick=${(v) => { onChange(v); setOpen(false); }} /><//>` : null}
  </span>`;
}

function MonthPick({ value, onPick }) {
  const sel = parseYmd(value);
  const [cursor, setCursor] = useState(new Date(sel.getFullYear(), sel.getMonth(), 1));
  const [dir, setDir] = useState('');
  const go = (n) => { setDir(n > 0 ? 'from-right' : 'from-left'); setCursor(addMonths(cursor, n)); };
  const days = monthGrid(cursor);
  const rows = days[35].getMonth() === cursor.getMonth() ? 6 : 5;
  const today = todayYmd();
  const monthName = (d) => fmt(d, { month: 'long' });

  return html`<div class="cpick">
    <div class="cpick-head">
      <button type="button" class="icon-btn small" aria-label=${monthName(addMonths(cursor, -1))} onClick=${() => go(-1)}><${Icon} name="caret-left" size=${18} /></button>
      <b class="cpick-title" key=${ymd(cursor)}>${fmt(cursor, { month: 'long', year: 'numeric' })}</b>
      <button type="button" class="icon-btn small" aria-label=${monthName(addMonths(cursor, 1))} onClick=${() => go(1)}><${Icon} name="caret-right" size=${18} /></button>
    </div>
    <div class="cpick-week">${weekdayNames('narrow').map((n, i) => html`<span key=${i}>${n}</span>`)}</div>
    <div class=${'cpick-grid ' + dir} key=${ymd(cursor)}>
      ${days.slice(0, rows * 7).map((d) => {
        const k = ymd(d), out = d.getMonth() !== cursor.getMonth();
        return html`<button type="button" key=${k} class=${'cpick-day' + (k === value ? ' on' : '') + (k === today ? ' today' : '') + (out ? ' out' : '')}
          onClick=${() => onPick(k)}>${d.getDate()}</button>`;
      })}
    </div>
    <button type="button" class="btn soft small" onClick=${() => onPick(today)}>${t('chat.today')}</button>
  </div>`;
}

// ---- Time: the phone's own time wheel (a plain, familiar picker), drawn like the other fields ----
export function TimeField({ value, onChange, label }) {
  return html`<span class="picker">
    <input type="time" class="input time-input" step="300" aria-label=${label} value=${(value || '').slice(0, 5)}
      onInput=${(e) => { if (e.target.value) onChange(e.target.value); }} onChange=${(e) => { if (e.target.value) onChange(e.target.value); }} />
  </span>`;
}
