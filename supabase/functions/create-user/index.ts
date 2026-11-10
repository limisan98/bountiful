// Edge function "create-user": the supervisor creates (or resets the password of) a team member's account.
// The caller must be signed in AND be a supervisor (checked with the database's own is_supervisor()).
// People are first added to the allowlist (Team → Invitations); this function then creates their login with a password the supervisor chose.
// Uses the project's service role key from the function environment (never in the repo). Deploy with verify JWT ON.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'method' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const auth = req.headers.get('Authorization') || '';
  // 1) who is calling? must be a supervisor
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: isSup, error: supErr } = await asUser.rpc('is_supervisor');
  if (supErr || isSup !== true) return reply(403, { error: 'not_supervisor' });

  let body: { action?: string; email?: string; password?: string };
  try { body = await req.json(); } catch { return reply(400, { error: 'bad_request' }); }
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email) return reply(400, { error: 'email' });
  if (password.length < 8) return reply(400, { error: 'weak' });

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  if (body.action === 'reset') {
    const { data: p } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
    if (!p) return reply(404, { error: 'not_found' });
    const { error } = await admin.auth.admin.updateUserById(p.id, { password });
    if (error) return reply(400, { error: 'failed', detail: error.message });
    return reply(200, { ok: true });
  }

  // create: the person must be on the allowlist and not registered yet; the database trigger builds the profile from that row
  const { data: row } = await admin.from('allowlist').select('invite_code, claimed_by').eq('email', email).maybeSingle();
  if (!row) return reply(404, { error: 'not_on_list' });
  if (row.claimed_by) return reply(409, { error: 'already' });
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { invite_code: row.invite_code } });
  if (error) return reply(400, { error: 'failed', detail: error.message });
  return reply(200, { ok: true });
});
