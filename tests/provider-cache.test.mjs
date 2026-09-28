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
