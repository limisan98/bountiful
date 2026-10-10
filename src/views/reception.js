import { html, useState, useEffect, useRef } from '../../assets/vendor/htm-preact.js';
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
  // room code = [House][Floor][Room], e.g. 322 = house 3, floor 2, room 2
  const [house, setHouse] = useState(1);
  const houses = [1, 2, 3, 4].map((h) => ({ h, floors: [1, 2, 3].map((f) => ({ f, rooms: s.guestRooms.filter((r) => r.house === h && r.floor === f).sort((x, y) => x.num - y.num).map((r) => r.label) })).filter((x) => x.rooms.length) }));
  const known = new Set(s.guestRooms.map((r) => r.label));
  const sel = picked[flow];
  const asked = Object.values(s.assignments).filter((a) => a.kind === 'room' && a.day === day && task && a.task_id === task.id);
  const stateOf = (title) => {
    const a = asked.find((x) => x.title === title);
    return !a ? null : a.status === 'done' ? 'done' : a.assignee ? 'assigned' : 'requested';
  };
  const free = (title) => !stateOf(title);

  // A custodian just finished a room: show it right away (switch to its tab, tile turns green and moves to the top, smooth scroll to it)
  const [fresh, setFresh] = useState(null);
  const seen = useRef(null);
  const doneNow = Object.values(s.assignments).filter((a) => a.kind === 'room' && a.day === day && a.status === 'done' && s.tasks[a.task_id] && s.tasks[a.task_id].room_flow)
    .map((a) => s.tasks[a.task_id].room_flow + ':' + a.title);
  const doneKey = doneNow.slice().sort().join('|');
  useEffect(() => {
    const prev = seen.current;
    seen.current = { day, set: new Set(doneNow) };
    if (!prev || prev.day !== day) return;
    const fresh1 = doneNow.filter((k) => !prev.set.has(k));
    if (!fresh1.length) return;
    const [f, code] = [fresh1[0].split(':')[0], fresh1[0].slice(fresh1[0].indexOf(':') + 1)];
    const room = s.guestRooms.find((r) => r.label === code);
    setFlow(f); if (room) setHouse(room.house);
    setFresh(f + ':' + code);
    toast(t('rec.nowDone', { room: code }));
  }, [doneKey, day]);
  useEffect(() => {
    if (!fresh) return;
    const code = fresh.slice(fresh.indexOf(':') + 1);
    const go = setTimeout(() => {
      const el = document.querySelector('[data-room="' + code + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 80);
    const off = setTimeout(() => setFresh(null), 4000);
    return () => { clearTimeout(go); clearTimeout(off); };
  }, [fresh]);
  const toggle = (title) => setPicked({ ...picked, [flow]: sel.includes(title) ? sel.filter((x) => x !== title) : [...sel, title] });
  const toggleGroup = (rooms) => {
    const ids = rooms.filter(free);
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

  const mine = assignmentsOn(day).filter((a) => a.kind === 'room' && a.requested_by === s.profile.id && s.tasks[a.task_id])
    .sort((x, y) => (x.status === 'done' ? 0 : 1) - (y.status === 'done' ? 0 : 1));
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

    <${Segmented} value=${house} onChange=${setHouse} label=${t('rec.title')} options=${houses.map(({ h, floors }) => {
      const n = floors.reduce((c, x) => c + x.rooms.filter((r) => sel.includes(r)).length, 0);
      return { value: h, label: t('house.n', { n: h }) + (n ? ' (' + n + ')' : '') };
    })} />

    <div class="rec-houses">
      ${houses.filter((x) => x.h === house).map(({ h, floors }) => floors.map(({ f, rooms }) => html`<section class="rec-house" key=${h + '-' + f} aria-label=${t('house.n', { n: h }) + ', ' + t('floor.n', { n: f })}>
        <header><h3>${t('floor.n', { n: f })}</h3>
          <button type="button" class="pick" onClick=${() => toggleGroup(rooms)}>${t('rec.selectAll')}</button></header>
        <div class="rec-rooms">
          ${rooms.slice().sort((a, b) => (stateOf(a) === 'done' ? 0 : 1) - (stateOf(b) === 'done' ? 0 : 1)).map((code) => {
            const st = stateOf(code), on = sel.includes(code);
            return html`<button type="button" key=${code} role="checkbox" aria-checked=${on || !!st} disabled=${!!st || !task} aria-label=${t('house.n', { n: h }) + ', ' + t('floor.n', { n: f }) + ', ' + code}
              data-room=${code} class=${'rec-room' + (on ? ' on' : '') + (st ? ' ' + st : '') + (fresh === flow + ':' + code ? ' fresh' : '')} onClick=${() => toggle(code)}>
              <span class="rec-box"><${Icon} name="check" size=${20} /></span>
              <b>${code}</b>
              ${st ? html`<small class=${'rec-badge ' + st}>${st === 'done' ? html`<${Icon} name="circle-check" size=${14} />` : null}${t('rec.' + st)}</small>` : null}
            </button>`;
          })}
        </div>
      </section>`))}
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
