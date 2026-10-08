// DEMO MODE: open the site with ?demo=supervisor (or custodian, receptionist) to look around
// with pretend people. Nothing here touches the real database and nobody is really signed in.
import { state, set } from './store.js';
import { useDemoApi } from './api.js';

const people = [
  { id: 'd1', email: 'anna.lane@example.org', display_name: 'Anna Lane', role: 'supervisor', active: true, language: 'en', avatar_url: null, claimed: true },
  { id: 'd2', email: 'jonas.weber@example.org', display_name: 'Jonas Weber', role: 'custodian', active: true, language: 'de', avatar_url: null, claimed: true },
  { id: 'd3', email: 'maria.santos@example.org', display_name: 'Maria Santos', role: 'custodian', active: true, language: 'pt', avatar_url: null, claimed: true },
  { id: 'd4', email: 'liam.devries@example.org', display_name: 'Liam de Vries', role: 'receptionist', active: true, language: 'nl', avatar_url: null, claimed: true },
];
const pending = [
  { email: 'sofia.berg@example.org', full_name: 'Sofia Berg', role: 'custodian', invite_code: 'K3M9Q2XA', claimed_by: null },
];

const asMap = () => Object.fromEntries(people.map((p) => [p.id, p]));
const pushProfiles = () => set({ profiles: asMap(), profile: asMap()[state.profile.id] });

const demoApi = {
  async listAllowlist() {
    return [
      ...people.map((p) => ({ email: p.email, full_name: p.display_name, role: p.role, invite_code: 'USED0000', claimed_by: p.id })),
      ...pending,
    ];
  },
  async addPerson({ email, full_name, role }) {
    pending.push({ email, full_name, role, invite_code: Math.random().toString(16).slice(2, 10).toUpperCase(), claimed_by: null });
  },
  async updateInvite(email, patch) { Object.assign(pending.find((r) => r.email === email) || {}, patch); },
  async removeInvite(email) { const i = pending.findIndex((r) => r.email === email); if (i >= 0) pending.splice(i, 1); },
  async adminUpdateMember(id, role, active) { Object.assign(people.find((p) => p.id === id), { role, active }); pushProfiles(); },
  async loadProfiles() { return people; },
  async updateMyProfile(patch) { Object.assign(people.find((p) => p.id === state.profile.id), patch); pushProfiles(); return state.profile; },
  async uploadAvatar(blob) { return URL.createObjectURL(blob); },
  async changePassword() {},
};

export function startDemo(role) {
  const wanted = role === 'reception' ? 'receptionist' : role;
  const me = people.find((p) => p.role === wanted) || people[0];
  useDemoApi(demoApi);
  set({ demo: true, ready: true, session: { user: { id: me.id } }, profile: me, profiles: asMap() });
}
