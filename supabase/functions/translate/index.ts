// Edge function "translate": translates short texts (chat messages, task names, notes…) with DeepL.
// Called by the app with the user's login (verify JWT ON). The DeepL key lives only here, as the secret DEEPL_API_KEY
// (Supabase dashboard → Edge Functions → Secrets). Every translation is cached in public.translations.
// Body: { texts: string[], target: 'en'|'de'|'es'|'pt'|'nl'|'sv' }  ->  { results: [{ text, source }] }  or  { error }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const DEEPL: Record<string, string> = { en: 'EN-GB', de: 'DE', es: 'ES', pt: 'PT-PT', nl: 'NL', sv: 'SV' };
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, '0')).join('');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'method' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
  const { data: active } = await asUser.rpc('is_active');
  if (active !== true) return reply(403, { error: 'not_allowed' });

  let body: { texts?: unknown; target?: string };
  try { body = await req.json(); } catch { return reply(400, { error: 'bad_request' }); }
  const target = String(body.target || '');
  const texts = Array.isArray(body.texts) ? body.texts.map((x) => String(x)) : [];
  if (!DEEPL[target] || !texts.length || texts.length > 50 || texts.some((x) => !x.trim() || x.length > 2000)) return reply(400, { error: 'bad_request' });

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const hashes = await Promise.all(texts.map(sha));
  const { data: cached } = await admin.from('translations').select('hash, source, translated').eq('target', target).in('hash', hashes);
  const have = new Map((cached || []).map((r: { hash: string; source: string; translated: string }) => [r.hash, r]));

  const missing = texts.map((x, i) => ({ x, h: hashes[i] })).filter((m) => !have.has(m.h));
  if (missing.length) {
    const key = Deno.env.get('DEEPL_API_KEY');
    if (!key) return reply(200, { error: 'not_configured' });
    const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    const r = await fetch(`${host}/v2/translate`, {
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: missing.map((m) => m.x), target_lang: DEEPL[target] }),
    });
    if (r.status === 456) return reply(200, { error: 'quota' });
    if (r.status === 403 || r.status === 401) return reply(200, { error: 'bad_key' });
    if (!r.ok) return reply(200, { error: 'failed' });
    const out = (await r.json()).translations as { detected_source_language: string; text: string }[];
    const rows = missing.map((m, i) => ({ hash: m.h, target, source: (out[i].detected_source_language || '').toLowerCase().slice(0, 2), translated: out[i].text }));
    await admin.from('translations').upsert(rows);
    rows.forEach((row) => have.set(row.hash, row));
  }
  return reply(200, { results: hashes.map((h, i) => { const row = have.get(h) as { source: string; translated: string }; return { text: row ? row.translated : texts[i], source: row ? row.source : '' }; }) });
});
