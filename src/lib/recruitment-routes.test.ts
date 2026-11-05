import {describe,it,expect} from 'vitest';
import {emptyRecruitFilters,parseRecruitRoute,recruitHref,recruitMenuSlugs} from './recruitment-routes';
import {recruitmentMenuCatalog} from './recruitment-menu-roles';
describe('Recruit shareable routes',()=>{
 it('has a stable unique path for every menu in both workspaces',()=>{
  expect(new Set(Object.values(recruitMenuSlugs)).size).toBe(Object.keys(recruitMenuSlugs).length);
  for(const menu of recruitmentMenuCatalog)for(const workspace of menu.workspaces){
   const href=recruitHref(workspace,menu.id);
   expect(parseRecruitRoute(href)?.menu).toBe(menu.id);
   expect(parseRecruitRoute(href)?.stream).toBe(workspace);
  }
 });
 it('round trips applied filters and pagination without tokens or preview identity',()=>{
  const filters={...emptyRecruitFilters,station:'TLPB-XPT,TLPA',role:'DA',sort:'nearest',stale24:true,interviewFrom:'2026-11-05'};
  const href=recruitHref('workforce','All Leads',filters,3,'example');
  const url=new URL(href,'https://recruit.example');
  expect(parseRecruitRoute(url.pathname,url.search)).toEqual({stream:'workforce',menu:'All Leads',filters,page:3,search:'example'});
  const injected=parseRecruitRoute(url.pathname,url.search+'&token=secret&previewProfileId=owner');
  expect(JSON.stringify(injected)).not.toMatch(/secret|owner|previewProfileId/);
 });
 it('rejects unsupported paths and normalizes invalid page and sort values',()=>{
  for(const path of ['/api/recruitment/leads','/unknown/leads','/workforce/no-such-menu','//evil.test'])expect(parseRecruitRoute(path)).toBeNull();
  const route=parseRecruitRoute('/hr/interviews/','?page=NaN&sort=invalid&stale24=false');
  expect(route?.page).toBe(1);expect(route?.filters.sort).toBe('newest');expect(route?.filters.stale24).toBe(false);
 });
});
