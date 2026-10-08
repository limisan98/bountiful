// These two values are PUBLIC by design (they identify the project, they are not passwords).
// What protects the data is the security rules (RLS) inside Supabase.
export const SUPABASE_URL = 'https://kmlvdgtxafcdbsosrsqx.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_vV-KN4LPBhvGYc6zOvz9zg_xHlMDRxz';

// Roles: the colors the owner asked for (supervisor blue, custodian yellow, reception orange)
export const ROLES = {
  supervisor:   { color: '#3F8CFF', soft: '#E4EEFF', ink: '#1F5FD1', icon: 'shield-check' },
  custodian:    { color: '#FFC83D', soft: '#FFF3D1', ink: '#8A6200', icon: 'sparkles' },
  receptionist: { color: '#FF8A3D', soft: '#FFE9DB', ink: '#B3490B', icon: 'key' },
};
export const ROLE_ORDER = ['supervisor', 'custodian', 'receptionist'];

// The one palette the whole app (and later the task editor) is allowed to use. 12 colors.
export const PALETTE = [
  '#6D4AFF', '#4E51BF', '#3F8CFF', '#4CC9F0', '#2EC4A6', '#54C262',
  '#FFC83D', '#FF8A3D', '#F2655B', '#FF92A4', '#D44FA0', '#7B8196',
];
