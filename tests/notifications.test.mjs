import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendReminders } from '../extension/background.js';

test('delivery rechecks submissions, suppresses concurrent duplicates and persists receipts', async () => {
  const dueDate = new Date(Date.now() + 12 * 3600000).toISOString();
  let state = { accountId: '9', lastSync: new Date().toISOString(), apiVersions: { lp: '1.43', le: '1.67' }, preferences: { reminders: true }, assignments: [{ id: 'a', courseId: '12', courseCode: 'BU 111', entityId: '7', type: 'Dropbox', title: 'Essay', dueDate, status: 'Pending' }] };
  const notices = [];
  globalThis.chrome = { storage: { local: { get: async () => structuredClone(state), set: async values => Object.assign(state, values) } }, permissions: { contains: async () => true }, notifications: { create: async (id, value) => { notices.push(value); return id; } } };
  let submitted = true;
  globalThis.fetch = async url => new Response(JSON.stringify(String(url).includes('whoami') ? { Identifier: '9' } : submitted ? [{ Submissions: [{ SubmissionDate: new Date().toISOString() }] }] : []), { headers: { 'content-type': 'application/json' } });
  await sendReminders(); assert.equal(notices.length, 0); assert.equal(state.assignments[0].status, 'Submitted');
  state.assignments[0].status = 'Pending'; submitted = false;
  await Promise.all([sendReminders(), sendReminders()]); assert.equal(notices.length, 1);
  assert.match(notices[0].message, /Essay/); assert.equal(Object.keys(state.reminderReceipts).length, 1);
  await sendReminders(); assert.equal(notices.length, 1);
  state.reminderReceipts = {}; state.completedIds = { a: true };
  await sendReminders(); assert.equal(notices.length, 1);
  state.completedIds = {}; globalThis.fetch = async () => new Response(JSON.stringify({ Identifier: 'different' }), { headers: { 'content-type': 'application/json' } });
  await sendReminders(); assert.equal(notices.length, 1);
});
