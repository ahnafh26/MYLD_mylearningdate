import {test} from 'node:test';
import assert from 'node:assert/strict';
import {combinedData,reconcileProviders,titleMatch} from '../extension/integrations/model.js';
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
 assert.equal(data.assignments[0].d2lCourseId,'m2','the MyLS course id stays available for MyLS requests');
 assert.equal(data.assignments[0].sourceCourseId,'a1');
 assert.equal(data.assignments[0].courseId,'m1');
});
test('verified Achieve completion resolves the MyLS copy and counts once, under Achieve',()=>{
 const state=fixture(),rows=effectiveAssignments(state,Date.parse('2026-10-01'));
 assert.equal(rows.length,1);assert.equal(rows[0].id,'mls');assert.equal(rows[0].status,'Submitted');
 assert.equal(rows[0].completionProvider,'achieve');
 assert.equal(rows[0].provider,'achieve');assert.deepEqual(rows[0].alsoOn,['d2l']);
 assert.equal(scopedItems(rows,'all','d2l').length,0);assert.equal(scopedItems(rows,'all','achieve').length,1);
 assert.equal(weeklyProgress(rows,new Date('2026-09-29T12:00:00Z')).done,1);
 assert.equal(weeklyProgress(rows,new Date('2026-09-29T12:00:00Z')).total,1);
 assert.equal(state.assignments[0].status,'Pending','source cache must remain unmodified');
});
test('one MyLS item matching both Pearson and Achieve is ambiguous and stays separate',()=>{
 const state=fixture();state.external.pearson={ownerId:'student',state:'connected',courses:[{id:'p1',code:'EC 120'}],assignments:[{...state.external.achieve.assignments[0],id:'pear',courseId:'p1'}]};
 const data=combinedData(state);assert.equal(data.assignments.length,3);assert.equal(data.assignments.find(i=>i.id==='mls').status,'Pending');
 assert.ok(data.mergeLog.some(line=>/matches 2 platform items/.test(line)));
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

// Builds one MyLS item and one platform item in the same class for merge tests.
const pair=(provider,{d2l={},ext={}}={})=>({
 accountId:'student',courses:[{id:'mls-bu',name:'BU111 - Understanding the Business Environment',code:'2243.202609'}],
 assignments:[{id:'d',courseId:'mls-bu',courseCode:'BU 111',title:`${{achieve:'Achieve',pearson:'Pearson MyLab',tophat:'Top Hat'}[provider]} – Ch. 4 HW`,dueDate:'2026-10-01T03:59:00Z',type:'Event',source:'content',status:'Pending',link:'https://mylearningspace.wlu.ca/d2l/le/content/1/viewContent/2/View',...d2l}],
 external:{[provider]:{ownerId:'student',state:'connected',courses:[{id:`${provider}-c`,name:'BU 111 Fall 2026',code:'BU 111'}],assignments:[{id:'x',provider,courseId:`${provider}-c`,courseCode:'BU 111',title:'Chapter 4 Homework',dueDate:'2026-10-01T00:59:00Z',dateKind:'Due',type:'Dropbox',status:'Submitted',completionKind:'Completed',statusSource:'x',link:`${{achieve:'https://achieve.macmillanlearning.com',pearson:'https://mylab.pearson.com',tophat:'https://app.tophat.com'}[provider]}/item`,...ext}]}}
});
test('Achieve, Pearson and Top Hat "Chapter 4 Homework" merge with MyLS "Ch. 4 HW" three hours apart, owned by the platform',()=>{
 for(const provider of ['achieve','pearson','tophat']){
  const rows=combinedData(pair(provider)).assignments;
  assert.equal(rows.length,1,provider);
  const [item]=rows;
  assert.equal(item.provider,provider);assert.equal(item.status,'Submitted');assert.equal(item.statusSource,{achieve:'Achieve',pearson:'Pearson',tophat:'Top Hat'}[provider]);
  assert.equal(item.title,'Chapter 4 Homework');assert.match(item.link,/\/item$/);assert.equal(item.id,'d');
  assert.deepEqual(item.memberIds.sort(),['d','x']);assert.deepEqual(item.alsoOn,['d2l']);
 }
});
test('titles normalize platform names, HW and chapter spellings but never numbers',()=>{
 assert.equal(titleMatch('Achieve – Ch. 4 HW','Chapter 04 Homework'),'exact');
 assert.equal(titleMatch('Pearson MyLab: Chapter 4 Online Homework (online) - due Oct 2 11:59 PM','Ch 4 HW'),'exact');
 assert.equal(titleMatch('Quiz 3','Quiz 3: Organizational Behaviour'),'contains');
 assert.equal(titleMatch('Ch 4 Homework','Ch 5 Homework'),'numbers differ');
 assert.equal(titleMatch('Ch 2 Part 4','Ch 4 Part 2'),'numbers differ');
 assert.equal(titleMatch('Ch 4 Practice Quiz','Ch 4 Quiz'),'different activity type');
 assert.equal(titleMatch('Ch 4 Homework','Ch 4 Quiz'),'different activity type');
});
test('Ch 4 and Ch 5 never merge, and the same title in two classes never merges',()=>{
 const chapter=pair('achieve',{ext:{title:'Chapter 5 Homework'}});
 assert.equal(combinedData(chapter).assignments.length,2);
 const classes=pair('achieve');classes.courses.push({id:'mls-ec',name:'EC120 Microeconomics'});classes.assignments[0].courseId='mls-ec';
 const rows=combinedData(classes).assignments;assert.equal(rows.length,2);assert.equal(rows.find(i=>i.id==='d').status,'Pending');
});
test('two MyLS candidates for one platform item are ambiguous and logged',()=>{
 const state=pair('pearson');state.assignments.push({...state.assignments[0],id:'d2',title:'Chapter 4 Homework'});
 const data=combinedData(state);assert.equal(data.assignments.length,3);
 assert.ok(data.assignments.filter(i=>i.provider!=='pearson').every(i=>i.status==='Pending'));
 assert.ok(data.mergeLog.some(line=>/matches 2 MyLS items/.test(line)));
});
test('an undated MyLS item merges with a unique platform match and takes its due date',()=>{
 const state=pair('achieve',{d2l:{dueDate:null,type:'Quiz'}});
 const [item]=combinedData(state).assignments;
 assert.equal(item.dueDate,'2026-10-01T00:59:00Z');assert.equal(item.provider,'achieve');assert.equal(item.type,'Quiz');
 const missing=pair('achieve',{ext:{dueDate:null,dateKind:null}});
 assert.equal(combinedData(missing).assignments[0].dueDate,'2026-10-01T03:59:00Z','MyLS fills in a missing platform date');
});
test('23:59 Toronto on MyLS and 23:59 read in UTC by a platform tab still merge; days apart do not',()=>{
 for(const dueDate of ['2026-09-30T23:59:00-04:00','2026-09-30T23:59:00Z','2026-10-01T03:59:00Z']) {
  const state=pair('achieve',{d2l:{dueDate:'2026-10-01T03:59:00Z'},ext:{dueDate}});
  assert.equal(combinedData(state).assignments.length,1,dueDate);
 }
 const far=pair('achieve',{ext:{dueDate:'2026-10-03T03:59:00Z'}});
 const data=combinedData(far);assert.equal(data.assignments.length,2);assert.ok(data.mergeLog.some(line=>/26 hours/.test(line)));
});
test('merged completion: MyLS listing or opening a link never completes platform work; real MyLS evidence does',()=>{
 const listed=pair('pearson',{d2l:{status:'Submitted',statusSource:'MyLS',completionEvidence:'content'},ext:{status:'Pending',statusSource:'unverified'}});
 assert.equal(combinedData(listed).assignments[0].status,'Pending');
 const submitted=pair('pearson',{d2l:{type:'Dropbox',source:'dropbox',status:'Submitted',statusSource:'MyLS',completionEvidence:'submission'},ext:{status:'Pending',statusSource:'unverified'}});
 const [item]=combinedData(submitted).assignments;assert.equal(item.status,'Submitted');assert.equal(item.statusSource,'MyLS');
});
test('previously verified platform completion keeps a merge complete when its tab is closed',()=>{
 const state=pair('achieve',{ext:{stale:true,verificationCached:true}});
 const [item]=combinedData(state).assignments;
 assert.equal(item.status,'Submitted');assert.equal(item.verificationCached,true);assert.equal(item.statusSource,'Achieve');
});
test('Pearson, Achieve and Top Hat course names map to the MyLS course',()=>{
 const state={accountId:'student',courses:[{id:'m',name:'EC120A - Microeconomics (Fall 2026)',code:'2243.202609'}],assignments:[],external:{}};
 for(const [provider,name] of [['pearson','EC120 Principles of Microeconomics - Smith - Fall 2026'],['achieve','Microeconomics: EC 120 Fall 2026'],['tophat','EC-120 Microeconomics F26']]) {
  state.external[provider]={ownerId:'student',state:'connected',courses:[{id:`${provider}-1`,name,code:name}],assignments:[{id:`${provider}-a`,provider,courseId:`${provider}-1`,title:'Quiz 1',dueDate:'2026-10-01T00:00:00Z',status:'Pending'}]};
 }
 const data=combinedData(state);
 assert.equal(data.courses.length,1);assert.deepEqual(data.courses[0].memberIds.sort(),['achieve-1','m','pearson-1','tophat-1']);
 assert.ok(data.assignments.every(i=>i.courseId==='m'));
});
test('unmatched platform items stay in their own source view',()=>{
 const state=pair('tophat',{ext:{title:'Reading: Chapter 9'}});
 const rows=effectiveAssignments(state);
 assert.equal(scopedItems(rows,'all','tophat').length,1);assert.equal(scopedItems(rows,'all','d2l').length,1);
});
