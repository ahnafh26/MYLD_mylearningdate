import {test} from 'node:test';
import assert from 'node:assert/strict';
import {syncProvider} from '../extension/integrations/providers.js';
import {combinedData,digest} from '../extension/integrations/model.js';
import {courseLabel} from '../extension/background.js';

test('closed tabs, read failures and missing permission retain saved deadlines for both providers',async()=>{
 for(const provider of ['pearson','achieve']) for(const mode of ['closed','read-error','permission']) {
  let state={accountId:'owner',external:{[provider]:{ownerId:'owner',accountKey:await digest(`${provider}|Student`),state:'connected',courses:[{id:'course',code:'BU 111'}],assignments:[{id:'saved',courseId:'course',courseCode:'BU 111',title:'Quiz 1',dueDate:'2026-10-01T00:00:00Z',status:'Submitted'}]}}};
  globalThis.chrome={storage:{local:{get:async()=>structuredClone(state),set:async patch=>Object.assign(state,patch)}},permissions:{contains:async()=>mode!=='permission'},tabs:{query:async()=>mode==='closed'?[]:[{id:1}]},scripting:{executeScript:async()=>{throw new Error('Tab gone');}}};
  await syncProvider(provider,courseLabel);
  const rows=combinedData(state).assignments;
  assert.equal(rows.length,1,`${provider}: ${mode}`);assert.equal(rows[0].stale,true);assert.equal(rows[0].status,'Submitted');
 }
});
test('legacy missing-tab quarantine is recovered without clearing saved work',async()=>{
 let state={accountId:'owner',external:{achieve:{ownerId:'owner',state:'needs-login',quarantined:true,message:'Open a signed-in Achieve course tab, then sync.',assignments:[{id:'saved',courseId:'c',courseCode:'EC 120',title:'Assignment',status:'Pending'}]}}};
 globalThis.chrome={storage:{local:{get:async()=>structuredClone(state),set:async patch=>Object.assign(state,patch)}},permissions:{contains:async()=>true},tabs:{query:async()=>[]}};
 await syncProvider('achieve',courseLabel);assert.equal(combinedData(state).assignments.length,1);
});
test('real account mismatch stays quarantined when course tabs are closed',async()=>{
 let state={accountId:'owner',external:{pearson:{ownerId:'owner',state:'error',quarantined:true,quarantineReason:'account-mismatch',assignments:[{id:'private',courseId:'c'}]}}};
 globalThis.chrome={storage:{local:{get:async()=>structuredClone(state),set:async patch=>Object.assign(state,patch)}},permissions:{contains:async()=>true},tabs:{query:async()=>[]}};
 await syncProvider('pearson',courseLabel);assert.equal(combinedData(state).assignments.length,0);
});
test('undated platform rows are kept with each row\'s completion kind',async()=>{
 let state={accountId:'owner'};
 const rows=[{externalId:'a4',title:'Syllabus Scavenger Hunt',dueDate:null,completed:true,completionKind:'Graded',type:'Dropbox',link:'https://achieve.macmillanlearning.com/courses/c/mycourse#a4'}];
 globalThis.chrome={storage:{local:{get:async()=>structuredClone(state),set:async patch=>Object.assign(state,patch)}},permissions:{contains:async()=>true},tabs:{query:async()=>[{id:1}]},scripting:{executeScript:async()=>[{result:{state:'connected',account:'Sam',courseId:'1',courseName:'BU 111 Fall 2026',rows}}]}};
 assert.equal((await syncProvider('achieve',courseLabel)).ok,true);
 const [undated]=state.external.achieve.assignments;
 assert.equal(undated.dueDate,null);assert.equal(undated.completionKind,'Graded');assert.equal(undated.statusSource,'Achieve');
 await assert.rejects(syncProvider('tophat',courseLabel),/Unknown provider/);
});
test('a Mastering page table is used only when the tab has no MyLab assignment frame',async()=>{
 const context={state:'context',account:'Sam',courseId:'7',courseName:'BU 111',masteringRows:[{externalId:'m-1',title:'Week 3 Problem Set',dueDate:'2026-10-02T03:59:00Z',completed:true,link:'https://mylabmastering.pearson.com/x'}]};
 const frame={state:'rows',courseId:'7',rows:[{externalId:'H_1',title:'Week 3 Problem Set',dueDate:'2026-10-02T03:59:00Z',completed:true,link:'https://mylab.pearson.com/courses/7/assignments'}]};
 for(const [results,expected] of [[[context],['m-1']],[[context,frame],['H_1']]]){
  let state={accountId:'owner'};
  globalThis.chrome={storage:{local:{get:async()=>structuredClone(state),set:async patch=>Object.assign(state,patch)}},permissions:{contains:async()=>true},tabs:{query:async()=>[{id:1}]},scripting:{executeScript:async()=>results.map(result=>({result:structuredClone(result)}))}};
  await syncProvider('pearson',courseLabel);
  assert.deepEqual(state.external.pearson.assignments.map(item=>item.externalId),expected);
 }
});
test('sync explains a missing tab, and prefers the page\'s own message and address over its frames',async()=>{
 let state={accountId:'owner'};
 const setup=results=>{globalThis.chrome={storage:{local:{get:async()=>structuredClone(state),set:async patch=>Object.assign(state,patch)}},permissions:{contains:async()=>true},tabs:{query:async()=>results?[{id:1,url:'https://mylabmastering.pearson.com/courses/7/home?x=1'}]:[]},scripting:{executeScript:async()=>results}};};
 setup(null);await syncProvider('achieve',courseLabel);
 assert.equal(state.external.achieve.state,'no-open-tab');assert.match(state.external.achieve.message,/No open Achieve tab/);
 setup([{frameId:0,result:{state:'unavailable',message:'Open Lab Quizzes and Assignments in MyLab.'}},{frameId:4,result:{state:'unavailable',message:'This page isn’t one MYLD can read yet.'}},{frameId:5,result:{state:'ignored'}}]);
 await syncProvider('pearson',courseLabel);
 assert.equal(state.external.pearson.message,'Open Lab Quizzes and Assignments in MyLab. (Page: mylabmastering.pearson.com/courses/7/home)');
 setup([{frameId:0,result:{state:'rows',courseId:'9',rows:[{externalId:'H_1',title:'HW',dueDate:null,completed:false}]}}]);
 await syncProvider('pearson',courseLabel);
 assert.match(state.external.pearson.message,/MyLab is open on its own/);
});
