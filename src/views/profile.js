import { html, useState, useRef, useEffect } from '../../assets/vendor/htm-preact.js';
import { api, sb } from '../api.js';
import { state, set, useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Avatar, RoleChip, Segmented, Field, PasswordInput, Sheet, LangMenu, useSheetClose } from '../ui.js';
import { squarePhoto } from '../image.js';
import { NotificationsSheet } from './notifications.js';
import { addDays, startOfWeek, todayYmd, ymd, dur } from '../time.js';
import { colorStyle } from '../color.js';

// Where each period starts (today / this week / this quarter / this year)
function periodStart(period) {
  const now = new Date();
  if (period === 'day') return todayYmd();
  if (period === 'week') return ymd(startOfWeek(now));
  if (period === 'quarter') return ymd(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1));
  return ymd(new Date(now.getFullYear(), 0, 1));
}

export function ProfileSheet({ onClose }) {
  const s = useStore();
  const me = s.profile;
  const [name, setName] = useState(me.display_name);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [period, setPeriod] = useState('week');
  const [rows, setRows] = useState(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [notif, setNotif] = useState(false);
  const fileRef = useRef(null);
  const email = s.session && s.session.user && s.session.user.email;

  useEffect(() => {
    let alive = true;
    api.loadMyStats(`${new Date().getFullYear()}-01-01`).then((r) => alive && setRows(r)).catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, []);

  const mine = (rows || []).filter((r) => r.day >= periodStart(period));
  const done = mine.length;
  const minutes = mine.reduce((n, r) => n + r.minutes, 0);
  const days = new Set(mine.map((r) => r.day)).size;

  const mergeMe = (row) => set({ profile: row, profiles: { ...state.profiles, [row.id]: row } });

  async function saveName(e) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean || clean === me.display_name) return;
    setBusy(true);
    try { mergeMe(await api.updateMyProfile({ display_name: clean })); toast(t('profile.saved')); }
    catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }

  async function pickPhoto(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setPhotoBusy(true);
    try {
      const blob = await squarePhoto(file, 512);
      if (!blob) throw new Error('photo');
      const url = await api.uploadAvatar(blob);
      mergeMe(await api.updateMyProfile({ avatar_url: url }));
      toast(t('profile.photoUpdated'));
    } catch (ex) { toast(t('err.photo'), 'bad'); }
    setPhotoBusy(false);
  }

  async function changePassword(e) {
    e.preventDefault();
    if (pw.length < 8) { toast(t('err.weak'), 'bad'); return; }
    setBusy(true);
    try { await api.changePassword(pw); setPw(''); setPwOpen(false); toast(t('profile.passwordDone')); }
    catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }

  return html`<${Sheet} title=${t('profile.title')} onClose=${onClose}>
    <div class="profile-top">
      <button class="photo-btn" onClick=${() => fileRef.current.click()} aria-label=${t('profile.photo')} disabled=${photoBusy}>
        <${Avatar} profile=${me} size=${104} />
        <span class="cam"><${Icon} name=${photoBusy ? 'hourglass' : 'camera'} size=${18} /></span>
      </button>
      <input ref=${fileRef} type="file" accept="image/*" hidden onChange=${pickPhoto} />
      <${RoleChip} role=${me.role} />
      <p class="muted small-text">${photoBusy ? t('profile.photoWorking') : email}</p>
    </div>

    <form class="stack-form" onSubmit=${saveName}>
      <${Field} label=${t('profile.name')} hint=${t('profile.nameVisible')}>
        <input class="input" value=${name} maxlength="40" required onInput=${(e) => setName(e.target.value)} />
      <//>
      <button class="btn soft" type="submit" disabled=${busy || name.trim() === me.display_name || !name.trim()}>
        <${Icon} name="check" size=${18} />${t('profile.save')}</button>
    </form>

    <div class="field">
      <span class="field-label">${t('profile.language')}</span>
      <${LangMenu} align="left" onPick=${(code) => { api.saveLanguage(code).catch(() => {}); }} />
    </div>

    <div class="field">
      <span class="field-label">${t('profile.activity')}</span>
      <${Segmented} value=${period} onChange=${setPeriod} options=${[
        { value: 'day', label: t('period.day') }, { value: 'week', label: t('period.week') },
        { value: 'quarter', label: t('period.quarter') }, { value: 'year', label: t('period.year') },
      ]} />
      <div class=${'stats' + (rows === null ? ' loading' : '')}>
        <div class="stat" style=${colorStyle('#86E3CE')}><${Icon} name="circle-check" size=${22} /><b>${done}</b><span>${t('stat.tasks')}</span></div>
        <div class="stat" style=${colorStyle('#FFDD94')}><${Icon} name="clock" size=${22} /><b>${dur(minutes)}</b><span>${t('stat.time')}</span></div>
        <div class="stat" style=${colorStyle('#CCABD8')}><${Icon} name="calendar-event" size=${22} /><b>${days}</b><span>${t('stat.days')}</span></div>
      </div>
      <p class="field-hint">${t('profile.activityNote')}</p>
    </div>

    <button class="btn soft" onClick=${() => setNotif(true)}><${Icon} name="bell" size=${18} />${t('notif.title')}</button>

    ${pwOpen
      ? html`<form class="stack-form pop" onSubmit=${changePassword}>
          <${Field} label=${t('profile.newPassword')} hint=${t('auth.passwordHelp')}>
            <${PasswordInput} value=${pw} onInput=${(e) => setPw(e.target.value)} autocomplete="new-password" />
          <//>
          <div class="row-btns">
            <button type="button" class="btn soft" onClick=${() => setPwOpen(false)}>${t('common.cancel')}</button>
            <button class="btn" type="submit" disabled=${busy}>${t('profile.save')}</button>
          </div>
        </form>`
      : html`<button class="btn soft" onClick=${() => setPwOpen(true)}><${Icon} name="lock" size=${18} />${t('profile.password')}</button>`}

    <${SignOut} onClose=${onClose} />
    ${notif ? html`<${NotificationsSheet} onClose=${() => setNotif(false)} />` : null}
  <//>`;
}

function SignOut({ onClose }) {
  const close = useSheetClose();
  const go = async () => {
    close();
    if (state.demo) { location.href = location.pathname; return; }
    await sb.auth.signOut();
  };
  return html`<button class="btn ghost" onClick=${go}><${Icon} name="square-rounded-arrow-left" size=${20} />${t('profile.signout')}</button>`;
}
