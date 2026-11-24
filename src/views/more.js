import { html } from '../../assets/vendor/htm-preact.js';
import { t } from '../i18n.js';
import { Icon, Sheet } from '../ui.js';
import { colorVars } from '../color.js';

const META = {
  calendar: { icon: 'calendar-event', color: '#FFDD94', label: 'nav.calendar' },
  tasks: { icon: 'list-check', color: '#CCABD8', label: 'nav.tasks' },
  chat: { icon: 'messages', color: '#86E3CE', label: 'nav.chat' },
  team: { icon: 'id', color: '#FFDD94', label: 'nav.team' },
  meetings: { icon: 'calendar-month', color: '#86E3CE', label: 'nav.meetings' },
  weekly: { icon: 'clipboard-check', color: '#D0E6A5', label: 'nav.weekly' },
  shifts: { icon: 'clock', color: '#FA897B', label: 'nav.shifts' },
  logbook: { icon: 'book', color: '#D0E6A5', label: 'nav.logbook' },
  reports: { icon: 'clipboard-data', color: '#CCABD8', label: 'nav.reports' },
};

// Soft tinted card + round icon bubble per screen (not colorStyle: that would also set --ink)
const tint = (r) => { const v = colorVars(META[r].color); return `--c:${v.c};--soft:${v.soft}`; };

// The "other screens" of the app, tucked away so the home screen stays calm
export function MoreLinks({ routes }) {
  return html`<nav class="more-links" aria-label=${t('more.title')}>
    <div class="more-grid static">${routes.map((r) => html`<a key=${r} class="more-link" style=${tint(r)} href=${'#/' + r}><span class="more-ic"><${Icon} name=${META[r].icon} size=${22} /></span>${t(META[r].label)}</a>`)}</div>
  </nav>`;
}

// The burger tab in the bottom menu: a sheet with the other screens
export function MenuSheet({ routes, onClose }) {
  return html`<${Sheet} title=${t('nav.menu')} onClose=${onClose}>
    <div class="menu-grid">${routes.map((r) => html`<a key=${r} class="more-link" style=${tint(r)} href=${'#/' + r} onClick=${onClose}><span class="more-ic"><${Icon} name=${META[r].icon} size=${24} /></span>${t(META[r].label)}</a>`)}</div>
  <//>`;
}
