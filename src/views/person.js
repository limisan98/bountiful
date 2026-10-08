import { html } from '../../assets/vendor/htm-preact.js';
import { useStore, set } from '../store.js';
import { t } from '../i18n.js';
import { Icon, Avatar, RoleChip, Sheet, useSheetControl } from '../ui.js';
import { roleInfo } from '../roles.js';
import { inCrew, openDm } from '../data.js';

// A person's profile card: opens when you tap someone's picture (or name in the chat) anywhere in the app.
export function PersonSheet({ id, onClose }) {
  const s = useStore();
  const ctl = useSheetControl();
  const p = s.profiles[id];
  const me = s.profile;
  if (!p) return null;
  const mine = p.id === me.id;
  const canChat = !mine && inCrew(me) && inCrew(p) && p.active !== false;
  const r = roleInfo(p.role);
  return html`<${Sheet} title=${t('person.title')} onClose=${onClose} control=${ctl}>
    <div class="profile-top">
      <${Avatar} profile=${p} size=${112} />
      <h3 class="person-big">${p.display_name}</h3>
      <${RoleChip} role=${p.role} />
      <span class="muted">${t('dept.' + r.department)}</span>
      ${p.active === false ? html`<span class="chip">${t('team.paused')}</span>` : null}
    </div>
    ${canChat ? html`<button class="btn" onClick=${() => { ctl.close(); setTimeout(() => openDm(p.id), 200); }}><${Icon} name="message" size=${20} />${t('person.message')}</button>` : null}
    ${mine ? html`<button class="btn soft" onClick=${() => { ctl.close(); setTimeout(() => set({ sheet: 'profile' }), 200); }}><${Icon} name="user" size=${20} />${t('person.openMine')}</button>` : null}
    ${!mine && !canChat ? html`<p class="muted center small-text">${t('person.noChat')}</p>` : null}
  <//>`;
}
