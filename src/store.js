import { useState, useEffect } from '../assets/vendor/htm-preact.js';

// One tiny shared "memory" for the whole app. Anything that changes here re-draws the screen.
const listeners = new Set();

export const state = {
  ready: false,      // finished checking if someone is signed in
  session: null,     // the login session
  profile: null,     // my profile row
  profiles: {},      // everyone's profile, by id (names, photos, roles)
  lang: 'en',
  toast: null,
  sheet: null,       // 'profile' when the profile panel is open
  demo: false,
};

export function set(patch) {
  Object.assign(state, patch);
  listeners.forEach((fn) => fn());
}

export function useStore() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return state;
}

let toastTimer;
export function toast(msg, kind = 'ok') {
  clearTimeout(toastTimer);
  set({ toast: { msg, kind } });
  toastTimer = setTimeout(() => set({ toast: null }), 2600);
}
