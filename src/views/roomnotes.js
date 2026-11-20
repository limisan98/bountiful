import { html, render, useState, useEffect, useRef } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Avatar } from '../ui.js';
import { isSupervisor } from '../roles.js';
import { fmt, parseYmd } from '../time.js';
import { trFor } from '../translate.js';
import { roomNotesOf, addRoomNote, removeRoomNote } from '../data.js';

// Notes on a guest room. A small floating card over the page (no dark backdrop, the list stays visible and usable behind it).
// It is drawn into its own element on <body>, so it floats the same way wherever the room tile is.
let host = null;
export function openRoomNotes(room, title) {
  closeRoomNotes();
  host = document.createElement('div');
  host.className = 'rn-host';
  document.body.appendChild(host);
  render(html`<${RoomNotes} room=${room} title=${title} key=${room} />`, host);
}
export function closeRoomNotes() {
  if (!host) return;
  render(null, host); host.remove(); host = null;
}

function RoomNotes({ room, title }) {
  const heading = title || t('rn.title', { room });
  const s = useStore();
  const me = s.profile;
  const notes = roomNotesOf(room);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef(null);
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [notes.length]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeRoomNotes(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  async function send(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try { await addRoomNote(room, body); setText(''); } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }
  const when = (n) => fmt(parseYmd(n.day), { weekday: 'short', day: 'numeric', month: 'short' });
  return html`<section class="rn-panel" role="dialog" aria-label=${heading}>
    <header class="rn-head">
      <span class="rn-ic"><${Icon} name="message" size=${20} /></span>
      <b>${heading}</b>
      <button type="button" class="pick" aria-label=${t('common.close')} onClick=${closeRoomNotes}><${Icon} name="x" size=${16} /></button>
    </header>
    <div class="rn-list" ref=${list}>
      ${notes.length ? notes.map((n) => {
        const p = s.profiles[n.author];
        const mine = n.author === me.id;
        return html`<div class="rn-note" key=${n.id}>
          <${Avatar} profile=${p} name=${p ? p.display_name : ''} size=${28} ring=${false} />
          <div class="rn-body"><span class="rn-who"><b>${p ? p.display_name.split(' ')[0] : ''}</b> · ${when(n)}</span><p>${trFor(n.body, n.author)}</p></div>
          ${mine || isSupervisor(me) ? html`<button type="button" class="rn-del" aria-label=${t('common.remove')} onClick=${() => removeRoomNote(n.id).catch((ex) => toast(friendlyError(ex), 'bad'))}><${Icon} name="trash" size=${16} /></button>` : null}
        </div>`;
      }) : html`<p class="field-hint">${t('rn.empty')}</p>`}
    </div>
    <form class="rn-form" onSubmit=${send}>
      <input type="text" value=${text} maxlength="1000" placeholder=${t('rn.placeholder')} aria-label=${t('rn.placeholder')} onInput=${(e) => setText(e.target.value)} />
      <button type="submit" class="rn-send" disabled=${!text.trim() || busy}><${Icon} name="check" size=${20} />${t('rn.send')}</button>
    </form>
  </section>`;
}
