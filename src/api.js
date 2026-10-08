import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { state } from './store.js';

// The connection to Supabase (the database). `supabase` comes from assets/vendor/supabase.js
export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Every call to the database goes through here, so there is one place to look.
const real = {
  async listAllowlist() {
    const { data, error } = await sb.from('allowlist').select('*').order('created_at');
    if (error) throw error;
    return data;
  },
  async addPerson({ email, full_name, role }) {
    const { error } = await sb.from('allowlist').insert({ email, full_name, role });
    if (error) throw error;
  },
  async updateInvite(email, patch) {
    const { error } = await sb.from('allowlist').update(patch).eq('email', email);
    if (error) throw error;
  },
  async removeInvite(email) {
    const { error } = await sb.from('allowlist').delete().eq('email', email).is('claimed_by', null);
    if (error) throw error;
  },
  async adminUpdateMember(id, role, active) {
    const { error } = await sb.rpc('admin_update_member', { p_id: id, p_role: role, p_active: active });
    if (error) throw error;
  },
  async loadProfiles() {
    const { data, error } = await sb.from('profiles').select('id,email,display_name,avatar_url,role,language,active');
    if (error) throw error;
    return data;
  },
  async updateMyProfile(patch) {
    const { data, error } = await sb.from('profiles').update(patch).eq('id', state.session.user.id).select().single();
    if (error) throw error;
    return data;
  },
  // Uploads the (already shrunk) photo and removes older ones. Returns the public web address.
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
  async changePassword(password) {
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw error;
  },
};

// "Demo mode" swaps these for pretend versions (see demo.js) so the design can be previewed.
let demo = null;
export function useDemoApi(impl) { demo = impl; }

export const api = new Proxy(real, {
  get: (target, key) => (demo && demo[key] ? demo[key] : target[key]),
});
