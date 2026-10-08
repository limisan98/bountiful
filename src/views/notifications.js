import { html, useState } from '../../assets/vendor/htm-preact.js';
import { api } from '../api.js';
import { state, toast, useStore } from '../store.js';
import { t } from '../i18n.js';
import { Icon, Sheet } from '../ui.js';
import { isSupervisor, departmentOf } from '../roles.js';
import { colorStyle } from '../color.js';
import { areaName } from '../data.js';
import { TYPES, KEY, loadPrefs } from '../notify.js';

function status() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (ios && !installed) return 'ios';
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
  return Notification.permission === 'granted' ? 'on' : Notification.permission === 'denied' ? 'blocked' : 'off';
}

export function NotificationsSheet({ onClose }) {
  const [prefs, setPrefs] = useState(loadPrefs);
  const [st, setSt] = useState(status);
  const sup = isSupervisor(state.profile);
  const rec = departmentOf(state.profile) === 'reception';
  const cust = departmentOf(state.profile) === 'custodian' && !sup;
  const areas = useStore().areas;

  async function allow() {
    try { await Notification.requestPermission(); } catch (_) { /* ignore */ }
    setSt(status());
  }
  async function test() {
    const opts = { body: t('notif.testBody'), icon: 'assets/logo/icon-192.png' };
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.showNotification('Bountiful', opts); else new Notification('Bountiful', opts);
    } catch (_) { toast(t('err.generic'), 'bad'); }
  }
  function save(next) {
    setPrefs(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (_) { /* ignore */ }
    api.saveNotifPrefs(next).catch(() => {});
  }
  const flip = (key) => save({ ...prefs, [key]: !prefs[key] });
  const flipArea = (id) => save({ ...prefs, doneAreas: prefs.doneAreas.includes(id) ? prefs.doneAreas.filter((x) => x !== id) : [...prefs.doneAreas, id] });
  const row = (x) => html`<div class="notif-item" key=${x.key}>
    <button type="button" class="switch-row" onClick=${() => flip(x.key)}>
      <span class="notif-type"><span class="notif-ic small"><${Icon} name=${x.icon} size=${20} /></span>
        <span><strong>${t('notif.' + x.key)}</strong><span class="muted block">${t('notif.' + x.key + 'Help')}</span></span></span>
      <span class=${'switch' + (prefs[x.key] ? ' on' : '')} role="switch" aria-checked=${!!prefs[x.key]}><span class="knob"></span></span>
    </button>
    ${x.sections && prefs[x.key] && areas.length ? html`<div class="notif-sections pop">
      <span class="muted">${t('notif.sections')}</span>
      <div class="chips">
        ${areas.map((a) => html`<button type="button" key=${a.id} class=${'pick' + (prefs.doneAreas.includes(a.id) ? ' on' : '')} style=${colorStyle(a.color)}
          aria-pressed=${prefs.doneAreas.includes(a.id)} onClick=${() => flipArea(a.id)}><${Icon} name=${a.icon} size=${16} />${areaName(a)}</button>`)}
      </div>
      <span class="muted small">${prefs.doneAreas.length ? t('notif.sectionsSome') : t('notif.sectionsAll')}</span>
    </div>` : null}
  </div>`;

  const icon = st === 'on' ? 'bell-ringing' : 'bell';
  return html`<${Sheet} title=${t('notif.title')} onClose=${onClose}>
    <div class=${'notif-status ' + st}>
      <span class="notif-ic"><${Icon} name=${icon} size=${26} /></span>
      <p>${t('notif.status.' + st)}</p>
    </div>
    ${st === 'off' ? html`<button class="btn" onClick=${allow}><${Icon} name="bell-ringing" size=${20} />${t('notif.allow')}</button>` : null}
    ${st === 'on' ? html`<button class="btn soft" onClick=${test}><${Icon} name="send" size=${18} />${t('notif.test')}</button>` : null}

    <div class="field"><span class="field-label">${t('notif.types')}</span>
      <div class="list tight">${TYPES.filter((x) => !x.only || (x.only === 'custodian' && cust) || (x.only === 'staff' && !sup)).map(row)}</div>
    </div>
    ${sup ? html`<div class="field"><span class="field-label">${t('notif.supTitle')}</span>
      <div class="list tight">${TYPES.filter((x) => x.only === 'sup').map(row)}</div>
    </div>` : null}
    ${rec ? html`<div class="field"><span class="field-label">${t('notif.recTitle')}</span>
      <div class="list tight">${TYPES.filter((x) => x.only === 'reception').map(row)}</div>
    </div>` : null}
    <p class="field-hint">${t('notif.note')}</p>
  <//>`;
}
