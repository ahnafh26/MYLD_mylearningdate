import {test} from 'node:test';
import assert from 'node:assert/strict';
import {combinedData} from '../extension/integrations/model.js';
import {effectiveAssignments,markDone} from '../extension/background.js';
import {scopedItems,weeklyProgress} from '../extension/popup/dashboard.js';

const due='2026-09-29T02:00:00Z';
function fixture(){return {
 accountId:'student',courses:[{id:'m1',name:'EC120A - Microeconomics',code:'2243.202609'},{id:'m2',code:'EC 120'},{id:'bu',code:'BU 111'}],
 assignments:[{id:'mls',courseId:'m2',courseCode:'EC 120',title:'Ch. 2 EOC Problems: Demand and Consumer Choice',dueDate:due,type:'Dropbox',status:'Pending'}],
 external:{achieve:{ownerId:'student',state:'connected',courses:[{id:'a1',code:'EC120'}],assignments:[{id:'ach',courseId:'a1',courseCode:'EC120',title:'Chapter 2 EOC Problems: Demand & Consumer Choice',dueDate:due,type:'Dropbox',status:'Submitted',completionKind:'Completed'}]}}
};}
test('duplicate MyLS shells and external courses share one readable course without a manual association',()=>{
 const state=fixture(),data=combinedData(state);
 assert.deepEqual(data.courses.map(c=>c.code),['EC 120','BU 111']);
 assert.deepEqual(data.courses[0].memberIds,['m1','m2','a1']);
 assert.equal(data.assignments[0].sourceCourseId,'m2');
 assert.equal(data.assignments[0].courseId,'m1');
});
test('verified Achieve completion resolves the MyLS copy and counts once in both source views',()=>{
 const state=fixture(),rows=effectiveAssignments(state,Date.parse('2026-10-01'));
 assert.equal(rows.length,1);assert.equal(rows[0].id,'mls');assert.equal(rows[0].status,'Submitted');
 assert.equal(rows[0].completionProvider,'achieve');
 assert.equal(scopedItems(rows,'all','d2l').length,1);assert.equal(scopedItems(rows,'all','achieve').length,1);
 assert.equal(weeklyProgress(rows,new Date('2026-09-29T12:00:00Z')).done,1);
 assert.equal(weeklyProgress(rows,new Date('2026-09-29T12:00:00Z')).total,1);
 assert.equal(state.assignments[0].status,'Pending','source cache must remain unmodified');
});
test('Pearson completion and three-source copies reconcile with MyLS identity preserved',()=>{
 const state=fixture();state.external.pearson={ownerId:'student',state:'connected',courses:[{id:'p1',code:'EC 120'}],assignments:[{...state.external.achieve.assignments[0],id:'pear',courseId:'p1'}]};
 const rows=combinedData(state).assignments;assert.equal(rows.length,1);assert.equal(rows[0].id,'mls');assert.equal(rows[0].providers.length,3);
});
test('different chapters, distant deadlines and ambiguous repeated assignments never inherit completion',()=>{
 for(const modify of [s=>s.external.achieve.assignments[0].title='Chapter 3 EOC Problems: Demand and Consumer Choice',s=>s.external.achieve.assignments[0].dueDate='2026-10-10T02:00:00Z',s=>s.assignments.push({...s.assignments[0],id:'distinct-activity'})]){
  const state=fixture();modify(state);const rows=combinedData(state).assignments;
  assert.equal(rows.find(i=>i.id==='mls').status,'Pending');assert.ok(rows.length>1);
 }
});
test('quarantined or other-account providers cannot complete MyLS coursework',()=>{
 for(const patch of [{quarantined:true},{ownerId:'someone-else'}]){
  const state=fixture();Object.assign(state.external.achieve,patch);
  const rows=combinedData(state).assignments;assert.equal(rows.length,1);assert.equal(rows[0].status,'Pending');
 }
});
test('old manual completion aliases survive merging and can be undone',async()=>{
 const state=fixture();state.external.achieve.assignments[0].status='Pending';state.completedIds={ach:true};
 assert.equal(effectiveAssignments(state)[0].status,'Done');
 globalThis.chrome={storage:{local:{get:async()=>structuredClone(state),set:async patch=>Object.assign(state,patch)}},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}}};
 assert.equal((await markDone('mls','student',false)).ok,true);assert.equal(state.completedIds.ach,undefined);
 assert.notEqual(effectiveAssignments(state)[0].status,'Done');
});
