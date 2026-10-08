import { html, useState, useRef } from '../../assets/vendor/htm-preact.js';
import { api, sb } from '../api.js';
import { state, set, useStore, toast } from '../store.js';
import { t, LANGS, setLang, friendlyError } from '../i18n.js';
import { Icon, Avatar, RoleChip, Segmented, Field, PasswordInput, Sheet } from '../ui.js';
import { squarePhoto } from '../image.js';

export function ProfileSheet({ onClose }) {
  const s = useStore();
  const me = s.profile;
  const [name, setName] = useState(me.display_name);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [period, setPeriod] = useState('week');
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const fileRef = useRef(null);

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

  async function chooseLang(code) {
    setLang(code);
    try { mergeMe(await api.updateMyProfile({ language: code })); } catch (_) { /* local choice still applies */ }
  }

  async function changePassword(e) {
    e.preventDefault();
    if (pw.length < 8) { toast(t('err.weak'), 'bad'); return; }
    setBusy(true);
    try { await api.changePassword(pw); setPw(''); setPwOpen(false); toast(t('profile.passwordDone')); }
    catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }

  async function signOut() {
    onClose();
    if (state.demo) { location.href = location.pathname; return; }
    await sb.auth.signOut();
  }

  return html`<${Sheet} title=${t('profile.title')} onClose=${onClose}>
    <div class="profile-top">
      <button class="photo-btn" onClick=${() => fileRef.current.click()} aria-label=${t('profile.photo')} disabled=${photoBusy}>
        <${Avatar} profile=${me} size=${104} />
        <span class="cam"><${Icon} name=${photoBusy ? 'hourglass' : 'camera'} size=${18} /></span>
      </button>
      <input ref=${fileRef} type="file" accept="image/*" hidden onChange=${pickPhoto} />
      <${RoleChip} role=${me.role} />
      <p class="muted small-text">${photoBusy ? t('profile.photoWorking') : me.email}</p>
    </div>

    <form class="inline-form" onSubmit=${saveName}>
      <${Field} label=${t('profile.name')} hint=${t('profile.nameVisible')}>
        <span class="with-btn">
          <input class="input" value=${name} maxlength="40" required onInput=${(e) => setName(e.target.value)} />
          <button class="btn small" type="submit" disabled=${busy || name.trim() === me.display_name}>${t('profile.save')}</button>
        </span>
      <//>
    </form>

    <div class="field">
      <span class="field-label">${t('profile.language')}</span>
      <div class="lang-grid">
        ${LANGS.map((l) => html`<button type="button" key=${l.code} class=${'lang' + (s.lang === l.code ? ' on' : '')}
          onClick=${() => chooseLang(l.code)}>${l.name}</button>`)}
      </div>
    </div>

    <div class="field">
      <span class="field-label">${t('profile.activity')}</span>
      <${Segmented} value=${period} onChange=${setPeriod} options=${[
        { value: 'day', label: t('period.day') }, { value: 'week', label: t('period.week') },
        { value: 'quarter', label: t('period.quarter') }, { value: 'year', label: t('period.year') },
      ]} />
      <div class="stats">
        <div class="stat" style="--c:#6D4AFF"><${Icon} name="circle-check" size=${22} /><b>0</b><span>${t('stat.tasks')}</span></div>
        <div class="stat" style="--c:#FF8A3D"><${Icon} name="clock" size=${22} /><b>0h</b><span>${t('stat.time')}</span></div>
        <div class="stat" style="--c:#2EC4A6"><${Icon} name="bed" size=${22} /><b>0</b><span>${t('stat.rooms')}</span></div>
      </div>
      <p class="field-hint">${t('profile.activityNote')}</p>
    </div>

    ${pwOpen
      ? html`<form class="stack-form" onSubmit=${changePassword}>
          <${Field} label=${t('profile.newPassword')} hint=${t('auth.passwordHelp')}>
            <${PasswordInput} value=${pw} onInput=${(e) => setPw(e.target.value)} autocomplete="new-password" />
          <//>
          <div class="row-btns">
            <button type="button" class="btn soft" onClick=${() => setPwOpen(false)}>${t('common.cancel')}</button>
            <button class="btn" type="submit" disabled=${busy}>${t('profile.save')}</button>
          </div>
        </form>`
      : html`<button class="btn soft" onClick=${() => setPwOpen(true)}><${Icon} name="lock" size=${18} />${t('profile.password')}</button>`}

    <button class="btn ghost" onClick=${signOut}><${Icon} name="square-rounded-arrow-left" size=${20} />${t('profile.signout')}</button>
  <//>`;
}
