import { useState, useEffect } from '../assets/vendor/htm-preact.js';

// One tiny shared "memory" for the whole app. Anything that changes here re-draws the screen.
const listeners = new Set();

export const state = {
  ready: false,      // finished checking if someone is signed in
  session: null,     // the login session
  profile: null,     // my profile row
  profiles: {},      // everyone's profile, by id (name, photo, role: nothing else)
  roles: {},         // the four roles (name, icon, color), by id
  areas: [],         // temple, guesthouse, ...
  tasks: {},         // task library, by id
  presets: {},       // ready-made area checklists (area x depth), by id: see supabase/014
  assignments: {},   // who does which task on which day, by id
  reports: {},       // finished-task reports, by assignment id (private: mine, or everyone's for supervisors)
  digests: {},       // automatic reports (day/week/month/quarter), by id (supervisors only)
  invites: {},       // task invitations between custodians, by id
  meetings: {},      // meeting requests (mine, or addressed to me), by id
  settings: {},      // app-wide settings (e.g. room_goal_minutes)
  shifts: {},        // the shift types (07:00-15:30, ...), by id
  shiftPlan: {},     // who works which shift on which day, by id
  contracts: {},     // 4h / 8h contract, by person id
  logbook: {},       // handover logbook entries, by id
  comments: {},      // comments on tasks, by assignment id (loaded when a task is opened)
  messages: {},      // chat, by channel: 'general' or 'dm:<id>:<id>' -> { list, more, loaded }
  chatOpen: null,    // the conversation that is open in the chat screen (null = the list)
  chatSeen: {},      // channel -> time I last looked (for the unread counters; kept on this device)
  person: null,      // id of the person whose profile card is open
  lang: 'en',
  toast: null,
  sheet: null,       // 'profile' when the profile panel is open
  demo: false,
};

let version = 0; // goes up by one every time something changes

export function set(patch) {
  Object.assign(state, patch);
  version += 1;
  listeners.forEach((fn) => fn());
}

export function useStore() {
  const [, force] = useState(0);
  const seen = version;
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    // if something changed between drawing and starting to listen, catch up now
    if (version !== seen) fn();
    return () => listeners.delete(fn);
  }, []);
  return state;
}

let toastTimer, toastTimer2;
export function toast(msg, kind = 'ok') {
  clearTimeout(toastTimer); clearTimeout(toastTimer2);
  set({ toast: { msg, kind, out: false } });
  toastTimer = setTimeout(() => set({ toast: { msg, kind, out: true } }), 2500);
  toastTimer2 = setTimeout(() => set({ toast: null }), 2800);
}
