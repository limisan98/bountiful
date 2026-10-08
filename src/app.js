import { enablePush } from './notify.js';
import { html, render, useEffect, useState } from '../assets/vendor/htm-preact.js';
import { sb, api } from './api.js';
import { state, set, useStore } from './store.js';
import { initLang, setLang, t } from './i18n.js';
import { Icon, Avatar, Toast, ComingSoon } from './ui.js';
import { LogoMark } from './logo.js';
import { isSupervisor, roleInfo } from './roles.js';
import { loadCore, startLive, stopLive, resetData, inCrew } from './data.js';
import { AuthScreen } from './views/auth.js';
import { HomeView } from './views/home.js';
import { CalendarView } from './views/calendar.js';
import { ChatView } from './views/chat.js';
import { TeamView } from './views/team.js';
import { TasksView } from './views/tasks.js';
import { RoomsView } from './views/rooms.js';
import { ReportsView } from './views/reports.js';
import { MeetingsView } from './views/meetings.js';
import { ProfileSheet } from './views/profile.js';
import { PersonSheet } from './views/person.js';

// ---------------------------------------------------------------- pages
const NAV = [
  { route: 'home', icon: 'home', label: 'nav.home', dock: true },
  { route: 'calendar', icon: 'calendar-event', label: 'nav.calendar', dock: true },
  { route: 'rooms', icon: 'bed', label: 'nav.rooms', dock: true },
  { route: 'chat', icon: 'messages', label: 'nav.chat', dock: true, only: 'crew' }, // the custodian team only
  { route: 'team', icon: 'id', label: 'nav.team', dock: true },
  { route: 'tasks', icon: 'list-check', label: 'nav.tasks', dock: true, only: 'sup' },
  { route: 'meetings', icon: 'calendar-month', label: 'nav.meetings', desk: true }, // in the desktop sidebar; on phones reachable from Home
  { route: 'reports', icon: 'clipboard-data', label: 'nav.reports', only: 'sup', desk: true }, // in the desktop sidebar; on phones reachable from Home
  { route: 'shifts', icon: 'clock', label: 'nav.shifts' }, // coming soon: reachable from Home, not in the dock yet
];

function currentRoute() {
  const r = location.hash.replace(/^#\/?/, '') || 'home';
  return NAV.some((n) => n.route === r) ? r : 'home';
}

function Shell() {
  const s = useStore();
  const me = s.profile;
  const sup = isSupervisor(me);
  const [route, setRoute] = useState(currentRoute());

  useEffect(() => {
    const onHash = () => { setRoute(currentRoute()); window.scrollTo(0, 0); };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const allowed = (n) => !n.only || (n.only === 'crew' ? inCrew(me) : sup);
  const active = NAV.some((n) => n.route === route && allowed(n)) ? route : 'home';
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'greet.morning' : hour < 18 ? 'greet.afternoon' : 'greet.evening';
  const dock = NAV.filter((n) => (n.dock || n.desk) && allowed(n));
  const phoneDock = dock.filter((n) => !n.desk);
  const idx = phoneDock.findIndex((n) => n.route === active);

  let view;
  if (active === 'home') view = html`<${HomeView} />`;
  else if (active === 'calendar') view = html`<${CalendarView} />`;
  else if (active === 'team') view = html`<${TeamView} />`;
  else if (active === 'tasks') view = html`<${TasksView} />`;
  else if (active === 'rooms') view = html`<${RoomsView} />`;
  else if (active === 'reports') view = html`<${ReportsView} />`;
  else if (active === 'meetings') view = html`<${MeetingsView} />`;
  else if (active === 'shifts') view = html`<${ShiftsSoon} />`;

  const nav = html`<nav class="dock" aria-label="Main" style=${`--n:${phoneDock.length};--i:${Math.max(idx, 0)}`}>
    <div class="dock-brand"><${LogoMark} size=${40} /><b>Bountiful</b></div>
    <span class=${'dock-ind' + (idx < 0 ? ' none' : '')}></span>
    ${dock.map((n) => html`<a key=${n.route} href=${'#/' + n.route} class=${(active === n.route ? 'on' : '') + (n.desk ? ' desk-only' : '')}
      aria-label=${t(n.label)} aria-current=${active === n.route ? 'page' : undefined}><${Icon} name=${n.icon} size=${26} /><span class="dock-label">${t(n.label)}</span></a>`)}
  </nav>`;
  const profile = html`${s.sheet === 'profile' ? html`<${ProfileSheet} onClose=${() => set({ sheet: null })} />` : null}${s.person ? html`<${PersonSheet} id=${s.person} onClose=${() => set({ person: null })} />` : null}`;

  if (active === 'chat') {
    return html`<div class="shell chat-shell"><${ChatView} />${nav}${profile}</div>`;
  }

  return html`<div class="shell">
    <header class="topbar">
      <div class="hello"><p>${t(greet)},</p><h1>${me.display_name}</h1></div>
      <button class="avatar-btn" aria-label=${t('profile.title')} onClick=${() => set({ sheet: 'profile' })}>
        <${Avatar} profile=${me} size=${52} />
      </button>
    </header>
    <main class="screen" key=${active}>${view}</main>
    ${nav}
    ${profile}
  </div>`;
}

function ShiftsSoon() {
  return html`<div class="stack"><a class="back-link" href="#/home"><${Icon} name="caret-left" size=${18} />${t('nav.home')}</a>
    <${ComingSoon} icon="clock" color="#FFDD94" title=${t('nav.shifts')} /></div>`;
}

function Paused() {
  return html`<div class="auth"><div class="auth-card">
    <div class="auth-brand"><${LogoMark} size=${72} /><h1>${t('paused.title')}</h1><p>${t('paused.text')}</p></div>
    <button class="btn soft" onClick=${() => sb.auth.signOut()}>${t('profile.signout')}</button>
  </div></div>`;
}

// Tap anybody's picture (or name in the chat) to see their profile card. Pictures inside buttons keep doing what their button does.
addEventListener('click', (e) => {
  const el = e.target && e.target.closest && e.target.closest('[data-pid]');
  if (!el || el.closest('button, a, label, input, textarea, [role=button], .profile-top')) return;
  if (!state.profile || !state.profiles[el.dataset.pid]) return;
  set({ person: el.dataset.pid });
});

function Splash() { return html`<div class="boot"><img class="boot-logo" src="assets/logo/logo.svg" alt=""></div>`; }

function DemoBanner() {
  const roles = [['custodian_supervisor', 'custodian_supervisor'], ['custodian', 'custodian'], ['receptionist', 'receptionist']];
  return html`<div class="demo-banner"><span>${t('demo.banner')}</span>
    ${roles.map(([r]) => html`<a href=${'?demo=' + r} class=${state.profile && state.profile.role === r ? 'on' : ''}>${roleInfo(r).name}</a>`)}
  </div>`;
}

function App() {
  const s = useStore();
  let body;
  if (!s.ready || (s.session && !s.profile)) body = html`<${Splash} />`;
  else if (!s.session) body = html`<${AuthScreen} />`;
  else if (s.profile.active === false) body = html`<${Paused} />`;
  else body = html`<${Shell} />`;
  return html`${s.demo ? html`<${DemoBanner} />` : null}${body}<${Toast} toast=${s.toast} />`;
}

// ---------------------------------------------------------------- login lifecycle
async function applySession(session) {
  if (!session) {
    stopLive();
    resetData();
    set({ session: null, profile: null, profiles: {}, sheet: null });
    return;
  }
  try {
    const all = await api.loadProfiles();
    const map = Object.fromEntries(all.map((p) => [p.id, p]));
    const me = map[session.user.id];
    if (!me) { await sb.auth.signOut(); return; }

    // my language is kept with my login (so it follows me to every device)
    const saved = session.user.user_metadata && session.user.user_metadata.lang;
    if (saved && saved !== state.lang) setLang(saved);

    set({ session, profile: me, profiles: map });
    if (me.active !== false) {
      await loadCore().catch((e) => console.error(e));
      startLive();
      enablePush(); // phone notifications even when the app is closed (does nothing if not allowed yet / demo)
    }
  } catch (e) {
    console.error(e);
    set({ session: null, profile: null });
  }
}

async function boot() {
  initLang();
  // no pinch-zoom on iPhones either (the page itself is already built to fit every screen)
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  const root = document.getElementById('app');
  root.textContent = ''; // remove the loading logo from index.html before the app draws itself
  render(html`<${App} />`, root);

  const demoRole = new URLSearchParams(location.search).get('demo');
  if (demoRole) {
    const { startDemo } = await import('./demo.js');
    await startDemo(demoRole);
    return;
  }

  const { data } = await sb.auth.getSession();
  await applySession(data.session);
  set({ ready: true });

  sb.auth.onAuthStateChange((event, session) => {
    // (run outside the callback so the database calls inside can't block the login)
    setTimeout(() => {
      if (event === 'SIGNED_OUT') applySession(null);
      else if (event === 'SIGNED_IN') {
        const same = state.session && session && state.session.user.id === session.user.id && state.profile;
        if (same) state.session = session; else applySession(session);
      }
    }, 0);
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
