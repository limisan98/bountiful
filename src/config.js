// These two values are PUBLIC by design (they identify the project, they are not passwords).
// What protects the data is the security rules (RLS) inside Supabase.
export const SUPABASE_URL = 'https://kmlvdgtxafcdbsosrsqx.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_vV-KN4LPBhvGYc6zOvz9zg_xHlMDRxz';

// THE palette. Solid colors only, no gradients. Everything colorful in the app
// (roles, areas, tasks) picks from this list, so it always looks like one family.
// You can add up to 15 colors here later.
export const PALETTE = ['#86E3CE', '#D0E6A5', '#FFDD94', '#FA897B', '#CCABD8'];
export const MINT = PALETTE[0];

// Four roles. Names, icons and colors below are only the starting point:
// supervisors can change them inside the app (they are stored in the database).
export const ROLE_DEFAULTS = {
  custodian_supervisor: { department: 'custodian', is_supervisor: true,  icon: 'shield-check', color: '#86E3CE', sort: 1 },
  custodian:            { department: 'custodian', is_supervisor: false, icon: 'sparkles',     color: '#FFDD94', sort: 2 },
  reception_supervisor: { department: 'reception', is_supervisor: true,  icon: 'star',         color: '#CCABD8', sort: 3 },
  receptionist:         { department: 'reception', is_supervisor: false, icon: 'key',          color: '#FA897B', sort: 4 },
};
export const ROLE_ORDER = ['custodian_supervisor', 'custodian', 'reception_supervisor', 'receptionist'];
export const DEPARTMENTS = ['custodian', 'reception'];

// Icons a supervisor can choose from (all Tabler "filled" icons that are bundled in assets/icons.js)
export const ROLE_ICONS = ['shield-check', 'crown', 'star', 'award', 'trophy', 'key', 'sparkles', 'sparkles-2', 'briefcase',
  'headset', 'id', 'ticket', 'heart', 'flag', 'bulb', 'compass', 'nurse', 'leaf', 'flower', 'sun', 'moon', 'bell', 'user', 'home'];
export const TASK_ICONS = ['sparkles', 'sparkles-2', 'bed', 'bed-flat', 'bath', 'droplet', 'droplets', 'trash', 'basket', 'bottle',
  'bowl', 'bread', 'chef-hat', 'cookie', 'glass', 'mug', 'microwave', 'milk', 'salad', 'soup', 'tools-kitchen-2', 'flower',
  'leaf', 'seedling', 'garden-cart', 'cactus', 'windmill', 'key', 'lock', 'hanger-2', 'shirt', 'ironing', 'ironing-steam',
  'flame', 'bulb', 'bolt', 'cone', 'barrier-block', 'fence', 'bandage', 'car', 'parking-circle', 'bus', 'truck', 'trolley',
  'box-multiple', 'cardboards', 'container', 'home', 'home-2', 'library', 'school', 'hospital-circle', 'elevator', 'book',
  'flag', 'star', 'heart', 'sun', 'moon', 'umbrella', 'temperature-plus', 'gift', 'confetti', 'bell', 'phone', 'mail',
  'camera', 'clipboard-check', 'list-check', 'clock', 'calendar-event', 'user', 'paw', 'palette', 'crown'];
