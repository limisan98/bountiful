import { html, useState, useRef, useEffect } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Avatar, Segmented, Sheet, useSheetControl } from '../ui.js';
import { activePeople, inCrew, ensureMonth, importShiftPlan, setContract } from '../data.js';
import { readXlsx } from '../xlsx.js';
import { parseWorkbook, resolveRows, nameKey, weekdayOf, fmtMin } from '../teamsimport.js';
import { shiftList, shiftName, contractOf, planOf } from '../shifts.js';
import { parseYmd, fmt, hhmm, monthKey } from '../time.js';

const range = (s) => `${hhmm(s.start_time)}–${hhmm(s.end_time)}`;
const PAGE = 120;

// Import the schedule that Microsoft Teams Shifts exports to Excel: drop the file, check the preview, press Import.
// Nothing is saved until the supervisor presses the big button; rows that need a decision are skipped until they are fixed.
export function ImportSheet({ onClose }) {
  const s = useStore();
  const ctl = useSheetControl();
  const input = useRef(null);
  const book = useRef(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [month, setMonth] = useState(null);
  const [nameMap, setNameMap] = useState({});
  const [rowShift, setRowShift] = useState({});
  const [filter, setFilter] = useState('review');
  const [limit, setLimit] = useState(PAGE);
  const [saving, setSaving] = useState(false);

  const dateOrder = s.lang === 'en' ? 'mdy' : 'dmy';

  async function run(opts) {
    const r = parseWorkbook(book.current, { dateOrder, ...opts });
    setSheets(r.candidates);
    if (!r.parsed) { setParsed(null); setError(t('imp.nothing')); return; }
    setError('');
    setParsed(r.parsed);
    setSheet(r.parsed.sheet);
    setMonth(r.parsed.month || opts.month || null);
    setNameMap({}); setRowShift({}); setLimit(PAGE);
    const months = [...new Set(r.parsed.rows.filter((x) => x.day).map((x) => x.day.slice(0, 7)))];
    await Promise.all(months.map((m) => ensureMonth(m).catch(() => {})));
    setFilter(r.parsed.rows.length ? 'review' : 'all');
  }

  async function onFile(file) {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) { setError(t('imp.onlyXlsx')); return; }
    setBusy(true); setError(''); setFileName(file.name);
    try {
      book.current = await readXlsx(await file.arrayBuffer());
      await run({});
    } catch (ex) { if (ex.message !== 'not-xlsx') console.error(ex); setParsed(null); setError(t('imp.readError')); }
    setBusy(false);
  }
  const onDrop = (e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); };

  // ---- check every row against our people, shifts and rules
  const people = activePeople().map((p) => ({ ...p, crew: inCrew(p) }));
  const crew = people.filter((p) => p.crew).sort((a, b) => a.display_name.localeCompare(b.display_name));
  const shifts = shiftList();
  const rows = parsed ? resolveRows(parsed.rows, {
    people, shifts, nameMap, rowShift, contractOf, planOf: (id, day) => planOf(id, day),
  }) : [];
  const count = (st) => rows.filter((r) => r.status === st).length;
  const ok = rows.filter((r) => r.status === 'ok');
  const review = rows.filter((r) => r.status === 'review');
  const shown = rows.filter((r) => (filter === 'review' ? r.status === 'review' : filter === 'ready' ? r.status === 'ok' || r.status === 'same' : true));

  // the names nobody could match, once each
  const unknown = [];
  review.forEach((r) => { if (r.issues.includes('name')) { const k = nameKey(r.name); const u = unknown.find((x) => x.key === k); if (u) u.n += 1; else unknown.push({ key: k, name: r.name, n: 1 }); } });
  // people whose contract does not fit the shifts in the file
  const contractFix = [];
  review.forEach((r) => {
    const bad = r.issues.find((i) => i === 'contract4' || i === 'contract8');
    if (!bad || !r.person) return;
    const f = contractFix.find((x) => x.person.id === r.person.id);
    if (f) f.n += 1; else contractFix.push({ person: r.person, n: 1, to: bad === 'contract4' ? 480 : 240 });
  });

  async function fixContract(f) {
    try { await setContract(f.person.id, f.to); toast(t('shift.contractSaved')); } catch (ex) { toast(friendlyError(ex), 'bad'); }
  }
  function chooseShift(row, value) {
    // an unrecognised written time ("8-12:30") picked once is used for every row that has the same text and fits its weekday
    setRowShift((m) => {
      const next = { ...m, [row.id]: value };
      if (value !== 'skip' && row.issues.includes('shift')) {
        const sh = shifts.find((x) => x.id === value);
        rows.forEach((o) => { if (o.id !== row.id && o.issues.includes('shift') && o.raw === row.raw && sh && sh.weekdays.includes(weekdayOf(o.day))) next[o.id] = value; });
      }
      return next;
    });
  }

  async function save() {
    if (!ok.length || saving) return;
    setSaving(true);
    try {
      const r = await importShiftPlan(ok.map((x) => ({ user_id: x.person.id, day: x.day, shift_id: x.shift.id })));
      toast(r.failed.length ? t('imp.donePartial', { n: r.saved, m: r.failed.length }) : t('imp.done', { n: r.saved }), r.failed.length ? 'bad' : 'ok');
      ctl.close();
    } catch (ex) { toast(friendlyError(ex), 'bad'); setSaving(false); }
  }

  const monthNames = Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1).toLocaleDateString(undefined, { month: 'long' }));
  const curMonth = month || monthKey(new Date());
  const years = [new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1];

  return html`<${Sheet} title=${t('imp.title')} onClose=${onClose} control=${ctl} wide=${!!parsed}>
    ${!parsed ? html`<p class="muted">${t('imp.sub')}</p>
      <div class=${'drop-zone' + (over ? ' over' : '')} onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)} onDrop=${onDrop}>
        <span class="drop-ic"><${Icon} name=${busy ? 'hourglass' : 'arrow-badge-down'} size=${40} /></span>
        <b>${busy ? t('imp.working') : t('imp.drop')}</b>
        <span class="muted">${t('imp.or')}</span>
        <button type="button" class="btn" disabled=${busy} onClick=${() => input.current && input.current.click()}><${Icon} name="clipboard-data" size=${22} />${t('imp.choose')}</button>
        <input ref=${input} type="file" hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange=${(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; onFile(f); }} />
      </div>
      ${error ? html`<div class="card slim waiting-card" role="alert"><${Icon} name="alert-triangle" size=${24} /><span>${error}</span></div>` : null}
      <p class="field-hint">${t('imp.formats')}</p>`

    : html`
      <div class="imp-summary">
        <div class="imp-stat ok"><b>${ok.length + count('same')}</b><span>${t('imp.ready')}</span></div>
        <div class=${'imp-stat' + (review.length ? ' bad' : '')}><b>${review.length}</b><span>${t('imp.review')}</span></div>
        <div class="imp-stat"><b>${rows.length}</b><span>${t('imp.found')}</span></div>
      </div>
      <p class="muted small-text imp-file"><${Icon} name="clipboard-data" size=${16} /><b>${fileName}</b> · ${parsed.layout === 'list' ? t('imp.layoutList') : t('imp.layoutGrid')}${parsed.ignored.off ? ' · ' + t('imp.dayOff', { n: parsed.ignored.off }) : ''}${parsed.ignored.open ? ' · ' + t('imp.openIgnored', { n: parsed.ignored.open }) : ''}
        <button type="button" class="pick ghost" onClick=${() => { setParsed(null); setFileName(''); setError(''); }}>${t('imp.again')}</button></p>

      ${sheets.length > 1 ? html`<label class="field"><span class="field-label">${t('imp.sheet')}</span>
        <select class="input" value=${sheet} onChange=${(e) => run({ sheet: e.target.value, month })}>${sheets.map((n) => html`<option key=${n} value=${n}>${n}</option>`)}</select></label>` : null}

      ${parsed.needsMonth ? html`<div class="field"><span class="field-label">${t('imp.month')}</span>
        <div class="time-row">
          <select class="input" value=${+curMonth.slice(5, 7)} onChange=${(e) => run({ sheet, month: curMonth.slice(0, 4) + '-' + String(e.target.value).padStart(2, '0') })}>
            ${monthNames.map((n, i) => html`<option key=${i} value=${i + 1}>${n}</option>`)}</select>
          <select class="input" value=${+curMonth.slice(0, 4)} onChange=${(e) => run({ sheet, month: e.target.value + '-' + curMonth.slice(5, 7) })}>
            ${years.map((y) => html`<option key=${y} value=${y}>${y}</option>`)}</select>
        </div><span class="field-hint">${t('imp.monthHint')}</span></div>` : null}

      ${unknown.length ? html`<section class="imp-fix"><h3 class="section-title">${t('imp.unknownNames')}<span class="count">${unknown.length}</span></h3>
        <div class="list tight">${unknown.map((u) => html`<div class="imp-fix-row" key=${u.key}>
          <div><b>${u.name}</b><span class="muted small-text"> · ${t('imp.rowsN', { n: u.n })}</span></div>
          <select class="input" value=${nameMap[u.key] || ''} aria-label=${u.name} onChange=${(e) => setNameMap({ ...nameMap, [u.key]: e.target.value })}>
            <option value="">${t('imp.pickPerson')}</option>
            ${crew.map((p) => html`<option key=${p.id} value=${p.id}>${p.display_name}</option>`)}
            <option value="skip">${t('imp.skipPerson')}</option>
          </select></div>`)}</div></section>` : null}

      ${contractFix.length ? html`<section class="imp-fix"><h3 class="section-title">${t('imp.contracts')}<span class="count">${contractFix.length}</span></h3>
        <div class="list tight">${contractFix.map((f) => html`<div class="imp-fix-row" key=${f.person.id}>
          <div class="imp-who"><${Avatar} profile=${f.person} size=${34} ring=${false} /><b>${f.person.display_name}</b>
            <span class="muted small-text">${t(f.to === 480 ? 'imp.i.contract4' : 'imp.i.contract8')}</span></div>
          <button type="button" class="btn small soft auto" onClick=${() => fixContract(f)}>${t('imp.setContract', { h: f.to / 60 })}</button></div>`)}</div>
        <p class="field-hint">${t('imp.contractNote')}</p></section>` : null}

      <${Segmented} value=${filter} onChange=${(v) => { setFilter(v); setLimit(PAGE); }} options=${[
        { value: 'review', label: `${t('imp.reviewShort')} (${review.length})` }, { value: 'ready', label: `${t('imp.ready')} (${ok.length + count('same')})` }, { value: 'all', label: t('imp.all') }]} />

      ${shown.length ? html`<table class="imp-table">
        <thead><tr><th>${t('imp.col.person')}</th><th>${t('imp.col.day')}</th><th>${t('imp.col.file')}</th><th>${t('imp.col.shift')}</th><th>${t('imp.col.status')}</th></tr></thead>
        <tbody>${shown.slice(0, limit).map((r) => html`<tr key=${r.id} class=${'imp-row ' + r.status}>
          <td data-l=${t('imp.col.person')}>${r.person ? html`<span class="imp-who"><${Avatar} profile=${r.person} size=${30} ring=${false} /><span><b>${r.person.display_name}</b>${r.note === 'partial' ? html`<small>${t('imp.matchedFrom', { name: r.name })}</small>` : null}</span></span>`
            : html`<span class="imp-who"><span class="imp-q">?</span><span><b>${r.name}</b></span></span>`}</td>
          <td data-l=${t('imp.col.day')}>${r.day ? fmt(parseYmd(r.day), { weekday: 'short', day: 'numeric', month: 'short' }) : '–'}</td>
          <td data-l=${t('imp.col.file')} title=${r.ref}>${r.raw || '–'}</td>
          <td data-l=${t('imp.col.shift')}>${r.shift ? html`<span class="imp-shift"><b>${shiftName(r.shift)}</b><small>${range(r.shift)}</small></span>` : '–'}</td>
          <td data-l=${t('imp.col.status')}>${statusCell(r, shifts, chooseShift, setRowShift, rowShift, s.shifts)}</td>
        </tr>`)}</tbody></table>
        ${shown.length > limit ? html`<button type="button" class="btn soft" onClick=${() => setLimit(limit + PAGE)}>${t('imp.more')}</button>` : null}`
        : html`<p class="muted center">${filter === 'review' ? t('imp.noneToReview') : t('imp.noRows')}</p>`}

      <div class="imp-foot">
        <button class="btn big-btn" disabled=${!ok.length || saving} onClick=${save}><${Icon} name="circle-check" size=${24} />${t('imp.importN', { n: ok.length })}</button>
        ${review.length ? html`<p class="field-hint center">${t('imp.skippedN', { n: review.length })}</p>` : null}
      </div>`}
  <//>`;
}

// the last column: ready / already planned / what is wrong and how to fix it
function statusCell(r, shifts, chooseShift, setRowShift, rowShift) {
  if (r.status === 'skip') return html`<span class="chip small">${t('imp.skipped')}</span>`;
  if (r.status === 'same') return html`<span class="chip small status-chip todo"><${Icon} name="circle-check" size=${14} />${t('imp.same')}</span>`;
  if (r.status === 'ok') {
    const rep = r.note.startsWith('replaces:') ? shifts.find((x) => x.id === r.note.slice(9)) : null;
    return html`<span class="chip small status-chip done"><${Icon} name="circle-check" size=${14} />${t('imp.ok')}</span>${rep ? html`<small class="imp-note">${t('imp.replaces', { shift: shiftName(rep) })}</small>` : null}`;
  }
  const fixable = r.issues.includes('shift') || r.issues.includes('weekday');
  const options = shifts.filter((x) => !r.day || x.weekdays.includes(weekdayOf(r.day)));
  return html`<div class="imp-issues">
    ${r.issues.map((i) => html`<span class="chip small imp-bad" key=${i}><${Icon} name="alert-triangle" size=${13} />${t('imp.i.' + i)}</span>`)}
    ${fixable ? html`<select class="input slim" aria-label=${t('imp.pickShift')} value=${rowShift[r.id] || ''} onChange=${(e) => chooseShift(r, e.target.value)}>
      <option value="">${t('imp.pickShift')}</option>
      ${options.map((x) => html`<option key=${x.id} value=${x.id}>${shiftName(x)} · ${range(x)}</option>`)}
    </select>` : null}
    <button type="button" class="pick ghost imp-skip" onClick=${() => setRowShift({ ...rowShift, [r.id]: 'skip' })}>${t('imp.skip')}</button>
  </div>`;
}
