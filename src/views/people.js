import { html, useState, useEffect } from '../../assets/vendor/htm-preact.js';
import { api } from '../api.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Avatar, RoleChip, Segmented, Field, Sheet } from '../ui.js';
import { ROLES, ROLE_ORDER } from '../config.js';

const roleOptions = () => ROLE_ORDER.map((r) => ({
  value: r, label: t('role.' + r), icon: ROLES[r].icon, color: ROLES[r].color, soft: ROLES[r].soft, ink: ROLES[r].ink,
}));

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (__) { /* ignore */ }
    ta.remove();
  }
  toast(t('people.copied'));
}

const siteUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');

export function PeopleView() {
  const s = useStore();
  const [rows, setRows] = useState(null);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(null);

  const reload = async () => {
    try { setRows(await api.listAllowlist()); } catch (e) { toast(friendlyError(e), 'bad'); setRows([]); }
  };
  useEffect(() => { reload(); }, []);

  const me = s.profile;
  const statusOf = (r) => {
    const p = s.profiles[r.claimed_by];
    if (!r.claimed_by) return 'pending';
    return p && p.active === false ? 'paused' : 'registered';
  };

  return html`<div class="stack">
    <div class="page-head">
      <div>
        <h2 class="page-title">${t('people.title')}</h2>
        <p class="page-sub">${t('people.sub')}</p>
      </div>
      <button class="fab" onClick=${() => setAdding(true)} aria-label=${t('people.add')}><${Icon} name="plus" size=${26} /></button>
    </div>

    ${rows === null && html`<p class="muted center">${t('common.loading')}</p>`}
    ${rows && rows.length === 0 && html`<div class="empty-card"><p>${t('people.empty')}</p></div>`}

    <div class="list">
      ${(rows || []).map((r) => {
        const p = s.profiles[r.claimed_by];
        const status = statusOf(r);
        const name = (p && p.display_name) || r.full_name || r.email;
        const isMe = p && me && p.id === me.id;
        return html`<button class="person" key=${r.email} onClick=${() => setManaging(r)}>
          <${Avatar} profile=${p} name=${name} role=${(p && p.role) || r.role} size=${54} />
          <span class="person-main">
            <span class="person-name">${name}${isMe && html`<span class="you">${t('people.you')}</span>`}</span>
            <span class="person-mail">${r.email}</span>
            <span class="person-tags">
              <${RoleChip} role=${(p && p.role) || r.role} small />
              <span class=${'chip small status ' + status}>${t('people.' + (status === 'pending' ? 'pending' : status))}</span>
            </span>
          </span>
          <${Icon} name="caret-right" size=${18} class="chev" />
        </button>`;
      })}
    </div>

    ${adding && html`<${AddPerson} onClose=${() => setAdding(false)}
      onAdded=${async (email) => { setAdding(false); await reload(); }} />`}
    ${managing && html`<${Manage} row=${managing} profile=${s.profiles[managing.claimed_by]} isMe=${me && managing.claimed_by === me.id}
      onClose=${() => setManaging(null)} onChanged=${async () => { setManaging(null); await reload(); }} />`}
  </div>`;
}

function AddPerson({ onClose, onAdded }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('custodian');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const clean = email.trim().toLowerCase();
      await api.addPerson({ email: clean, full_name: name.trim(), role });
      toast(t('people.added'));
      onAdded(clean);
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }

  return html`<${Sheet} title=${t('people.addTitle')} onClose=${onClose}>
    <form class="stack-form" onSubmit=${submit}>
      <${Field} label=${t('people.name')}>
        <input class="input" value=${name} required maxlength="40" onInput=${(e) => setName(e.target.value)} />
      <//>
      <${Field} label=${t('people.email')}>
        <input class="input" type="email" inputmode="email" value=${email} required onInput=${(e) => setEmail(e.target.value)} />
      <//>
      <div class="field"><span class="field-label">${t('people.role')}</span>
        <${Segmented} options=${roleOptions()} value=${role} onChange=${setRole} />
      </div>
      <button class="btn" type="submit" disabled=${busy}>${t('people.add')}</button>
    </form>
  <//>`;
}

function Manage({ row, profile, isMe, onClose, onChanged }) {
  const registered = !!row.claimed_by;
  const [role, setRole] = useState((profile && profile.role) || row.role);
  const [paused, setPaused] = useState(profile ? profile.active === false : false);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = (profile && profile.display_name) || row.full_name || row.email;

  async function save() {
    setBusy(true);
    try {
      if (registered) await api.adminUpdateMember(row.claimed_by, role, !paused);
      else await api.updateInvite(row.email, { role });
      toast(t('people.updated'));
      onChanged();
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }
  async function remove() {
    if (!sure) { setSure(true); return; }
    setBusy(true);
    try { await api.removeInvite(row.email); toast(t('people.removed')); onChanged(); }
    catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }

  return html`<${Sheet} title=${t('people.manage')} onClose=${onClose}>
    <div class="who">
      <${Avatar} profile=${profile} name=${name} role=${role} size=${64} />
      <div><div class="who-name">${name}</div><div class="muted">${row.email}</div></div>
    </div>

    ${!registered && html`<div class="code-card">
      <span class="field-label">${t('people.invite')}</span>
      <div class="code-big">${row.invite_code}</div>
      <div class="row-btns">
        <button class="btn soft" onClick=${() => copyText(row.invite_code)}><${Icon} name="copy" size=${18} />${t('people.copy')}</button>
        <button class="btn soft" onClick=${() => copyText(t('people.inviteMsg', { name: row.full_name || '', url: siteUrl(), code: row.invite_code }))}>
          <${Icon} name="send" size=${18} />${t('people.copyMessage')}</button>
      </div>
    </div>`}

    ${!isMe && html`<div class="stack-form">
      <div class="field"><span class="field-label">${t('people.role')}</span>
        <${Segmented} options=${roleOptions()} value=${role} onChange=${setRole} />
      </div>

      ${registered && html`<button type="button" class="switch-row" onClick=${() => setPaused(!paused)}>
        <span><strong>${t('people.pause')}</strong><span class="muted block">${t('people.pauseHelp')}</span></span>
        <span class=${'switch' + (paused ? ' on' : '')} role="switch" aria-checked=${paused}><span class="knob"></span></span>
      </button>`}

      <button class="btn" onClick=${save} disabled=${busy}>${t('people.save')}</button>

      ${!registered && html`<button class=${'btn danger' + (sure ? ' sure' : '')} onClick=${remove} disabled=${busy}>
        <${Icon} name="trash" size=${18} />${sure ? t('people.removeSure') : t('people.remove')}</button>`}
    </div>`}
  <//>`;
}
