import { html } from '../../assets/vendor/htm-preact.js';
import { useStore } from '../store.js';
import { isSupervisor } from '../roles.js';
import { inCrew } from '../data.js';
import { SupervisorHome } from './suphome.js';
import { CustodianHome } from './myday.js';
import { ReceptionHome } from './reception.js';

// One home screen per kind of person: supervisor = overview, custodian = my tasks today, reception = room cleaning requests
export function HomeView() {
  const s = useStore();
  const me = s.profile;
  if (isSupervisor(me)) return html`<${SupervisorHome} />`;
  if (inCrew(me)) return html`<${CustodianHome} />`;
  return html`<${ReceptionHome} />`;
}
