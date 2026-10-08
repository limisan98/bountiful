import { html, useState, useEffect, useRef } from '../../assets/vendor/htm-preact.js';
import { useStore, toast } from '../store.js';
import { t, friendlyError } from '../i18n.js';
import { Icon, Avatar, Segmented, RoleChip } from '../ui.js';
import { roleInfo, isSupervisor } from '../roles.js';
import { loadMessages, sendMessage, removeMessage, myChannels } from '../data.js';
import { mentionable, mentionTrigger, matchPeople, splitMentions, mentionsMe } from '../mentions.js';
import { ymd, todayYmd, addDays, fmtTimeOfDay, fmt } from '../time.js';

function dayLabel(iso) {
  const d = new Date(iso);
  const k = ymd(d);
  if (k === todayYmd()) return t('chat.today');
  if (k === ymd(addDays(new Date(), -1))) return t('chat.yesterday');
  return fmt(d, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function ChatView() {
  const s = useStore();
  const me = s.profile;
  const sup = isSupervisor(me);
  const channels = myChannels();
  const dep = channels[1];
  const [channel, setChannel] = useState('all');
  const [text, setText] = useState('');
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [caret, setCaret] = useState(0);
  const [hi, setHi] = useState(0);
  const [closedAt, setClosedAt] = useState(-1);
  const listRef = useRef(null);
  const boxRef = useRef(null);
  const stick = useRef(true);
  const cur = s.messages[channel];
  const list = cur ? cur.list : [];

  useEffect(() => {
    stick.current = true;
    setSel(null);
    if (!cur || !cur.loaded) loadMessages(channel).catch((e) => toast(friendlyError(e), 'bad'));
  }, [channel]);

  // keep the newest message in view (unless the reader scrolled up)
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [list.length, channel, cur && cur.loaded]);

  const onScroll = () => {
    const el = listRef.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  const grow = () => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 128) + 'px';
  };

  // @mention suggestions: shown while the cursor sits right after an "@..." the person is typing
  const trig = mentionTrigger(text, caret);
  const suggestions = trig && trig.start !== closedAt ? matchPeople(mentionable(channel), trig.query) : [];
  const open = suggestions.length > 0;
  useEffect(() => { setHi(0); }, [trig && trig.query, open]);

  const track = (e) => setCaret(e.target.selectionStart);
  function pick(p) {
    const el = boxRef.current;
    const at = trig.start, ins = '@' + p.display_name + ' ';
    const next = text.slice(0, at) + ins + text.slice(caret);
    setText(next);
    const pos = at + ins.length;
    setCaret(pos);
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(pos, pos); } grow(); });
  }
  function typeAt() {
    const el = boxRef.current;
    const pos = el ? el.selectionStart : text.length;
    const pre = text.slice(0, pos), need = pre && !/\s$/.test(pre) ? ' ' : '';
    const next = pre + need + '@' + text.slice(pos);
    const np = pre.length + need.length + 1;
    setText(next); setCaret(np); setClosedAt(-1);
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(np, np); } grow(); });
  }

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await sendMessage(channel, body);
      setText(''); setCaret(0); setClosedAt(-1);
      stick.current = true;
      requestAnimationFrame(grow);
    } catch (ex) { toast(friendlyError(ex), 'bad'); }
    setBusy(false);
  }
  const onKey = (e) => {
    if (open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHi((hi + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHi((hi + suggestions.length - 1) % suggestions.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(suggestions[hi]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setClosedAt(trig.start); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer: fine)').matches) { e.preventDefault(); send(); }
  };
  async function more() {
    const el = listRef.current, before = el.scrollHeight;
    stick.current = false;
    try { await loadMessages(channel, true); requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - before; }); }
    catch (ex) { toast(friendlyError(ex), 'bad'); }
  }

  const items = [];
  list.forEach((m, i) => {
    const prev = list[i - 1];
    const newDay = !prev || ymd(new Date(prev.created_at)) !== ymd(new Date(m.created_at));
    const first = newDay || prev.sender !== m.sender || Date.parse(m.created_at) - Date.parse(prev.created_at) > 5 * 60000;
    if (newDay) items.push(html`<div class="day-sep" key=${'d' + m.id}><span>${dayLabel(m.created_at)}</span></div>`);
    items.push(html`<${Bubble} key=${m.id} m=${m} first=${first} mine=${m.sender === me.id} canDelete=${m.sender === me.id || sup}
      selected=${sel === m.id} onSelect=${() => setSel(sel === m.id ? null : m.id)} />`);
  });

  return html`<div class="chat">
    <header class="chat-head">
      <a class="icon-btn" href="#/home" aria-label=${t('nav.home')}><${Icon} name="caret-left" size=${22} /></a>
      <div class="chat-title"><h2>${t('nav.chat')}</h2><span>${channel === 'all' ? t('chat.allSub') : t('chat.deptSub', { dept: t('dept.' + dep) })}</span></div>
    </header>
    <div class="chat-tabs">
      <${Segmented} value=${channel} onChange=${setChannel} options=${[
        { value: 'all', label: t('chat.all'), icon: 'messages' },
        { value: dep, label: t('dept.' + dep), icon: dep === 'reception' ? 'key' : 'sparkles' }]} />
    </div>

    <div class="chat-list" ref=${listRef} onScroll=${onScroll}>
      <div class="chat-inner">
        ${cur && cur.more && list.length >= 60 ? html`<button class="btn soft auto small" onClick=${more}>${t('chat.older')}</button>` : null}
        ${cur && cur.loaded && !list.length ? html`<div class="chat-empty"><span class="empty-icon"><${Icon} name="messages" size=${30} /></span><p>${t('chat.empty')}</p></div>` : null}
        ${!cur || !cur.loaded ? html`<p class="muted center">${t('common.loading')}</p>` : null}
        ${items}
      </div>
    </div>

    <form class="composer" onSubmit=${(e) => { e.preventDefault(); send(); }}>
      ${open ? html`<div class="mention-pop pop" role="listbox" aria-label=${t('chat.mention')}>
        ${suggestions.map((p, i) => html`<button type="button" role="option" key=${p.id} aria-selected=${i === hi} class=${'mention-opt' + (i === hi ? ' on' : '')}
          onPointerDown=${(e) => e.preventDefault()} onMouseEnter=${() => setHi(i)} onClick=${() => pick(p)}>
          <${Avatar} profile=${p} size=${36} />
          <span class="mention-name">${p.display_name}</span>
          <${RoleChip} role=${p.role} small />
        </button>`)}
      </div>` : null}
      <button class="at-btn" type="button" aria-label=${t('chat.mention')} onPointerDown=${(e) => e.preventDefault()} onClick=${typeAt}>@</button>
      <textarea ref=${boxRef} rows="1" value=${text} maxlength="2000" placeholder=${t('chat.placeholder')} aria-label=${t('chat.placeholder')}
        onInput=${(e) => { setText(e.target.value); setCaret(e.target.selectionStart); setClosedAt(-1); grow(); }} onKeyDown=${onKey}
        onKeyUp=${track} onClick=${track} onSelect=${track}></textarea>
      <button class="send" type="submit" aria-label=${t('chat.send')} disabled=${!text.trim() || busy}><${Icon} name="send" size=${22} /></button>
    </form>
  </div>`;
}

function Bubble({ m, first, mine, canDelete, selected, onSelect }) {
  const s = useStore();
  const who = s.profiles[m.sender];
  const r = roleInfo(who && who.role);
  const [sure, setSure] = useState(false);
  useEffect(() => { if (!selected) setSure(false); }, [selected]);
  const del = async () => {
    if (!sure) { setSure(true); return; }
    try { await removeMessage(m.id); } catch (ex) { toast(friendlyError(ex), 'bad'); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(m.body); toast(t('team.copied')); } catch (_) { /* ignore */ } };

  const pinged = !mine && mentionsMe(m.body);
  return html`<div class=${'msg ' + (mine ? 'mine' : 'theirs') + (first ? ' first' : '') + (pinged ? ' pinged' : '')}>
    ${!mine ? html`<span class="msg-av">${first ? html`<${Avatar} profile=${who} name=${who ? '' : '?'} size=${38} />` : null}</span>` : null}
    <div class="msg-col">
      ${!mine && first ? html`<div class="msg-who">
        <b style=${`color:${r.ink}`}>${who ? who.display_name : t('chat.former')}</b>
        ${who ? html`<${RoleChip} role=${who.role} small />` : null}
      </div>` : null}
      <button class="bubble" onClick=${onSelect} aria-expanded=${selected}>
        <span class="bubble-text">${splitMentions(m.body).map((x) => x.who
          ? html`<span class=${'mention' + (x.who.id === s.profile.id ? ' me' : '')}>${x.text}</span>` : x.text)}</span>
        <time>${fmtTimeOfDay(m.created_at)}</time>
      </button>
      ${selected ? html`<div class="msg-actions pop">
        <button class="pick" onClick=${copy}><${Icon} name="copy" size=${15} />${t('team.copy')}</button>
        ${canDelete ? html`<button class=${'pick danger' + (sure ? ' sure' : '')} onClick=${del}><${Icon} name="trash" size=${15} />${sure ? t('team.removeSure') : t('act.remove')}</button>` : null}
      </div>` : null}
    </div>
  </div>`;
}
