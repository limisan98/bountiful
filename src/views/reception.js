import { html, useState, useEffect } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Segmented, Field } from '../ui.js';
import { DateField } from '../pickers.js';
import { assignmentsOn, ensureMonth, askRoomCleaning } from '../data.js';
import { todayYmd, addDays, ymd, parseYmd, monthKey, fmt } from '../time.js';
import { AssignmentRow, AssignmentSheet } from './assign.js';

const FLOWS = [{ key: 'checkout', icon: 'sparkles-2', time: '10:00' }, { key: 'checkin', icon: 'key', time: '14:00' }];

// Reception's whole app: pick the rooms of House 1-4 that need cleaning (Check-out or Check-in) and send ONE request to the supervisor.
export function ReceptionHome() {
  const s = useStore();
  const today = todayYmd();
  const tomorrow = ymd(addDays(new Date(), 1));
  const [day, setDay] = useState(today);
  const [flow, setFlow] = useState('checkout');
  const [picked, setPicked] = useState({ checkout: [], checkin: [] });
  const [other, setOther] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  useEffect(() => { ensureMonth(monthKey(parseYmd(day))).catch(() => {}); }, [day]);

  const task = Object.values(s.tasks).find((x) => x.kind === 'room' && x.room_flow === flow && !x.deleted);
  const titleOf = (house, label) => t('house.n', { n: house }) + ' · ' + label;
  const houses = [1, 2, 3, 4].map((h) => ({ h, rooms: s.guestRooms.filter((r) => r.house === h).map((r) => ({ title: titleOf(h, r.label), label: r.label })) }));
  const known = new Set(houses.flatMap((x) => x.rooms.map((r) => r.title)));
  const sel = picked[flow];
  const asked = Object.values(s.assignments).filter((a) => a.kind === 'room' && a.day === day && task && a.task_id === task.id);
  const stateOf = (title) => {
    const a = asked.find((x) => x.title === title);
    return !a ? null : a.status === 'done' ? 'done' : a.assignee ? 'assigned' : 'requested';
  };
  const free = (title) => !stateOf(title);
  const toggle = (title) => setPicked({ ...picked, [flow]: sel.includes(title) ? sel.filter((x) => x !== title) : [...sel, title] });
  const toggleHouse = (rooms) => {
    const ids = rooms.map((r) => r.title).filter(free);
    const all = ids.length && ids.every((x) => sel.includes(x));
    setPicked({ ...picked, [flow]: all ? sel.filter((x) => !ids.includes(x)) : [...new Set([...sel, ...ids])] });
  };
  const addOther = (e) => {
    e.preventDefault();
    const v = other.trim().slice(0, 40);
    if (v && free(v) && !sel.includes(v)) setPicked({ ...picked, [flow]: [...sel, v] });
    setOther('');
  };
  const extras = sel.filter((x) => !known.has(x));

  async function send() {
    if (!sel.length || busy) return;
    setBusy(true);
    try {
      await ensureMonth(monthKey(parseYmd(day)));
      await askRoomCleaning(day, flow, sel, note.trim());
      toast(t('rooms.sent', { n: sel.length }));
      setPicked({ ...picked, [flow]: [] }); setNote('');
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }

  const mine = assignmentsOn(day).filter((a) => a.kind === 'room' && a.requested_by === s.profile.id && s.tasks[a.task_id]);
  const count = (k) => picked[k].length;

  return html`<div class="stack rec-page">
    <header class="my-head">
      <h2 class="my-title">${t('rec.title')}</h2>
      <p class="my-date">${t('rec.sub')}</p>
    </header>

    <div class="rec-days" role="group" aria-label=${t('rooms.day')}>
      <button type="button" class=${'pick' + (day === today ? ' on' : '')} aria-pressed=${day === today} onClick=${() => setDay(today)}>${t('chat.today')}</button>
      <button type="button" class=${'pick' + (day === tomorrow ? ' on' : '')} aria-pressed=${day === tomorrow} onClick=${() => setDay(tomorrow)}>${t('rooms.tomorrow')}</button>
      <${DateField} value=${day} label=${t('rec.otherDay')} onChange=${setDay} />
    </div>

    <${Segmented} value=${flow} onChange=${setFlow} label=${t('rec.title')} options=${FLOWS.map((f) => ({ value: f.key, icon: f.icon,
      label: t('flow.' + f.key) + ' · ' + f.time + (count(f.key) ? ' (' + count(f.key) + ')' : '') }))} />
    <p class=${'rec-hint ' + flow}><${Icon} name=${flow === 'checkout' ? 'sparkles-2' : 'key'} size=${22} />${t('flow.' + flow + 'Hint')}</p>

    ${!task ? html`<div class="card slim note-soft"><${Icon} name="info-circle" size=${24} /><span>${t('rec.noFlow')}</span></div>` : null}

    <div class="rec-houses">
      ${houses.map(({ h, rooms }) => html`<section class="rec-house" key=${h} aria-label=${t('house.n', { n: h })}>
        <header><h3>${t('house.n', { n: h })}</h3>
          <button type="button" class="pick" onClick=${() => toggleHouse(rooms)}>${t('rec.selectAll')}</button></header>
        <div class="rec-rooms">
          ${rooms.map((r) => {
            const st = stateOf(r.title), on = sel.includes(r.title);
            return html`<button type="button" key=${r.title} role="checkbox" aria-checked=${on || !!st} disabled=${!!st || !task}
              class=${'rec-room' + (on ? ' on' : '') + (st ? ' ' + st : '')} onClick=${() => toggle(r.title)}>
              <span class="rec-box"><${Icon} name="check" size=${20} /></span>
              <b>${r.label}</b>
              ${st ? html`<small>${t('rec.' + st)}</small>` : null}
            </button>`;
          })}
        </div>
      </section>`)}
    </div>

    <form class="rec-other" onSubmit=${addOther}>
      <input class="input" maxlength="40" value=${other} placeholder=${t('rec.otherPh')} aria-label=${t('rec.other')} onInput=${(e) => setOther(e.target.value)} />
      <button type="submit" class="btn small soft" disabled=${!other.trim()}><${Icon} name="plus" size=${18} />${t('rec.add')}</button>
    </form>
    ${extras.length ? html`<div class="chips">${extras.map((x) => html`<button type="button" class="pick on" key=${x} aria-label=${t('common.remove') + ' ' + x} onClick=${() => toggle(x)}>${x}<${Icon} name="x" size=${14} /></button>`)}</div>` : null}

    <${Field} label=${t('rec.note')}>
      <input class="input" maxlength="300" value=${note} onInput=${(e) => setNote(e.target.value)} />
    <//>

    <div class="rec-foot">
      <button type="button" class="btn big-btn" disabled=${!sel.length || busy || !task} onClick=${send}>
        <${Icon} name="send" size=${24} />${sel.length ? t('rec.sendN', { n: sel.length }) : t('rec.send')}</button>
    </div>

    ${mine.length ? html`<section class="rise">
      <h3 class="section-title">${t('rec.myRequests')}<span class="count">${mine.length}</span></h3>
      <div class="list tight">${mine.map((a) => html`<${AssignmentRow} key=${a.id} a=${a} onOpen=${setOpen} showPerson=${true} />`)}</div>
    </section>` : null}

    ${open ? html`<${AssignmentSheet} id=${open} onClose=${() => setOpen(null)} />` : null}
  </div>`;
}
