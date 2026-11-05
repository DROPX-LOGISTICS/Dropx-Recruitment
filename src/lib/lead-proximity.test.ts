import { describe,it,expect } from 'vitest';
import {pinAreaCentre,leadProximity,compareLeadProximity,validPoint,STATION_HIRING_PINS} from './lead-proximity';
describe('candidate proximity',()=>{
 it('prioritizes confirmed local PINs without inventing a distance',()=>{
  expect(STATION_HIRING_PINS['TLPB-XPT']).toEqual(['670702','670593']);
  const rows=[{id:'other',proximity:{km:1,basis:'pin_area' as const}}, {id:'local',proximity:{km:null,basis:'unavailable' as const,localPin:true}}];
  expect(rows.sort(compareLeadProximity)[0].id).toBe('local');
  expect(rows[0].proximity.km).toBeNull();
 });
 it('accepts stored GeoJSON strings and weights polygon area',()=>{
  const g={type:'Polygon',coordinates:[[[75,11],[77,11],[77,13],[75,13],[75,11]]]};
  expect(pinAreaCentre(JSON.stringify(g))).toEqual({lat:12,lng:76});
 });
 it('does not treat missing or invalid coordinates as zero',()=>{
  expect(validPoint(null,75)).toBeNull();expect(validPoint(999,75)).toBeNull();
  expect(leadProximity(null,{lat:12,lng:76}).km).toBeNull();
  expect(pinAreaCentre({type:'Polygon',coordinates:[[[1,2]]]})).toBeNull();
 });
 it('labels distance as an area estimate, and allows a real zero',()=>{
  expect(leadProximity({lat:12,lng:76},{lat:12,lng:76})).toEqual({km:0,basis:'pin_area'});
  expect(leadProximity({lat:0,lng:0},{lat:0,lng:1}).km).toBe(111.2);
 });
 it('sorts the complete filtered set with unknowns last and stable ties',()=>{
  const rows=[{id:'unknown',proximity:{km:null,basis:'unavailable' as const}}, {id:'far',proximity:{km:12,basis:'pin_area' as const}}, {id:'near',proximity:{km:2,basis:'pin_area' as const}}];
  expect(rows.sort(compareLeadProximity).map(r=>r.id)).toEqual(['near','far','unknown']);
 });
});
