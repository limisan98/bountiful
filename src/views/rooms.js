import { html, useState } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Avatar, Field, Sheet, PersonLine, Empty, useSheetControl } from '../ui.js';
import { isSupervisor, roleInfo, departmentOf } from '../roles.js';
import { roomsOn, addRooms, editRoom, assignRooms, setRoomStatus, removeRoom, activePeople, roomGoalMin } from '../data.js';
import { ROLE_ORDER } from '../config.js';
import { DateField } from '../pickers.js';
import { ymd, parseYmd, addDays, todayYmd, fmt, dur } from '../time.js';
import { TimerSheet, LiveClock } from './timer.js';

// Rooms to clean. Reception lists them, the Custodian Supervisor chooses who cleans them,
// and that custodian marks them done. Each person only sees what is theirs to do.
export function RoomsView() {
  const s = useStore();
  const me = s.profile;
  const sup = isSupervisor(me);
  const rec = departmentOf(me) === 'reception';
  const [day, setDay] = useState(() => {
    // open on today, or on the nearest day that has rooms for you when today is empty
    const days = Object.values(s.rooms).map((r) => r.day).sort();
    const today = todayYmd();
    return days.includes(today) ? today : days.find((d) => d > today) || today;
  });
  const [sel, setSel] = useState([]);
  const [adding, setAdding] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const date = parseYmd(day);
  const list = roomsOn(day);
  const go = (n) => { setDay(ymd(addDays(date, n))); setSel([]); };
  const label = day === todayYmd() ? t('chat.today') : day === ymd(addDays(new Date(), 1)) ? t('rooms.tomorrow') : fmt(date, { weekday: 'long' });
  const toggle = (id) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);

  const waiting = list.filter((r) => !r.assignee);
  const people = {};
  list.filter((r) => r.assignee).forEach((r) => { (people[r.assignee] = people[r.assignee] || []).push(r); });
  const names = Object.keys(people).sort((a, b) => ((s.profiles[a] || {}).display_name || '').localeCompare((s.profiles[b] || {}).display_name || ''));
  const done = list.filter((r) => r.status === 'done').length;
  const chosen = sel.filter((id) => s.rooms[id] && s.rooms[id].day === day);

  const row = (r) => html`<${RoomRow} key=${r.id} r=${r} selectable=${sup && r.status !== 'done'} selected=${chosen.includes(r.id)} onToggle=${() => toggle(r.id)} />`;

  return html`<div class="stack rooms">
    <div class="page-head">
      <div>
        <h2 class="page-title">${t('rooms.title')}</h2>
        <p class="page-sub">${sup ? t('rooms.subSup') : rec ? t('rooms.subRec') : t('rooms.subCus')}</p>
      </div>
    </div>

    <div class="cal-head">
      <div class="rooms-day" key=${day}>
        <h3 class="cal-title">${label}</h3>
        <span class="muted">${fmt(date, { day: 'numeric', month: 'long' })}${list.length ? ` · ${t('rooms.progress', { done, total: list.length })}` : ''}</span>
      </div>
      <div class="cal-nav">
        <button class="icon-btn" aria-label="previous" onClick=${() => go(-1)}><${Icon} name="caret-left" size=${20} /></button>
        <button class="icon-btn" aria-label="next" onClick=${() => go(1)}><${Icon} name="caret-right" size=${20} /></button>
      </div>
    </div>

    <${DayOverview} day=${day} onPick=${(d) => { setDay(d); setSel([]); }} />

    ${!list.length ? html`<${Empty} icon="bed" text=${rec ? t('rooms.noneRec') : sup ? t('rooms.none') : t('rooms.noneCus')} />` : null}

    ${waiting.length ? html`<section class="rise">
      <h3 class="section-title">${t('rooms.waiting')}<span class="count">${waiting.length}</span></h3>
      ${sup ? html`<p class="field-hint">${t('rooms.selectHint')}</p>` : null}
      <div class="list tight">${waiting.map(row)}</div>
    </section>` : null}

    ${names.map((id) => html`<section class="rise" key=${id}>
      <h3 class="section-title room-who"><${Avatar} profile=${s.profiles[id]} size=${28} />${s.profiles[id] ? s.profiles[id].display_name : t('chat.former')}<span class="count">${people[id].length}</span></h3>
      <div class="list tight">${people[id].map(row)}</div>
    </section>`)}

    ${rec ? html`<button class="fab float pop" aria-label=${t('rooms.add')} onClick=${() => setAdding(true)}><${Icon} name="plus" size=${26} /></button>` : null}

    ${sup && chosen.length ? html`<div class="room-bar pop">
      <span><b>${t('rooms.selected', { n: chosen.length })}</b></span>
      <button class="btn small auto soft" onClick=${() => setSel([])}>${t('common.cancel')}</button>
      <button class="btn small auto" onClick=${() => setAssigning(true)}><${Icon} name="user" size=${16} />${t('rooms.giveTo')}</button>
    </div>` : null}

    ${adding ? html`<${AddRooms} day=${day} onDay=${setDay} onClose=${() => setAdding(false)} />` : null}
    ${assigning ? html`<${AssignRooms} ids=${chosen} onClose=${() => setAssigning(false)} onDone=${() => setSel([])} />` : null}
  </div>`;
}

// A strip of day cards above the list: Reception sees what they asked for, a custodian sees the rooms given to them,
// the supervisor sees every day with who is cleaning how many. Tap a card to open that day.
function DayOverview({ day, onPick }) {
  const s = useStore();
  const me = s.profile;
  const sup = isSupervisor(me);
  const rec = departmentOf(me) === 'reception';
  const today = todayYmd();
  const weekAgo = ymd(addDays(new Date(), -7));
  const mine = Object.values(s.rooms).filter((r) => (sup ? true : rec ? r.requested_by === me.id : r.assignee === me.id) && (rec || r.day >= weekAgo));
  if (!mine.length) return null;
  const byDay = {};
  mine.forEach((r) => { (byDay[r.day] = byDay[r.day] || []).push(r); });
  const days = Object.keys(byDay).sort((a, b) => (a >= today) === (b >= today) ? (a >= today ? a.localeCompare(b) : b.localeCompare(a)) : (a >= today ? -1 : 1));
  const n = (rows, f) => rows.filter(f).length;
  const chips = (rows) => {
    if (sup) {
      const per = {};
      rows.filter((r) => r.assignee).forEach((r) => { per[r.assignee] = (per[r.assignee] || 0) + 1; });
      const out = [];
      if (n(rows, (r) => !r.assignee)) out.push(['waiting', t('rooms.sum.waiting', { n: n(rows, (r) => !r.assignee) })]);
      Object.keys(per).forEach((id) => out.push(['person', `${s.profiles[id] ? s.profiles[id].display_name.split(' ')[0] : t('chat.former')} · ${per[id]}`]));
      return out;
    }
    const L = rec ? 'sum' : 'sumMe';
    return [
      rec ? ['waiting', n(rows, (r) => !r.assignee)] : null,
      ['todo', n(rows, (r) => r.assignee && r.status === 'todo')],
      ['doing', n(rows, (r) => r.status === 'doing')],
      ['done', n(rows, (r) => r.status === 'done')],
    ].filter((c) => c && c[1]).map(([k, c]) => [k, t(`rooms.${L}.${k}`, { n: c })]);
  };
  const dayName = (d) => d === today ? t('chat.today') : d === ymd(addDays(new Date(), 1)) ? t('rooms.tomorrow') : fmt(parseYmd(d), { weekday: 'short', day: 'numeric', month: 'short' });
  const title = sup ? t('rooms.allSup') : rec ? t('rooms.mine') : t('rooms.mineCus');
  const hint = sup ? t('rooms.allSupHint') : rec ? t('rooms.mineHint') : t('rooms.mineCusHint');
  return html`<section class="rise my-requests">
    <h3 class="section-title">${title}<span class="count">${mine.length}</span></h3>
    <p class="field-hint">${hint}</p>
    <div class="req-list">${days.map((d) => html`<button type="button" key=${d} class=${'req-day' + (d === day ? ' on' : '') + (d < today ? ' past' : '')} onClick=${() => onPick(d)}>
      <span class="req-top"><b>${dayName(d)}</b><span class="muted">${t('rooms.count', { n: byDay[d].length })}</span></span>
      <span class="req-chips">${chips(byDay[d]).map(([k, label]) => html`<span key=${label} class=${'req-chip ' + k}>${label}</span>`)}</span>
    </button>`)}</div>
  </section>`;
}

function RoomRow({ r, selectable, selected, onToggle }) {
  const s = useStore();
  const me = s.profile;
  const who = s.profiles[r.assignee];
  const name = who ? who.display_name.split(' ')[0] : t('chat.former');
  const mine = r.assignee === me.id;
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [timing, setTiming] = useState(false);
  const goal = roomGoalMin();
  const canEdit = r.requested_by === me.id && r.status !== 'done';
  const canDelete = isSupervisor(me) || (r.requested_by === me.id && !r.assignee);
  const state = !r.assignee ? 'waiting' : r.status;

  async function act(fn) {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }
  const del = () => { if (!sure) { setSure(true); setTimeout(() => setSure(false), 3000); return; } act(() => removeRoom(r.id)); };
  const body = html`<span class="room-ic"><${Icon} name=${r.status === 'done' ? 'circle-check' : 'bed'} size=${22} /></span>
    <span class="room-main">
      <b class="room-name">${r.room}</b>
      <span class=${'room-state ' + state}>${t('rooms.state.' + state, { name })}</span>
      ${r.status === 'doing' && r.started_at ? html`<span class="room-time"><${Icon} name="hourglass" size=${13} /><${LiveClock} startedAt=${r.started_at} /> · ${t('timer.goal', { time: dur(goal) })}</span>` : null}
      ${r.status === 'done' && r.minutes_spent != null ? html`<span class="room-time done"><${Icon} name="clock" size=${13} />${t('rooms.took', { time: dur(r.minutes_spent), goal: dur(goal) })}</span>` : null}
      ${mine && r.status === 'todo' ? html`<span class="room-time"><${Icon} name="alarm" size=${13} />${t('timer.goal', { time: dur(goal) })}</span>` : null}
      ${r.note ? html`<span class="room-note">${r.note}</span>` : null}
    </span>`;

  return html`<div class=${'room ' + state + (selected ? ' selected' : '')}>
    ${selectable
      ? html`<button type="button" class="room-pick" aria-pressed=${selected} onClick=${onToggle}>
          <span class=${'room-check' + (selected ? ' on' : '')}><${Icon} name="check" size=${16} /></span>${body}</button>`
      : html`<div class="room-pick static">${body}</div>`}
    <div class="room-actions">
      ${mine && r.status === 'todo' ? html`<button class="btn small auto soft" disabled=${busy} onClick=${() => act(async () => { await setRoomStatus(r.id, 'doing'); setTiming(true); })}><${Icon} name="hourglass" size=${16} />${t('rooms.start')}</button>` : null}
      ${mine && r.status === 'doing' ? html`<button class="btn small auto soft" onClick=${() => setTiming(true)}><${Icon} name="hourglass" size=${16} />${t('timer.open')}</button>` : null}
      ${mine && r.status !== 'done' ? html`<button class="btn small auto" disabled=${busy} onClick=${() => act(() => setRoomStatus(r.id, 'done'))}><${Icon} name="circle-check" size=${16} />${t('rooms.finish')}</button>` : null}
      ${(mine || isSupervisor(me)) && r.status === 'done' ? html`<button class="btn small auto soft" disabled=${busy} onClick=${() => act(() => setRoomStatus(r.id, 'todo'))}>${t('rooms.reopen')}</button>` : null}
      ${canEdit ? html`<button class="pick" aria-label=${t('rooms.edit')} onClick=${() => setEditing(true)}><${Icon} name="pencil" size=${15} /></button>` : null}
      ${canDelete ? html`<button class=${'pick danger' + (sure ? ' sure' : '')} aria-label=${t('act.remove')} onClick=${del}><${Icon} name="trash" size=${15} />${sure ? t('team.removeSure') : ''}</button>` : null}
    </div>
    ${editing ? html`<${EditRoom} r=${r} onClose=${() => setEditing(false)} />` : null}
    ${timing && mine && r.status === 'doing' ? html`<${TimerSheet} title=${r.room} icon="bed" color="#86E3CE" startedAt=${r.started_at} goal=${goal}
      finishLabel=${t('rooms.finish')} onFinish=${() => { setTiming(false); act(() => setRoomStatus(r.id, 'done')); }} onClose=${() => setTiming(false)} />` : null}
  </div>`;
}

// ---- Reception: change a room you asked for ----
function EditRoom({ r, onClose }) {
  const ctl = useSheetControl();
  const [room, setRoom] = useState(r.room);
  const [date, setDate] = useState(r.day);
  const [note, setNote] = useState(r.note || '');
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    if (!room.trim() || busy) return;
    setBusy(true);
    try { await editRoom(r.id, room.trim().slice(0, 40), date, note.trim()); toast(t('rooms.saved')); ctl.close(); }
    catch (ex) { toast(friendlyError(ex), 'bad'); setBusy(false); }
  }
  return html`<${Sheet} title=${t('rooms.editTitle')} onClose=${onClose} control=${ctl}>
    <form class="stack-form" onSubmit=${save}>
      <${Field} label=${t('rooms.roomName')}><input class="input" type="text" maxlength="40" required value=${room} onInput=${(e) => setRoom(e.target.value)} /><//>
      <${Field} label=${t('rooms.day')}><${DateField} value=${date} label=${t('rooms.day')} onChange=${setDate} /><//>
      <${Field} label=${t('rooms.note')}><input class="input" type="text" maxlength="300" value=${note} onInput=${(e) => setNote(e.target.value)} /><//>
      <button class="btn" type="submit" disabled=${!room.trim() || busy}><${Icon} name="check" size=${18} />${t('rooms.save')}</button>
    </form>
  <//>`;
}

// ---- Reception: list the rooms that need cleaning ----
function AddRooms({ day, onDay, onClose }) {
  const ctl = useSheetControl();
  const [date, setDate] = useState(day === todayYmd() ? ymd(addDays(new Date(), 1)) : day);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const rooms = [...new Set(text.split(/[,;\n]/).map((x) => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 40);

  async function save(e) {
    e.preventDefault();
    if (!rooms.length || busy) return;
    setBusy(true);
    try {
      await addRooms(rooms.map((room) => ({ day: date, room, note: note.trim() })));
      toast(t('rooms.sent', { n: rooms.length }));
      onDay(date);
      ctl.close();
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }
  return html`<${Sheet} title=${t('rooms.addTitle')} onClose=${onClose} control=${ctl}>
    <form class="stack-form" onSubmit=${save}>
      <${Field} label=${t('rooms.day')}><${DateField} value=${date} label=${t('rooms.day')} onChange=${setDate} /><//>
      <${Field} label=${t('rooms.list')} hint=${t('rooms.listHint')}>
        <textarea class="input area" rows="2" maxlength="400" required value=${text} placeholder="4, 7, 12" onInput=${(e) => setText(e.target.value)}></textarea>
      <//>
      ${rooms.length ? html`<div class="chips pop">${rooms.map((r) => html`<span class="chip role" key=${r} style="--c:var(--mint);--soft:var(--brand-soft);--ink:var(--brand-ink)">${r}</span>`)}</div>` : null}
      <${Field} label=${t('rooms.note')}>
        <input class="input" type="text" maxlength="300" value=${note} onInput=${(e) => setNote(e.target.value)} />
      <//>
      <button class="btn" type="submit" disabled=${!rooms.length || busy}><${Icon} name="send" size=${18} />${rooms.length > 1 ? t('rooms.sendN', { n: rooms.length }) : t('rooms.send')}</button>
    </form>
  <//>`;
}

// ---- Custodian Supervisor: choose who cleans the selected rooms ----
function AssignRooms({ ids, onClose, onDone }) {
  const s = useStore();
  const ctl = useSheetControl();
  const [busy, setBusy] = useState(false);
  const today = ids.length ? s.rooms[ids[0]].day : todayYmd();
  const crew = activePeople().filter((p) => roleInfo(p.role).department === 'custodian')
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.display_name.localeCompare(b.display_name));
  const load = (id) => roomsOn(today).filter((r) => r.assignee === id && r.status !== 'done').length;
  const anyAssigned = ids.some((id) => s.rooms[id] && s.rooms[id].assignee);

  async function give(person) {
    if (busy) return;
    setBusy(true);
    try {
      await assignRooms(ids, person);
      toast(person ? t('rooms.given', { n: ids.length, name: s.profiles[person].display_name.split(' ')[0] }) : t('rooms.takenBack'));
      onDone();
      ctl.close();
    } catch (ex) { toast(friendlyError(ex), 'bad'); setBusy(false); }
  }
  return html`<${Sheet} title=${t('rooms.assignTitle')} kicker=${t('rooms.selected', { n: ids.length })} onClose=${onClose} control=${ctl}>
    <div class="list tight">
      ${crew.map((p) => html`<button type="button" class="person" key=${p.id} disabled=${busy} onClick=${() => give(p.id)}>
        <${PersonLine} profile=${p} size=${44} extra=${load(p.id) ? html`<span class="count">${t('rooms.load', { n: load(p.id) })}</span>` : null} />
      </button>`)}
      ${!crew.length ? html`<p class="muted">${t('rooms.noCrew')}</p>` : null}
    </div>
    ${anyAssigned ? html`<button class="btn soft" disabled=${busy} onClick=${() => give(null)}>${t('rooms.takeBack')}</button>` : null}
  <//>`;
}
