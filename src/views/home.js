import { html } from '../../assets/vendor/htm-preact.js';
import { useStore } from '../store.js';
import { t, currentLocale } from '../i18n.js';
import { Icon, RoleChip } from '../ui.js';
import { ROLES } from '../config.js';

const TILES = [
  { route: 'calendar', icon: 'calendar-event', color: '#6D4AFF', title: 'nav.calendar', sub: 'tile.calendar' },
  { route: 'chat', icon: 'messages', color: '#F2655B', title: 'nav.chat', sub: 'tile.chat' },
  { route: 'shifts', icon: 'clock', color: '#FFC83D', title: 'nav.shifts', sub: 'tile.shifts', dark: true },
  { route: 'people', icon: 'id', color: '#3F8CFF', title: 'nav.people', sub: 'tile.people', only: 'supervisor' },
];

export function HomeView() {
  const s = useStore();
  const me = s.profile;
  const now = new Date();
  const loc = currentLocale();
  const weekday = now.toLocaleDateString(loc, { weekday: 'long' });
  const dayMonth = now.toLocaleDateString(loc, { day: 'numeric', month: 'long' });
  const tiles = TILES.filter((x) => !x.only || x.only === me.role);

  return html`<div class="stack">
    <section class="hero">
      <span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span>
      <p class="hero-kicker">${t('home.today')}</p>
      <h2 class="hero-title">${weekday}</h2>
      <p class="hero-date">${dayMonth}</p>
      <${RoleChip} role=${me.role} />
    </section>

    <section>
      <h3 class="section-title">${t('home.quick')}</h3>
      <div class="tiles">
        ${tiles.map((x) => html`<div class="tile-wrap" key=${x.route}>
          <a class=${'tile' + (x.dark ? ' dark' : '')} href=${'#/' + x.route} style=${`--c:${x.color}`}>
            <span class="tile-icon"><${Icon} name=${x.icon} size=${26} /></span>
            <span class="tile-title">${t(x.title)}</span>
            <span class="tile-sub">${t(x.sub)}</span>
            ${x.route !== 'people' && html`<span class="tile-soon">${t('soon.badge')}</span>`}
          </a>
          <span class="tile-go" style=${`--c:${x.color}`}><${Icon} name="caret-right" size=${16} /></span>
        </div>`)}
      </div>
    </section>

    <section>
      <h3 class="section-title">${t('home.tasks')}</h3>
      <div class="empty-card">
        <span class="empty-icon"><${Icon} name="clipboard-check" size=${30} /></span>
        <p>${t('home.tasksEmpty')}</p>
      </div>
    </section>
  </div>`;
}
