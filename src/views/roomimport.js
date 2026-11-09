import { html, useState, useRef } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Sheet, Segmented, Field, useSheetControl } from '../ui.js';
import { DateField } from '../pickers.js';
import { askRoomCleaning } from '../data.js';
import { readXlsx } from '../xlsx.js';
import { parseRooms, parseRoomText, parseDelimited, readTextFile } from '../roomimport.js';
import { todayYmd, parseYmd, fmt } from '../time.js';

// The supervisor gets the list of rooms to clean by email: drop the file (Excel / CSV / text) or paste the text,
// check what was found, and press the big button. The rooms become cleaning requests, ready to give out.
// the notes under a day's rooms: each different note once, with the room numbers it belongs to (no numbers when it is for all of them)
function noteLines(items) {
  const by = new Map();
  items.forEach((i) => { if (i.note) by.set(i.note, [...(by.get(i.note) || []), i.code]); });
  return [...by].map(([text, codes]) => ({ text, codes: codes.length === items.length ? '' : codes.join(', ') }));
}

export function RoomImportSheet({ onClose }) {
  const s = useStore();
  const ctl = useSheetControl();
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [paste, setPaste] = useState('');
  const [res, setRes] = useState(null);       // { items, sawDay, sawFlow }
  const [off, setOff] = useState({});         // item id -> true when unticked
  const [defDay, setDefDay] = useState(todayYmd());
  const [defFlow, setDefFlow] = useState('checkout');
  const [saving, setSaving] = useState(false);
  const known = new Set(s.guestRooms.map((r) => r.label));
  const dateOrder = s.lang === 'en' ? 'mdy' : 'dmy';

  function show(r, name) {
    if (!r.items.length) { setRes(null); setError(t('rimp.nothing')); return; }
    setError(''); setOff({}); setFileName(name || ''); setRes(r);
  }
  async function onFile(file) {
    if (!file) return;
    setBusy(true); setError('');
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const book = await readXlsx(await file.arrayBuffer());
        const rows = book.sheets.flatMap((sh) => sh.rows);
        show(parseRooms(rows, { dateOrder }), file.name);
      } else if (/\.(csv|txt|tsv)$/i.test(file.name)) {
        const text = await readTextFile(file);
        show(/\.txt$/i.test(file.name) ? parseRoomText(text, { dateOrder }) : parseRooms(parseDelimited(text), { dateOrder }), file.name);
      } else setError(t('rimp.formats'));
    } catch (ex) { if (ex.message !== 'not-xlsx') console.error(ex); setError(t('imp.readError')); }
    setBusy(false);
  }
  const onDrop = (e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); };

  // group what was found by day + type (rows with no date / type use the two choices at the top)
  const items = res ? res.items.map((i) => ({ ...i, eday: i.day || defDay, eflow: i.flow || defFlow })) : [];
  const groups = [];
  items.forEach((i) => {
    let g = groups.find((x) => x.day === i.eday && x.flow === i.eflow);
    if (!g) { g = { day: i.eday, flow: i.eflow, items: [] }; groups.push(g); }
    g.items.push(i);
  });
  groups.sort((a, b) => a.day.localeCompare(b.day) || a.flow.localeCompare(b.flow));
  const chosen = items.filter((i) => !off[i.id]);
  const needsDay = res && !res.sawDay, needsFlow = res && !res.sawFlow;

  async function save() {
    if (!chosen.length || saving) return;
    setSaving(true);
    try {
      let made = 0;
      for (const g of groups) {
        // rooms with the same note go together (a note shows on the room's task)
        const notes = [...new Set(g.items.filter((i) => !off[i.id]).map((i) => i.note || ''))];
        for (const n of notes) {
          const codes = g.items.filter((i) => !off[i.id] && (i.note || '') === n).map((i) => i.code);
          if (codes.length) made += (await askRoomCleaning(g.day, g.flow, codes, n)).length;
        }
      }
      toast(t('rimp.done', { n: made }) + (made < chosen.length ? ' · ' + t('rimp.dupes', { n: chosen.length - made }) : ''));
      ctl.close();
    } catch (ex) { toast(friendlyError(ex), 'bad'); setSaving(false); }
  }

  return html`<${Sheet} title=${t('rimp.title')} onClose=${onClose} control=${ctl}>
    ${!res ? html`<p class="muted">${t('rimp.sub')}</p>
      <div class=${'drop-zone' + (over ? ' over' : '')} onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)} onDrop=${onDrop}>
        <span class="drop-ic"><${Icon} name=${busy ? 'hourglass' : 'arrow-badge-down'} size=${40} /></span>
        <b>${busy ? t('imp.working') : t('imp.drop')}</b>
        <span class="muted">${t('imp.or')}</span>
        <button type="button" class="btn" disabled=${busy} onClick=${() => input.current && input.current.click()}><${Icon} name="clipboard-data" size=${22} />${t('imp.choose')}</button>
        <input ref=${input} type="file" hidden accept=".xlsx,.csv,.tsv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange=${(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; onFile(f); }} />
      </div>
      <p class="field-hint">${t('rimp.formats')}</p>
      <${Field} label=${t('rimp.paste')} hint=${t('rimp.pasteHint')}>
        <textarea class="input" rows="5" value=${paste} onInput=${(e) => setPaste(e.target.value)}></textarea>
      <//>
      <button type="button" class="btn soft" disabled=${!paste.trim()} onClick=${() => show(parseRoomText(paste, { dateOrder }), '')}><${Icon} name="search" size=${22} />${t('rimp.read')}</button>
      ${error ? html`<div class="card slim waiting-card" role="alert"><${Icon} name="alert-triangle" size=${24} /><span>${error}</span></div>` : null}`

    : html`
      <p class="muted small-text imp-file"><${Icon} name="clipboard-data" size=${16} /><b>${fileName || t('rimp.pasted')}</b> · ${t('rimp.found', { n: items.length })}
        <button type="button" class="pick ghost" onClick=${() => { setRes(null); setFileName(''); }}>${t('imp.again')}</button></p>

      ${needsDay || needsFlow ? html`<section class="imp-fix">
        ${needsDay ? html`<${Field} label=${t('rimp.defDay')}><${DateField} value=${defDay} label=${t('rimp.defDay')} onChange=${setDefDay} /><//>` : null}
        ${needsFlow ? html`<${Field} label=${t('rimp.defFlow')}><${Segmented} label=${t('rimp.defFlow')} value=${defFlow} onChange=${setDefFlow}
          options=${[{ value: 'checkout', label: t('flow.checkout') }, { value: 'checkin', label: t('flow.checkin') }]} /><//>` : null}
        <p class="field-hint">${t('rimp.defHint')}</p></section>` : null}

      ${groups.map((g) => html`<section class="rimp-group" key=${g.day + g.flow}>
        <h3 class="section-title">${fmt(parseYmd(g.day), { weekday: 'long', day: 'numeric', month: 'long' })} · ${t('flow.' + g.flow)}<span class="count">${g.items.filter((i) => !off[i.id]).length}</span></h3>
        <div class="rimp-chips">${g.items.map((i) => html`<button type="button" key=${i.id} aria-pressed=${!off[i.id]}
          class=${'rimp-chip' + (off[i.id] ? ' off' : '') + (known.has(i.code) ? '' : ' unknown')} onClick=${() => setOff({ ...off, [i.id]: !off[i.id] })}>
          <${Icon} name=${off[i.id] ? 'x' : 'check'} size=${16} />${i.code}</button>`)}</div>
        ${noteLines(g.items.filter((i) => !off[i.id])).map((n) => html`<p class="rimp-note" key=${n.text}>${n.codes ? html`<b>${n.codes}</b> ` : null}${n.text}</p>`)}
      </section>`)}
      ${items.some((i) => !known.has(i.code)) ? html`<p class="field-hint"><${Icon} name="alert-triangle" size=${14} /> ${t('rimp.unknownHint')}</p>` : null}
      <p class="field-hint">${t('rimp.tapHint')}</p>

      <div class="imp-foot">
        <button class="btn big-btn" disabled=${!chosen.length || saving} onClick=${save}><${Icon} name="circle-check" size=${24} />${t('rimp.create', { n: chosen.length })}</button>
      </div>`}
  <//>`;
}
