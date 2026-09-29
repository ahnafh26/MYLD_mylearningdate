import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combinedData, keepVerified, assignmentLink } from '../extension/integrations/model.js';
import { weeklyProgress, knownProgress, inView, scopedItems } from '../extension/popup/dashboard.js';
import { applyCompletionEvidence, effectiveAssignments, courseLabel } from '../extension/background.js';
import { syncProvider } from '../extension/integrations/providers.js';

const item={id:'d2l:course:Dropbox:42',courseId:'course',entityId:'42',courseCode:'BU 111',title:'Case study',type:'Dropbox',provider:'d2l',dueDate:'2026-10-15T23:59:00Z',status:'Pending',link:'https://mylearningspace.wlu.ca/d2l/lms/dropbox/user/folder_submit_files.d2l?db=42&ou=course'};

test('initial October 20 sync applies historical completion without a due date on the completion row',()=>{
 const rows=[{OrgUnitId:'course',ItemId:'900',DateCompleted:'2026-10-14T16:00:00Z',ItemUrl:item.link}];
 const initial=applyCompletionEvidence([item],rows);
 assert.equal(initial[0].status,'Submitted');
 const restarted=JSON.parse(JSON.stringify(initial));
 const afterFailure=keepVerified([{...item,status:'Pending'}],restarted);
 assert.equal(afterFailure[0].status,'Submitted');
 assert.equal(afterFailure[0].completedAt,rows[0].DateCompleted);
 assert.equal(afterFailure[0].verificationCached,true);
 assert.equal(inView(afterFailure[0],'overdue',new Date('2026-10-20')),false);
});
test('completion evidence cannot match another course, foreign URL or invalid timestamp',()=>{
 for(const row of [{OrgUnitId:'other',ItemUrl:item.link,DateCompleted:'2026-10-14'}, {OrgUnitId:'course',ItemUrl:'https://evil.test/?db=42',DateCompleted:'2026-10-14'},{OrgUnitId:'course',ItemUrl:item.link,DateCompleted:'invalid'}]) assert.equal(applyCompletionEvidence([item],[row])[0].status,'Pending');
});
test('manual check-offs stay distinct and do not override provider verification',()=>{
 const state={assignments:[{...item,status:'Submitted'}],completedIds:{[item.id]:true}};
 assert.equal(effectiveAssignments(state)[0].status,'Submitted');
 state.assignments=[item];assert.equal(effectiveAssignments(state)[0].status,'Done');
});
test('weekly progress uses Monday boundaries and excludes recurring or unrelated events',()=>{
 const now=new Date(2026,9,21,12),date=(day)=>new Date(2026,9,day,12).toISOString();
 const items=[{...item,dueDate:date(19),status:'Submitted'},{...item,dueDate:date(20),status:'Done'},{...item,dueDate:date(25)},{...item,dueDate:date(26),status:'Submitted'},{...item,dueDate:date(21),isRecurring:true},{...item,type:'Event',dueDate:date(21)}];
 assert.deepEqual(weeklyProgress(items,now),{total:3,done:2,verified:1,manual:1,percent:67,stale:false});
 assert.equal(weeklyProgress([],now).percent,0);
 assert.deepEqual(knownProgress(items),{total:4,done:3});
});
test('provider and course filters compose and completed view remains accessible',()=>{
 const rows=[{...item,status:'Submitted'},{...item,id:'2',provider:'pearson'},{...item,id:'3',provider:'achieve',courseId:'other'}];
 assert.deepEqual(scopedItems(rows,'course','pearson').map(i=>i.id),['2']);
 assert.equal(inView(rows[0],'completed'),true);
});
test('provider cache is isolated by MyLS owner and explicit course mappings',()=>{
 const ext={ownerId:'user',state:'connected',courses:[{id:'p1',code:'BU 111'}],assignments:[{...item,id:'p-item',courseId:'p1',provider:'pearson'}]};
 const state={accountId:'user',courses:[{id:'course',code:'BU 111'}],external:{pearson:ext},courseMappings:{p1:'course'}};
 assert.equal(combinedData(state).courses.length,1);assert.equal(combinedData(state).assignments[0].courseId,'course');
 assert.equal(combinedData({...state,accountId:'other'}).assignments.length,0);
 assert.equal(combinedData({...state,external:{pearson:{...ext,quarantined:true}}}).assignments.length,0);
});
test('provider links reject executable, foreign and credential-bearing URLs',()=>{
 for(const link of ['javascript:alert(1)','https://evil.test','https://user@mylab.pearson.com/courses/1']) assert.equal(assignmentLink({provider:'pearson',link}),'https://console.pearson.com/courses');
 assert.equal(assignmentLink({provider:'achieve',link:'https://achieve.macmillanlearning.com/courses/1/mycourse'}),'https://achieve.macmillanlearning.com/courses/1/mycourse');
});
test('provider sync preserves partial cache, updates completion, and quarantines mixed accounts',async()=>{
 let state={accountId:'owner'},account='Test Student',complete=false,mixed=false;
 globalThis.chrome={storage:{local:{get:async()=>structuredClone(state),set:async patch=>Object.assign(state,patch)}},permissions:{contains:async()=>true},tabs:{query:async()=>[{id:1}]},scripting:{executeScript:async()=>{
 const snapshot={state:'connected',account,courseId:'1',courseName:'BU111 Fall 2026',rows:[{externalId:'Q_1',title:'Quiz',dueDate:item.dueDate,completed:complete,link:'https://mylab.pearson.com/courses/1/assignments'}]};
 return [{result:snapshot},...(mixed?[{result:{...snapshot,account:'Another Student'}}]:[])];
 }}};
 assert.equal((await syncProvider('pearson',courseLabel)).ok,true);const first=state.external.pearson.assignments[0].id;
 complete=true;await syncProvider('pearson',courseLabel);assert.equal(state.external.pearson.assignments[0].status,'Submitted');
 complete=false;await syncProvider('pearson',courseLabel);assert.equal(state.external.pearson.assignments[0].status,'Submitted');
 account='Different Student';await syncProvider('pearson',courseLabel);assert.notEqual(state.external.pearson.assignments[0].id,first);assert.equal(state.external.pearson.assignments[0].status,'Pending');
 mixed=true;await syncProvider('pearson',courseLabel);assert.equal(state.external.pearson.quarantined,true);assert.equal(combinedData(state).assignments.length,0);
});
