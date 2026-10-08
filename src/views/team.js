import { html, useState, useEffect } from '../../assets/vendor/htm-preact.js';
import { api } from '../api.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Avatar, RoleChip, Segmented, Field, Sheet, PersonLine, IconPicker, ColorPicker, Empty, useSheetControl } from '../ui.js';
import { roleInfo, roleList, isSupervisor } from '../roles.js';
import { saveRole } from '../data.js';
import { colorStyle } from '../color.js';
import { ROLE_ICONS, DEPARTMENTS, ROLE_ORDER } from '../config.js';

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (__) { /* ignore */ }
    ta.remove();
  }
  toast(t('team.copied'));
}
const siteUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');

// ---- Choose one of the four roles ----
export function RolePicker({ value, onChange }) {
  return html`<div class="role-grid" role="radiogroup">
    ${roleList().map((r) => html`<button type="button" key=${r.id} role="radio" aria-checked=${value === r.id}
      class=${'role-opt' + (value === r.id ? ' on' : '')} style=${`--c:${r.color};--soft:${r.soft};--ink:${r.ink}`}
      onClick=${() => onChange(r.id)}>
      <span class="role-ic"><${Icon} name=${r.icon} size=${20} /></span><span class="role-nm">${r.name}</span>
    </button>`)}
  </div>`;
}

export function TeamView() {
  const s = useStore();
  const me = s.profile;
  const sup = isSupervisor(me);
  const [tab, setTab] = useState('team');
  const [rows, setRows] = useState(null);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(null);
  const [editRole, setEditRole] = useState(null);

  const reload = async () => {
    try { setRows(await api.listAllowlist()); } catch (e) { toast(friendlyError(e), 'bad'); setRows([]); }
  };
  useEffect(() => { if (sup) reload(); }, [sup]);

  const people = Object.values(s.profiles);
  const order = (p) => ROLE_ORDER.indexOf(p.role);
  const pending = (rows || []).filter((r) => !r.claimed_by);

  const openPerson = (p) => {
    if (!sup) return;
    const row = (rows || []).find((r) => r.claimed_by === p.id);
    if (row) setManaging(row);
  };

  return html`<div class="stack">
    <div class="page-head">
      <div>
        <h2 class="page-title">${t('team.title')}</h2>
        <p class="page-sub">${tab === 'invites' ? t('team.inviteSub') : tab === 'roles' ? t('team.rolesSub') : t('team.sub')}</p>
      </div>
      ${sup && tab === 'invites' && html`<button class="fab pop" onClick=${() => setAdding(true)} aria-label=${t('team.add')}><${Icon} name="plus" size=${26} /></button>`}
    </div>

    ${sup && html`<${Segmented} value=${tab} onChange=${setTab} options=${[
      { value: 'team', label: t('team.tabTeam'), icon: 'user' },
      { value: 'invites', label: t('team.tabInvites'), icon: 'ticket' },
      { value: 'roles', label: t('team.tabRoles'), icon: 'shield-check' },
    ]} />`}

    ${tab === 'team' && DEPARTMENTS.map((dep) => {
      const list = people.filter((p) => roleInfo(p.role).department === dep).sort((a, b) => order(a) - order(b) || a.display_name.localeCompare(b.display_name));
      if (!list.length) return null;
      return html`<section key=${dep} class="rise">
        <h3 class="section-title">${t('dept.' + dep)}<span class="count">${list.length}</span></h3>
        <div class="list">
          ${list.map((p) => {
            const body = html`<${PersonLine} profile=${p} size=${52} extra=${html`<span class="pline-tail">
              ${p.id === me.id ? html`<span class="you">${t('team.you')}</span>` : null}
              ${p.active === false ? html`<span class="chip small status paused">${t('team.paused')}</span>` : null}
              ${sup && p.id !== me.id ? html`<${Icon} name="caret-right" size=${18} class="chev" />` : null}</span>`} />`;
            return sup && p.id !== me.id
              ? html`<button class="person" key=${p.id} onClick=${() => openPerson(p)}>${body}</button>`
              : html`<div class="person static" key=${p.id}>${body}</div>`;
          })}
        </div>
      </section>`;
    })}

    ${tab === 'invites' && html`<div class="list rise">
      ${rows === null ? html`<p class="muted center">${t('common.loading')}</p>` : null}
      ${rows && !pending.length ? html`<${Empty} icon="ticket" text=${t('team.noInvites')} />` : null}
      ${pending.map((r) => html`<button class="person" key=${r.email} onClick=${() => setManaging(r)}>
        <${Avatar} name=${r.full_name || r.email} role=${r.role} size=${52} />
        <span class="person-main">
          <span class="person-name">${r.full_name || r.email}</span>
          <span class="person-mail">${r.email}</span>
          <span class="person-tags"><${RoleChip} role=${r.role} small /><span class="chip small status pending">${t('team.pending')}</span></span>
        </span>
        <${Icon} name="caret-right" size=${18} class="chev" />
      </button>`)}
    </div>`}

    ${tab === 'roles' && html`<div class="rise">
      ${DEPARTMENTS.map((dep) => html`<section key=${dep} class="role-section">
        <h3 class="section-title">${t('dept.' + dep)}</h3>
        <div class="list">
          ${roleList().filter((r) => r.department === dep).map((r) => html`<button class="person" key=${r.id} onClick=${() => setEditRole(r.id)}>
            <span class="role-badge" style=${`--c:${r.color}`}><${Icon} name=${r.icon} size=${24} /></span>
            <span class="person-main"><span class="person-name">${r.name}</span>
              <span class="person-mail">${r.isSupervisor ? t('team.supervisorRole') : t('team.workerRole')}</span></span>
            <${Icon} name="pencil" size=${18} class="chev" />
          </button>`)}
        </div>
      </section>`)}
    </div>`}

    ${adding && html`<${AddPerson} onClose=${() => setAdding(false)} onAdded=${reload} />`}
    ${managing && html`<${Manage} row=${managing} profile=${s.profiles[managing.claimed_by]}
      onClose=${() => setManaging(null)} onChanged=${reload} />`}
    ${editRole && html`<${RoleEditor} id=${editRole} onClose=${() => setEditRole(null)} />`}
  </div>`;
}

function AddPerson({ onClose, onAdded }) {
  const ctl = useSheetControl();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('custodian');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.addPerson({ email: email.trim().toLowerCase(), full_name: name.trim(), role });
      toast(t('team.added'));
      ctl.close();
      onAdded();
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }
  return html`<${Sheet} title=${t('team.addTitle')} onClose=${onClose} control=${ctl}>
    <form class="stack-form" onSubmit=${submit}>
      <${Field} label=${t('team.name')}><input class="input" value=${name} required maxlength="40" onInput=${(e) => setName(e.target.value)} /><//>
      <${Field} label=${t('team.email')}><input class="input" type="email" inputmode="email" value=${email} required onInput=${(e) => setEmail(e.target.value)} /><//>
      <div class="field"><span class="field-label">${t('team.role')}</span><${RolePicker} value=${role} onChange=${setRole} /></div>
      <button class="btn" type="submit" disabled=${busy}><${Icon} name="plus" size=${20} />${t('team.add')}</button>
    </form>
  <//>`;
}

function Manage({ row, profile, onClose, onChanged }) {
  const ctl = useSheetControl();
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
      toast(t('team.updated'));
      ctl.close();
      onChanged();
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }
  async function remove() {
    if (!sure) { setSure(true); return; }
    setBusy(true);
    try { await api.removeInvite(row.email); toast(t('team.removed')); ctl.close(); onChanged(); }
    catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }

  return html`<${Sheet} title=${t('team.manage')} onClose=${onClose} control=${ctl}>
    <div class="who">
      <${Avatar} profile=${profile} name=${name} role=${role} size=${64} />
      <div><div class="who-name">${name}</div><div class="muted who-mail">${row.email}</div></div>
    </div>

    ${!registered && html`<div class="code-card">
      <span class="field-label">${t('team.invite')}</span>
      <div class="code-big">${row.invite_code}</div>
      <div class="row-btns stacked">
        <button class="btn soft" onClick=${() => copyText(row.invite_code)}><${Icon} name="copy" size=${18} />${t('team.copy')}</button>
        <button class="btn soft" onClick=${() => copyText(t('team.inviteMsg', { name: row.full_name || '', url: siteUrl(), code: row.invite_code }))}>
          <${Icon} name="send" size=${18} />${t('team.copyMessage')}</button>
      </div>
    </div>`}

    <div class="stack-form">
      <div class="field"><span class="field-label">${t('team.role')}</span><${RolePicker} value=${role} onChange=${setRole} /></div>

      ${registered && html`<button type="button" class="switch-row" onClick=${() => setPaused(!paused)}>
        <span><strong>${t('team.pause')}</strong><span class="muted block">${t('team.pauseHelp')}</span></span>
        <span class=${'switch' + (paused ? ' on' : '')} role="switch" aria-checked=${paused}><span class="knob"></span></span>
      </button>`}

      <button class="btn" onClick=${save} disabled=${busy}><${Icon} name="check" size=${20} />${t('team.save')}</button>

      ${!registered && html`<button class=${'btn danger' + (sure ? ' sure' : '')} onClick=${remove} disabled=${busy}>
        <${Icon} name="trash" size=${18} />${sure ? t('team.removeSure') : t('team.remove')}</button>`}
    </div>
  <//>`;
}

function RoleEditor({ id, onClose }) {
  const ctl = useSheetControl();
  const r = roleInfo(id);
  const [name, setName] = useState(r.custom);
  const [icon, setIcon] = useState(r.icon);
  const [color, setColor] = useState(r.color);
  const [busy, setBusy] = useState(false);
  const preview = { ...r, name: name.trim() || t('role.' + id), icon, color };

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try { await saveRole(id, { name: name.trim() || null, icon, color }); toast(t('team.updated')); ctl.close(); }
    catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }
  return html`<${Sheet} title=${t('team.editRole')} onClose=${onClose} control=${ctl}>
    <form class="stack-form" onSubmit=${save}>
      <div class="preview-box">
        <${Preview} role=${preview} />
      </div>
      <${Field} label=${t('team.roleName')} hint=${t('team.roleNameHint', { name: t('role.' + id) })}>
        <input class="input" value=${name} maxlength="30" placeholder=${t('role.' + id)} onInput=${(e) => setName(e.target.value)} />
      <//>
      <div class="field"><span class="field-label">${t('team.roleIcon')}</span>
        <${IconPicker} value=${icon} onChange=${setIcon} icons=${ROLE_ICONS} color=${color} /></div>
      <div class="field"><span class="field-label">${t('team.roleColor')}</span><${ColorPicker} value=${color} onChange=${setColor} /></div>
      <button class="btn" type="submit" disabled=${busy}><${Icon} name="check" size=${20} />${t('team.save')}</button>
    </form>
  <//>`;
}

function Preview({ role }) {
  return html`<span class="chip role big" style=${colorStyle(role.color)}><${Icon} name=${role.icon} size=${18} />${role.name}</span>`;
}
