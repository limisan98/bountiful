import { state } from './store.js';
import { t } from './i18n.js';
import { ROLE_DEFAULTS, ROLE_ORDER } from './config.js';
import { colorVars } from './color.js';

// Everything about a role (name, icon, colors) in one place. The database row wins over the defaults.
export function roleInfo(id) {
  const row = state.roles[id] || {};
  const def = ROLE_DEFAULTS[id] || { department: 'custodian', is_supervisor: false, icon: 'user', color: '#CCABD8' };
  const color = row.color || def.color;
  const v = colorVars(color);
  return {
    id,
    department: row.department || def.department,
    isSupervisor: row.is_supervisor ?? def.is_supervisor,
    custom: row.name || '',
    name: row.name || t('role.' + id),
    icon: row.icon || def.icon,
    color, soft: v.soft, ink: v.ink,
  };
}
export const roleList = () => ROLE_ORDER.map(roleInfo);
export const isSupervisor = (p) => !!p && roleInfo(p.role).isSupervisor;
export const departmentOf = (p) => (p ? roleInfo(p.role).department : null);
