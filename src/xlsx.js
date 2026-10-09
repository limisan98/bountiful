// A small, dependency-free reader for .xlsx files (an .xlsx is a zip of XML files).
// Works in the browser with the built-in DecompressionStream, so the app still needs no build step.
// readXlsx(arrayBuffer) -> { sheets: [{ name, rows: Cell[][] }] }
// Cell = null | { t: 'text'|'num'|'date'|'time'|'dt'|'bool', s: string, n?: number, ymd?: 'YYYY-MM-DD', min?: minutes since midnight }

const dec = new TextDecoder('utf-8');

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---- zip ----
async function unzip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not-xlsx');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = {};
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('not-xlsx');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    entries[name] = { method, csize, off };
    p += 46 + nlen + elen + clen;
  }
  const read = async (name) => {
    const e = entries[name];
    if (!e) return null;
    const nlen = dv.getUint16(e.off + 26, true), elen = dv.getUint16(e.off + 28, true);
    const data = u8.subarray(e.off + 30 + nlen + elen, e.off + 30 + nlen + elen + e.csize);
    const raw = e.method === 0 ? data : await inflateRaw(data);
    return dec.decode(raw);
  };
  return { names: Object.keys(entries), read };
}

const xml = (text) => new DOMParser().parseFromString(text, 'application/xml');
const kids = (el, tag) => Array.from(el.getElementsByTagName(tag));
const direct = (el, tag) => Array.from(el.children).filter((c) => c.localName === tag);

// ---- number formats: is a number a date, a time, or both? ----
const BUILTIN = { 14: 'date', 15: 'date', 16: 'date', 17: 'date', 18: 'time', 19: 'time', 20: 'time', 21: 'time', 22: 'dt', 45: 'time', 46: 'time', 47: 'time' };
for (let i = 27; i <= 36; i++) BUILTIN[i] = 'date';
for (let i = 50; i <= 58; i++) BUILTIN[i] = 'date';
function kindOfFormat(code) {
  const c = String(code).replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[(?!h|m|s)[^\]]*\]/gi, '').toLowerCase();
  const date = /[yd]/.test(c.replace(/general/g, ''));
  const time = /h|s/.test(c.replace(/general/g, ''));
  if (date && time) return 'dt';
  if (date) return 'date';
  if (time) return 'time';
  return null;
}

function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref);
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function serialToParts(n, date1904) {
  const days = Math.floor(n);
  const min = Math.round((n - days) * 1440);
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(base + days * 86400000);
  const pad = (x) => String(x).padStart(2, '0');
  return { ymd: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, min: min % 1440 };
}

export async function readXlsx(buf) {
  const zip = await unzip(buf);
  const wbText = await zip.read('xl/workbook.xml');
  if (!wbText) throw new Error('not-xlsx');
  const wb = xml(wbText);
  const date1904 = kids(wb, 'workbookPr').some((x) => x.getAttribute('date1904') === '1' || x.getAttribute('date1904') === 'true');
  const relText = (await zip.read('xl/_rels/workbook.xml.rels')) || '';
  const rels = {};
  kids(xml(relText), 'Relationship').forEach((r) => { rels[r.getAttribute('Id')] = r.getAttribute('Target'); });

  // shared strings
  const sst = [];
  const sstText = await zip.read('xl/sharedStrings.xml');
  if (sstText) {
    kids(xml(sstText), 'si').forEach((si) => {
      let s = '';
      const walk = (el) => Array.from(el.children).forEach((c) => {
        if (c.localName === 't') s += c.textContent;
        else if (c.localName === 'r') walk(c);
        // (phonetic runs "rPh" are skipped)
      });
      walk(si);
      sst.push(s);
    });
  }

  // styles: which cell formats are dates / times
  const xfKinds = [];
  const stText = await zip.read('xl/styles.xml');
  if (stText) {
    const st = xml(stText);
    const custom = {};
    kids(st, 'numFmt').forEach((n) => { custom[n.getAttribute('numFmtId')] = n.getAttribute('formatCode'); });
    const cellXfs = kids(st, 'cellXfs')[0];
    if (cellXfs) {
      direct(cellXfs, 'xf').forEach((xf) => {
        const id = xf.getAttribute('numFmtId');
        xfKinds.push(custom[id] !== undefined ? kindOfFormat(custom[id]) : BUILTIN[id] || null);
      });
    }
  }

  const sheets = [];
  for (const sh of kids(wb, 'sheet')) {
    const name = sh.getAttribute('name');
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = rels[rid];
    if (!target) continue;
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const text = await zip.read(target);
    if (!text) continue;
    const doc = xml(text);
    const rows = [];
    kids(doc, 'row').forEach((row, ri) => {
      const r = (parseInt(row.getAttribute('r'), 10) || ri + 1) - 1;
      const out = (rows[r] = rows[r] || []);
      direct(row, 'c').forEach((c, ci) => {
        const ref = c.getAttribute('r');
        const col = ref ? colIndex(ref) : ci;
        const t = c.getAttribute('t');
        const vEl = direct(c, 'v')[0];
        const v = vEl ? vEl.textContent : null;
        let cell = null;
        if (t === 's' && v !== null) cell = { t: 'text', s: sst[parseInt(v, 10)] || '' };
        else if (t === 'inlineStr') cell = { t: 'text', s: kids(c, 't').map((x) => x.textContent).join('') };
        else if (t === 'str' && v !== null) cell = { t: 'text', s: v };
        else if (t === 'b' && v !== null) cell = { t: 'bool', s: v === '1' ? 'TRUE' : 'FALSE' };
        else if (t === 'd' && v) cell = { t: 'date', s: v, ymd: v.slice(0, 10), min: v.length > 10 ? parseInt(v.slice(11, 13), 10) * 60 + parseInt(v.slice(14, 16), 10) : null };
        else if (v !== null && v !== '' && (!t || t === 'n')) {
          const n = parseFloat(v);
          const kind = xfKinds[parseInt(c.getAttribute('s') || '0', 10)] || null;
          if (kind && !Number.isNaN(n)) {
            const p = serialToParts(n, date1904);
            cell = kind === 'time' ? { t: 'time', s: v, n, min: Math.round((n - Math.floor(n)) * 1440) % 1440 }
              : kind === 'date' ? { t: 'date', s: v, n, ymd: p.ymd, min: null }
                : { t: 'dt', s: v, n, ymd: p.ymd, min: p.min };
          } else cell = { t: 'num', s: v, n };
        }
        if (cell && String(cell.s).trim() !== '') out[col] = cell;
      });
    });
    // make the grid dense so people can index it freely
    let width = 0;
    for (let i = 0; i < rows.length; i++) if (rows[i] && rows[i].length > width) width = rows[i].length; // (rows can have gaps)
    const dense = Array.from({ length: rows.length }, (_, i) => Array.from({ length: width }, (_, j) => (rows[i] && rows[i][j]) || null));
    sheets.push({ name, rows: dense });
  }
  return { sheets };
}
