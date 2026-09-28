import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { safeLink, statusOf, hasSubmission, normalizeEvents, normalizeTool, listPages, sync, ORIGIN, effectiveAssignments, trackChanges, reminderCandidates, markDone, courseLabel } from '../extension/background.js';

test('links reject external origins, credentials and executable schemes', () => {
  for (const url of ['javascript:alert(1)', 'https://evil.test/d2l/x', '//evil.test', 'https://user@mylearningspace.wlu.ca/d2l/x']) assert.equal(safeLink(url), `${ORIGIN}/d2l/home`);
  assert.equal(safeLink('/d2l/home/123'), `${ORIGIN}/d2l/home/123`);
});

test('course labels prefer names over internal IDs and separate section suffixes',()=>{
  assert.equal(courseLabel('BU111F - Understanding the Business Environment','2243.202609'),'BU 111');
  assert.equal(courseLabel('EC120A - Introduction to Microeconomics','EC120A'),'EC 120');
  assert.equal(courseLabel('BU 111 - Fall 2026','SIBU111F'),'BU 111');
  assert.equal(courseLabel('Business','SIBU111F'),'BU 111');
  assert.equal(courseLabel('Student Orientation','2243.202609'),'Student Orientation');
  assert.equal(courseLabel('CP104 - Introduction to Programming','202609'),'CP 104');
});
test('overdue is recalculated but submitted stays submitted', () => {
  assert.equal(statusOf({dueDate:'2020-01-01',status:'Pending'}), 'Overdue');
  assert.equal(statusOf({dueDate:'2020-01-01',status:'Submitted'}), 'Submitted');
  assert.equal(statusOf({dueDate:'2099-01-01',status:'Overdue'}), 'Pending');
});
test('submission status uses learner submissions, never aggregate folder totals', () => {
  assert.equal(hasSubmission({TotalFiles:500,TotalUsersWithSubmissions:100}),false);
  assert.equal(hasSubmission({Status:'0',Submissions:[]}),false);
  assert.equal(hasSubmission([{Submissions:[{Id:1}]}]),true);
  assert.equal(hasSubmission({CompletionDate:'2026-01-01'}),true);
});
test('nested events expand occurrences and ignore availability starts', () => {
  const result=normalizeEvents([{EventDataInfo:{CalendarEventId:1,Title:'Quiz',AssociatedEntity:{AssociatedEntityType:'D2L.LE.Quizzing.Quiz',AssociatedEntityId:7}},Occurrences:[{EndDateTime:'2026-10-01T12:00:00Z',RecurrenceId:1},{EndDateTime:'2026-10-08T12:00:00Z',RecurrenceId:2}]},{CalendarEventId:2,EventType:2,EndDateTime:'2026-10-01T12:00:00Z'}],{id:'12',code:'BU 111'});
  assert.equal(result.length,2); assert.notEqual(result[0].id,result[1].id);
  assert.match(result[0].link,/qi=7&ou=12/); assert.equal(result[0].type,'Quiz');
  const exam=normalizeEvents([{CalendarEventId:3,Title:'Midterm exam',StartDateTime:'2026-10-01T09:00:00Z',EndDateTime:'2026-10-01T12:00:00Z'}],{id:'12',code:'BU 111'});
  assert.equal(exam[0].dueDate,'2026-10-01T09:00:00.000Z');
});
test('enrollment bookmarks and calendar next links are fully paginated', async () => {
  let calls=0;
  const rows=await listPages('/d2l/api/test',async url=> ++calls===1?{Items:[1],PagingInfo:{HasMoreItems:true,Bookmark:'a b'}}:(assert.match(url,/bookmark=a\+b/),{Items:[2],PagingInfo:{HasMoreItems:false}}));
  assert.deepEqual(rows,[1,2]);
  await assert.rejects(listPages('/d2l/api/test',async()=>({Objects:[],Next:'https://evil.test'})),/Invalid pagination/);
  await assert.rejects(listPages('/d2l/api/test',async()=>({Objects:[],Next:'/d2l/api/test'})),/pagination did not finish/);
});
test('sync deduplicates assignments, isolates accounts, and retains cache on failures', async () => {
  let state={accountId:'old',assignments:[{id:'private-old'}]}, mode='ok', folderCalls=0;
  globalThis.chrome={storage:{local:{get:async()=>structuredClone(state),set:async value=>Object.assign(state,value)}},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}}};
  globalThis.fetch=async url=>{
    const path=new URL(url).pathname;
    if(mode==='auth') return new Response('',{status:401});
    let body;
    if(path.endsWith('versions/')) body=[];
    else if(path.endsWith('whoami')) body={Identifier:99};
    else if(path.includes('myenrollments')) body={Items:[{OrgUnit:{Id:12,Code:'BU111',Name:'Business'},Access:{IsActive:true,CanAccess:true}}],PagingInfo:{HasMoreItems:false}};
    else if(path.includes('content/myItems')) body=[];
    else if(path.endsWith('calendar/events/myEvents/')) {
      if(mode==='calendar-fail') return new Response('',{status:500});
      body=[{CalendarEventId:1,OrgUnitId:12,Title:'Essay',EndDateTime:'2099-01-01T12:00:00Z',AssociatedEntity:{AssociatedEntityType:'D2L.LE.Dropbox.Dropbox',AssociatedEntityId:7}}];
    } else if(path.endsWith('dropbox/folders/')) {folderCalls++;body=[{Id:7,Name:'Essay',DueDate:'2099-01-01T12:00:00Z'}];}
    else if(path.endsWith('mysubmissions/')) body=[{Submissions:[{Id:123}]}];
    else if(path.endsWith('quizzes/') || path.endsWith('discussions/forums/')) body=[];
    else throw new Error(path);
    return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
  };
  await Promise.all([sync(),sync()]);
  assert.equal(folderCalls,1);assert.equal(state.accountId,'99');assert.equal(state.assignments.length,1);assert.equal(state.assignments[0].status,'Submitted');assert.equal(state.complete,true);
  const cached=structuredClone(state.assignments);
  mode='auth';assert.equal((await sync()).ok,false);assert.deepEqual(state.assignments,cached);assert.equal(state.syncState.code,'auth');
  mode='calendar-fail';await sync();assert.equal(state.complete,false);assert.ok(state.syncState.warnings.length);
  const directFetch=globalThis.fetch;
  mode='ok';
  globalThis.fetch=async()=>new Response('',{status:403});
  let bridgeCalls=0;
  chrome.tabs={query:async()=>[{id:1,active:true}],sendMessage:async(id,message)=>{
    bridgeCalls++;const response=await directFetch(message.path);
    return {status:response.status,isJson:true,body:await response.json()};
  }};
  assert.equal((await sync()).ok,true);assert.ok(bridgeCalls>=5);
  assert.equal(state.diagnostics.requests.some(r=>/\/12\//.test(r.endpoint)),false);
  chrome.tabs.sendMessage=async()=>({status:403,isJson:false});
  assert.equal((await sync()).ok,false);assert.equal(state.syncState.code,'permission');assert.match(state.syncState.error,/whoami/);
});

test('local completion never overwrites verified submission status',()=>{
  const data={assignments:[{id:'a',status:'Pending',dueDate:'2099-01-01'},{id:'b',status:'Submitted',dueDate:'2020-01-01'}],completedIds:{a:true,b:true}};
  assert.deepEqual(effectiveAssignments(data).map(i=>i.status),['Done','Submitted']);
  assert.equal(data.assignments[0].status,'Pending');
});
test('changed dates keep stable identity and stale rows do not invent changes',()=>{
  const old=[{id:'a',dueDate:'2026-10-01T12:00:00Z'}];
  const fresh=[{id:'a',dueDate:'2026-10-02T12:00:00Z'}];
  assert.equal(trackChanges(fresh,old,'2026-09-27T12:00:00Z')[0].changedFrom,old[0].dueDate);
  assert.equal(trackChanges([{...fresh[0],stale:true}],old)[0].changedFrom,undefined);
});
test('reminders survive offline cache and skip completed, muted and already notified items',()=>{
  const now=Date.now(),dueDate=new Date(now+12*3600000).toISOString();
  const data={preferences:{reminders:true},complete:true,lastSync:new Date(now).toISOString(),assignments:[{id:'a',type:'Dropbox',status:'Pending',dueDate},{id:'b',status:'Submitted',dueDate},{id:'c',status:'Pending',dueDate}],completedIds:{c:true}};
  assert.deepEqual(reminderCandidates(data,now).map(i=>i.id),['a']);
  assert.equal(reminderCandidates({...data,reminderReceipts:{[`a|${dueDate}`]:true}},now).length,0);
  assert.equal(reminderCandidates({...data,complete:false},now).length,1);
  assert.equal(reminderCandidates({...data,lastSync:'2026-09-26T00:00:00Z',syncState:{error:'offline'}},now).length,1);
});
test('tool mapping prefers due dates, retains undated quizzes and excludes hidden work',()=>{
  const course={id:'12',code:'BU 111'};
  const item=normalizeTool({QuizId:7,Name:'Quiz',DueDate:'2026-10-01T12:00:00Z',EndDate:'2026-10-02T12:00:00Z'},'Quiz',course);
  assert.equal(item.dateKind,'Due');assert.equal(item.dueDate,'2026-10-01T12:00:00.000Z');
  assert.equal(normalizeTool({QuizId:7},'Quiz',course).dueDate,null);
  assert.equal(normalizeTool({QuizId:7,IsHidden:true,DueDate:item.dueDate},'Quiz',course),null);
});

test('tab bridge accepts only own-extension read routes and uses same-origin GET', async()=>{
  let listener;const requests=[];
  const context={chrome:{runtime:{id:'myld',onMessage:{addListener:fn=>listener=fn}}},location:{origin:ORIGIN},URL,AbortSignal,
    fetch:async(url,options)=>{requests.push({url,options});return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({Identifier:9})};}};
  vm.runInNewContext(await readFile(new URL('../extension/session-bridge.js',import.meta.url),'utf8'),context);
  for(const path of ['/d2l/api/versions/evil','/d2l/api/lp/1.43/users/whoami/evil','https://evil.test/d2l/api/versions/','/d2l/api/lp/1.43/users/']){
    assert.equal(listener({type:'MYLD_READ',path},{id:'myld'},()=>{}),undefined);
  }
  assert.equal(listener({type:'MYLD_READ',path:'/d2l/api/versions/'},{id:'other'},()=>{}),undefined);
  const result=await new Promise(resolve=>assert.equal(listener({type:'MYLD_READ',path:'/d2l/api/lp/1.43/users/whoami'},{id:'myld'},resolve),true));
  assert.equal(result.status,200);assert.equal(requests.length,1);assert.equal(requests[0].options.method,'GET');assert.equal(requests[0].options.credentials,'same-origin');
});
test('a 403 on one submission lookup is noted on the item, not raised as a sync warning', async () => {
  const state={accountId:'99',assignments:[]};
  globalThis.chrome={storage:{local:{get:async()=>structuredClone(state),set:async value=>Object.assign(state,value)}},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}}};
  let submissions=403;
  globalThis.fetch=async url=>{
    const path=new URL(url).pathname;
    let body;
    if(path.endsWith('versions/')) body=[];
    else if(path.endsWith('whoami')) body={Identifier:99};
    else if(path.includes('myenrollments')) body={Items:[{OrgUnit:{Id:12,Code:'BBA',Name:'BBA Program Information'},Access:{IsActive:true,CanAccess:true}}],PagingInfo:{HasMoreItems:false}};
    else if(path.includes('content/myItems') || path.endsWith('calendar/events/myEvents/')) body=[];
    else if(path.endsWith('dropbox/folders/')) body=[{Id:7,Name:'Program form',DueDate:'2099-01-01T12:00:00Z'}];
    else if(path.endsWith('mysubmissions/')) { if(submissions!==200) return new Response('',{status:submissions}); body=[]; }
    else if(path.endsWith('quizzes/') || path.endsWith('discussions/forums/')) body=[];
    else throw new Error(path);
    return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
  };
  assert.equal((await sync()).ok,true);
  assert.deepEqual(state.syncState.warnings,[]);assert.equal(state.complete,true);
  const item=state.assignments.find(row=>row.entityId==='7');
  assert.equal(item.statusSource,'restricted');assert.equal(item.status,'Pending');assert.ok(!item.stale);
  submissions=500;
  await sync();
  assert.match(state.syncState.warnings[0],/submission status could not be verified/);assert.equal(state.complete,false);
});
