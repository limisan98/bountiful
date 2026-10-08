import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { state } from './store.js';

// The connection to Supabase (the database). `supabase` comes from assets/vendor/supabase.js
export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ok = ({ data, error }) => { if (error) throw error; return data; };
const rpc = async (name, args) => { const { error } = await sb.rpc(name, args); if (error) throw error; };

// After a "safe door" (rpc) runs, read the task and its report back so the screen can update.
async function fresh(id) {
  const [a, r] = await Promise.all([
    sb.from('assignments').select('*').eq('id', id).single(),
    sb.from('assignment_reports').select('*').eq('assignment_id', id).maybeSingle(),
  ]);
  return { assignment: ok(a), report: ok(r) };
}

// Every call to the database goes through here, so there is one place to look.
// (demo.js has a pretend copy of all of these, used by the ?demo= previews.)
const real = {
  // ---- invitations (supervisors) ----
  async listAllowlist() { return ok(await sb.from('allowlist').select('*').order('created_at')); },
  async addPerson({ email, full_name, role }) { ok(await sb.from('allowlist').insert({ email, full_name, role })); },
  async updateInvite(email, patch) { ok(await sb.from('allowlist').update(patch).eq('email', email)); },
  async removeInvite(email) { ok(await sb.from('allowlist').delete().eq('email', email).is('claimed_by', null)); },
  async adminUpdateMember(id, role, active) { await rpc('admin_update_member', { p_id: id, p_role: role, p_active: active }); },

  // ---- people and roles ----
  async loadProfiles() { return ok(await sb.from('profiles').select('id,display_name,avatar_url,role,active,created_at')); },
  async updateMyProfile(patch) {
    return ok(await sb.from('profiles').update(patch).eq('id', state.session.user.id)
      .select('id,display_name,avatar_url,role,active,created_at').single());
  },
  async uploadAvatar(blob) {
    const uid = state.session.user.id;
    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${uid}/${Date.now()}.${ext}`;
    const up = await sb.storage.from('avatars').upload(path, blob, { contentType: blob.type, cacheControl: '31536000' });
    if (up.error) throw up.error;
    const { data } = sb.storage.from('avatars').getPublicUrl(path);
    const old = await sb.storage.from('avatars').list(uid);
    if (old.data) {
      const stale = old.data.map((f) => `${uid}/${f.name}`).filter((p) => p !== path);
      if (stale.length) await sb.storage.from('avatars').remove(stale);
    }
    return data.publicUrl;
  },
  async changePassword(password) { ok(await sb.auth.updateUser({ password })); },
  async saveNotifPrefs(notif) { ok(await sb.auth.updateUser({ data: { notif } })); },
  async savePushSubscription(endpoint, p256dh, auth, lang) { await rpc('save_push_subscription', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_lang: lang }); },
  async dropPushSubscription(endpoint) { await rpc('drop_push_subscription', { p_endpoint: endpoint }); },
  async saveLanguage(lang) { ok(await sb.auth.updateUser({ data: { lang } })); },
  async loadSettings() { return Object.fromEntries(ok(await sb.from('app_settings').select('*')).map((r) => [r.key, r.value])); },
  async setRoomGoal(minutes) { await rpc('set_room_goal', { p_minutes: minutes }); },
  async loadRoles() { return ok(await sb.from('roles').select('*').order('sort')); },
  async updateRole(id, patch) { return ok(await sb.from('roles').update(patch).eq('id', id).select().single()); },

  // ---- areas and tasks ----
  async loadAreas() { return ok(await sb.from('areas').select('*').order('sort')); },
  async loadTasks() { return ok(await sb.from('tasks').select('*').order('created_at')); },
  async saveTask(task) {
    const { id, ...rest } = task;
    if (id) return ok(await sb.from('tasks').update(rest).eq('id', id).select().single());
    return ok(await sb.from('tasks').insert(rest).select().single());
  },

  // ---- assignments ----
  async loadAssignments(from, to) { return ok(await sb.from('assignments').select('*').gte('day', from).lte('day', to).order('start_time')); },
  async loadReports(from, to) {
    const rows = ok(await sb.from('assignment_reports').select('*, assignments!inner(day)').gte('assignments.day', from).lte('assignments.day', to));
    return rows.map(({ assignments, ...r }) => r);
  },
  async saveAssignments(rows) { return ok(await sb.from('assignments').insert(rows).select()); },
  async updateAssignment(id, patch) { return ok(await sb.from('assignments').update(patch).eq('id', id).select().single()); },
  async deleteAssignment(id) { ok(await sb.from('assignments').delete().eq('id', id)); },
  async deleteFutureAssignments(taskId, fromDay) {
    return ok(await sb.from('assignments').delete().eq('task_id', taskId).gte('day', fromDay).eq('status', 'todo').select('id'));
  },
  async startAssignment(id) { await rpc('start_assignment', { p_id: id }); return fresh(id); },
  async setSteps(id, steps) { await rpc('set_assignment_steps', { p_id: id, p_steps: steps }); return fresh(id); },
  async completeAssignment(id, minutes, comment, delay) {
    await rpc('complete_assignment', { p_id: id, p_minutes: minutes, p_comment: comment, p_delay: delay });
    return fresh(id);
  },
  async reopenAssignment(id) { await rpc('reopen_assignment', { p_id: id }); return fresh(id); },
  async loadMyStats(since) {
    const rows = ok(await sb.from('assignment_reports').select('minutes_spent, assignments!inner(day, assignee)')
      .eq('assignments.assignee', state.session.user.id).gte('assignments.day', since));
    return rows.map((r) => ({ day: r.assignments.day, minutes: r.minutes_spent }));
  },

  // ---- chat ----
  async loadMessages(channel, before, limit = 60) {
    let q = sb.from('messages').select('*').eq('channel', channel).order('created_at', { ascending: false }).limit(limit);
    if (before) q = q.lt('created_at', before);
    return ok(await q);
  },
  async loadRecentMessages(limit = 300) { return ok(await sb.from('messages').select('*').order('created_at', { ascending: false }).limit(limit)); },
  async sendMessage(channel, body) { return ok(await sb.from('messages').insert({ channel, body }).select().single()); },
  async deleteMessage(id) { ok(await sb.from('messages').delete().eq('id', id)); },

  // ---- automatic reports (supervisors) ----
  async loadDigests() {
    return ok(await sb.from('custodian_reports').select('*').order('period_end', { ascending: false }).order('created_at', { ascending: false }).limit(150));
  },

  // ---- task invitations between custodians ----
  async loadInvites(since) { return ok(await sb.from('task_invites').select('*').gte('created_at', since)); },
  async inviteToTask(assignmentId, to, note) {
    const { data, error } = await sb.rpc('invite_to_task', { p_assignment: assignmentId, p_to: to, p_note: note || '' });
    if (error) throw error;
    const [i, m] = await Promise.all([sb.from('task_invites').select('*').eq('id', data).single(), sb.from('messages').select('*').eq('invite_id', data).single()]);
    return { invite: ok(i), message: ok(m) };
  },
  async answerInvite(id, accept) {
    const { data, error } = await sb.rpc('answer_invite', { p_id: id, p_accept: accept });
    if (error) throw error;
    const i = ok(await sb.from('task_invites').select('*').eq('id', id).single());
    const a = ok(await sb.from('assignments').select('*').eq('id', i.assignment_id).maybeSingle());
    return { result: data, invite: i, assignment: a };
  },
  async cancelInvite(id) { await rpc('cancel_invite', { p_id: id }); return ok(await sb.from('task_invites').select('*').eq('id', id).single()); },

  // ---- meeting requests ----
  async loadMeetings(since) { return ok(await sb.from('meeting_requests').select('*').gte('day', since).order('day').order('start_time')); },
  async requestMeeting(supervisor, day, time, topic) {
    const { data, error } = await sb.rpc('request_meeting', { p_supervisor: supervisor, p_day: day, p_time: time, p_topic: topic });
    if (error) throw error;
    return ok(await sb.from('meeting_requests').select('*').eq('id', data).single());
  },
  async answerMeeting(id, accept, reply) {
    await rpc('answer_meeting', { p_id: id, p_accept: accept, p_reply: reply || '' });
    return ok(await sb.from('meeting_requests').select('*').eq('id', id).single());
  },
  async cancelMeeting(id) { await rpc('cancel_meeting', { p_id: id }); return ok(await sb.from('meeting_requests').select('*').eq('id', id).single()); },

  // ---- rooms to clean ----
  async loadRooms(from) { return ok(await sb.from('room_requests').select('*').gte('day', from).order('created_at')); },
  async addRooms(rows) { return ok(await sb.from('room_requests').insert(rows).select()); },
  async assignRooms(ids, assignee) { await rpc('assign_rooms', { p_ids: ids, p_assignee: assignee }); return ok(await sb.from('room_requests').select('*').in('id', ids)); },
  async setRoomStatus(id, status) { await rpc('set_room_status', { p_id: id, p_status: status }); return ok(await sb.from('room_requests').select('*').eq('id', id).single()); },
  async editRoom(id, room, day, note) { await rpc('edit_room', { p_id: id, p_room: room, p_day: day, p_note: note }); return ok(await sb.from('room_requests').select('*').eq('id', id).single()); },
  async deleteRoom(id) { ok(await sb.from('room_requests').delete().eq('id', id)); },

  // ---- live updates: `handler(table, eventType, newRow, oldRow)` ----
  subscribe(handler) {
    const ch = sb.channel('bountiful-live');
    ['profiles', 'roles', 'areas', 'tasks', 'assignments', 'assignment_reports', 'messages', 'room_requests', 'custodian_reports', 'task_invites', 'meeting_requests'].forEach((table) => {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => handler(table, p.eventType, p.new, p.old));
    });
    ch.subscribe();
    return () => sb.removeChannel(ch);
  },
};

// "Demo mode" swaps these for pretend versions (see demo.js) so the design can be previewed.
let demo = null;
export function useDemoApi(impl) { demo = impl; }

export const api = new Proxy(real, {
  get: (target, key) => (demo && demo[key] ? demo[key] : target[key]),
});
