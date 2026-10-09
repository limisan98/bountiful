import { html } from '../../assets/vendor/htm-preact.js';
import { t } from '../i18n.js';
import { Icon, Sheet } from '../ui.js';

const META = {
  calendar: { icon: 'calendar-event', label: 'nav.calendar' },
  tasks: { icon: 'list-check', label: 'nav.tasks' },
  chat: { icon: 'messages', label: 'nav.chat' },
  team: { icon: 'id', label: 'nav.team' },
  meetings: { icon: 'calendar-month', label: 'nav.meetings' },
  shifts: { icon: 'clock', label: 'nav.shifts' },
  logbook: { icon: 'book', label: 'nav.logbook' },
  reports: { icon: 'clipboard-data', label: 'nav.reports' },
};

// The "other screens" of the app, tucked away so the home screen stays calm
export function MoreLinks({ routes }) {
  return html`<details class="more-links">
    <summary><${Icon} name="dots" size=${22} />${t('more.title')}</summary>
    <div class="more-grid">${routes.map((r) => html`<a key=${r} class="more-link" href=${'#/' + r}><${Icon} name=${META[r].icon} size=${22} />${t(META[r].label)}</a>`)}</div>
  </details>`;
}

// The burger tab in the bottom menu: a sheet with the other screens
export function MenuSheet({ routes, onClose }) {
  return html`<${Sheet} title=${t('nav.menu')} onClose=${onClose}>
    <div class="menu-grid">${routes.map((r) => html`<a key=${r} class="more-link" href=${'#/' + r} onClick=${onClose}><${Icon} name=${META[r].icon} size=${24} />${t(META[r].label)}</a>`)}</div>
  <//>`;
}
