import {describe,it,expect} from 'vitest';
import {joiningState,belongsToPerson,type JoiningPerson,type JoiningPlan,type JoiningAttendance,type JoiningMapping} from './workforce-joining';
const person={id:'w',location_id:'s',source_profile_type:'field_executive',source_profile_id:'legacy',onboarding_status:'approved',lifecycle_status:'onboarding',is_active:false} satisfies JoiningPerson;
const plan={workforce_id:'w',station_id:'s',mode:'training',eligible_from:'2026-09-01'} as JoiningPlan;
const punch={id:'a',workforce_id:'w',punch_date:'2026-09-02',in_time:'2026-09-02T04:00:00Z',punch_in_location_id:'s',in_source:'biometric'} as JoiningAttendance;
const mapping={id:'m',workforce_id:'w',provider_member_id:'P',effective_from:'2026-09-07',effective_to:null,status:'active'} as JoiningMapping;
describe('shared Workforce joining evidence',()=>{
 it('requires approved profile, plan and genuine arrival',()=>{
   expect(joiningState({...person,onboarding_status:'pending'},plan,[],[punch],'2026-09-03').stage).toBe('applicant');
   expect(joiningState(person,plan,[],[],'2026-09-03').stage).toBe('awaiting_arrival');
   expect(joiningState(person,plan,[],[punch],'2026-09-03').stage).toBe('training');
   expect(joiningState(person,plan,[],[{...punch,flagged:true}],'2026-09-03').stage).toBe('awaiting_arrival');
 });
 it('ends training on backdated mapping, not entry timestamp',()=>{
   expect(joiningState(person,plan,[mapping],[punch],'2026-09-06').stage).toBe('training');
   expect(joiningState(person,plan,[mapping],[punch],'2026-09-10').stage).toBe('ready');
 });
 it('never labels direct hires as training or steals canonical identity via alias',()=>{
   expect(joiningState(person,{...plan,mode:'direct'},[],[punch],'2026-09-03').stage).toBe('awaiting_activation');
   expect(belongsToPerson({workforce_id:'other',field_executive_id:'legacy'},person)).toBe(false);
 });
});
