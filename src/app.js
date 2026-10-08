import { html, render, useEffect, useState } from '../assets/vendor/htm-preact.js';
import { sb, api } from './api.js';
import { state, set, useStore } from './store.js';
import { initLang, setLang, t } from './i18n.js';
import { Icon, Avatar, Toast, ComingSoon } from './ui.js';
import { LogoMark } from './logo.js';
import { AuthScreen } from './views/auth.js';
import { HomeView } from './views/home.js';
import { PeopleView } from './views/people.js';
import { ProfileSheet } from './views/profile.js';

// ---------------------------------------------------------------- pages
const NAV = [
  { route: 'home', icon: 'home', label: 'nav.home' },
  { route: 'calendar', icon: 'calendar-event', label: 'nav.calendar' },
  { route: 'chat', icon: 'messages', label: 'nav.chat' },
  { route: 'shifts', icon: 'clock', label: 'nav.shifts' },
  { route: 'people', icon: 'id', label: 'nav.people', only: 'supervisor' },
];
const SOON = {
  calendar: { icon: 'calendar-event', color: '#6D4AFF' },
  chat: { icon: 'messages', color: '#F2655B' },
  shifts: { icon: 'clock', color: '#FFC83D' },
};

function currentRoute() {
  const r = location.hash.replace(/^#\/?/, '') || 'home';
  return NAV.some((n) => n.route === r) ? r : 'home';
}

function Shell() {
  const s = useStore();
  const me = s.profile;
  const [route, setRoute] = useState(currentRoute());

  useEffect(() => {
    const onHash = () => { setRoute(currentRoute()); window.scrollTo(0, 0); };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const active = route === 'people' && me.role !== 'supervisor' ? 'home' : route;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'greet.morning' : hour < 18 ? 'greet.afternoon' : 'greet.evening';

  let view;
  if (active === 'home') view = html`<${HomeView} />`;
  else if (active === 'people') view = html`<${PeopleView} />`;
  else view = html`<${ComingSoon} icon=${SOON[active].icon} color=${SOON[active].color} title=${t('nav.' + active)} />`;

  return html`<div class="shell">
    <header class="topbar">
      <div class="hello"><p>${t(greet)},</p><h1>${me.display_name}</h1></div>
      <button class="avatar-btn" aria-label=${t('profile.title')} onClick=${() => set({ sheet: 'profile' })}>
        <${Avatar} profile=${me} size=${52} />
      </button>
    </header>
    <main class="screen">${view}</main>
    <nav class="dock" aria-label="Main">
      ${NAV.filter((n) => !n.only || n.only === me.role).map((n) => html`<a key=${n.route} href=${'#/' + n.route}
        class=${active === n.route ? 'on' : ''} aria-label=${t(n.label)} aria-current=${active === n.route ? 'page' : undefined}>
        <${Icon} name=${n.icon} size=${26} /></a>`)}
    </nav>
    ${s.sheet === 'profile' && html`<${ProfileSheet} onClose=${() => set({ sheet: null })} />`}
  </div>`;
}

function Paused() {
  return html`<div class="auth"><div class="auth-card">
    <div class="auth-brand"><${LogoMark} size=${72} /><h1>${t('paused.title')}</h1><p>${t('paused.text')}</p></div>
    <button class="btn soft" onClick=${() => sb.auth.signOut()}>${t('profile.signout')}</button>
  </div></div>`;
}

function Splash() { return html`<div class="boot"><div class="boot-logo"></div></div>`; }

function DemoBanner() {
  const roles = [['supervisor', 'role.supervisor'], ['custodian', 'role.custodian'], ['receptionist', 'role.receptionist']];
  return html`<div class="demo-banner"><span>${t('demo.banner')}</span>
    ${roles.map(([r, k]) => html`<a href=${'?demo=' + r} class=${state.profile && state.profile.role === r ? 'on' : ''}>${t(k)}</a>`)}
  </div>`;
}

function App() {
  const s = useStore();
  let body;
  if (!s.ready || (s.session && !s.profile)) body = html`<${Splash} />`;
  else if (!s.session) body = html`<${AuthScreen} />`;
  else if (s.profile.active === false) body = html`<${Paused} />`;
  else body = html`<${Shell} />`;
  return html`${s.demo && html`<${DemoBanner} />`}${body}<${Toast} toast=${s.toast} />`;
}

// ---------------------------------------------------------------- login lifecycle
let channel = null;

function startRealtime() {
  if (channel) return;
  channel = sb.channel('bountiful-profiles')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (p) => {
      if (p.eventType === 'DELETE') {
        const copy = { ...state.profiles };
        delete copy[p.old.id];
        set({ profiles: copy });
        return;
      }
      const row = p.new;
      if (!row || !row.id) return;
      const patch = { profiles: { ...state.profiles, [row.id]: row } };
      if (state.profile && state.profile.id === row.id) patch.profile = row;
      set(patch);
    })
    .subscribe();
}

function stopRealtime() {
  if (channel) { sb.removeChannel(channel); channel = null; }
}

async function applySession(session) {
  if (!session) {
    stopRealtime();
    set({ session: null, profile: null, profiles: {}, sheet: null });
    return;
  }
  try {
    const all = await api.loadProfiles();
    const map = Object.fromEntries(all.map((p) => [p.id, p]));
    let me = map[session.user.id];
    if (!me) { await sb.auth.signOut(); return; }

    // A brand-new account keeps the language chosen on the login screen
    const isNew = me.created_at ? Date.now() - Date.parse(me.created_at) < 120000 : false;
    if (isNew && me.language !== state.lang) {
      try { me = await api.updateMyProfile({ language: state.lang }); map[me.id] = me; } catch (_) { /* ignore */ }
    } else if (me.language && me.language !== state.lang) {
      setLang(me.language);
    }
    set({ session, profile: me, profiles: map });
    startRealtime();
  } catch (e) {
    console.error(e);
    set({ session: null, profile: null });
  }
}

async function boot() {
  initLang();
  render(html`<${App} />`, document.getElementById('app'));

  const demoRole = new URLSearchParams(location.search).get('demo');
  if (demoRole) {
    const { startDemo } = await import('./demo.js');
    startDemo(demoRole);
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
