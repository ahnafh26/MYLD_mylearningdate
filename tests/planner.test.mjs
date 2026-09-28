import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketOf, reminderTime, currentEnrollment, scheduledItem, reconcileItems, categoryOf } from '../extension/planner.js';
import { safeLink, reminderCandidates } from '../extension/background.js';

test('calendar groups use local midnight and Monday boundaries', () => {
  const now = new Date(2026, 8, 27, 12); // Sunday
  const item = date => ({ status: 'Pending', dueDate: date.toISOString() });
  assert.equal(bucketOf(item(new Date(2026, 8, 27, 11)), now), 'Overdue');
  assert.equal(bucketOf(item(new Date(2026, 8, 27, 23)), now), 'Today');
  assert.equal(bucketOf(item(new Date(2026, 8, 28)), now), 'Next week');
  assert.equal(bucketOf(item(new Date(2026, 9, 5)), now), 'Later');
  assert.equal(bucketOf({ ...item(now), status: 'Done' }, now), 'Completed');
  assert.equal(bucketOf(item(new Date(2026, 8, 27, 23)), new Date(2026, 8, 23)), 'This week');
});
test('current courses use Laurier term names/codes and enrollment access dates', () => {
  const now = new Date(2026, 8, 27);
  const row = name => ({ OrgUnit: { Name: name }, Access: {} });
  assert.equal(currentEnrollment(row('BU111 Fall 2026'), now), true);
  assert.equal(currentEnrollment(row('BU111 Winter 2026'), now), false);
  assert.equal(currentEnrollment(row('2243.202609'), now), true);
  assert.equal(currentEnrollment(row('2243.202605'), now), false);
  assert.equal(currentEnrollment(row('Student Orientation'), now), true);
  assert.equal(currentEnrollment({ ...row('BU111'), Access: { EndDate: '2020-01-01' } }, now), false);
});
test('feed joins tool ID from link and retains personal due dates plus completion', () => {
  const course = { id: '12', code: 'BU 111' };
  const feed = scheduledItem({ ItemId: 901, ActivityType: 3, ItemName: 'Essay', ItemUrl: '/d2l/lms/dropbox/user/folder_submit_files.d2l?db=7&ou=12', DueDate: '2026-10-04T12:00:00Z', DateCompleted: '2026-10-02T12:00:00Z' }, course, safeLink);
  const tool = { id: 'dropbox_12_7', courseId: '12', entityId: '7', type: 'Dropbox', title: 'Essay', source: 'dropbox', dueDate: '2026-10-03T12:00:00Z', status: 'Pending', dateKind: 'Due' };
  const merged = reconcileItems([tool, feed]);
  assert.equal(merged.length, 1); assert.equal(merged[0].id, tool.id);
  assert.equal(merged[0].dueDate, feed.dueDate); assert.equal(merged[0].status, 'Submitted');
  assert.deepEqual(merged[0].seenIn, ['dropbox', 'content']);
  assert.equal(scheduledItem({ ItemId: 3, IsExempt: true, DueDate: feed.dueDate }, course, safeLink), null);
});
test('same title on distinct identified activities never collapses', () => {
  const base = { courseId: '12', type: 'Quiz', title: 'Practice', dueDate: '2026-10-04T12:00:00Z' };
  assert.equal(reconcileItems([{ ...base, id: 'a', entityId: '1', source: 'quiz' }, { ...base, id: 'b', entityId: '2', source: 'content' }]).length, 2);
});
test('per-type lead times, course muting, morning cutoff and changed-date receipts', () => {
  const now = new Date(2026, 8, 27, 12), dueDate = new Date(+now + 36 * 3600000).toISOString();
  const item = { id: 'a', type: 'Dropbox', title: 'Lab 1', courseId: '12', status: 'Pending', dueDate };
  assert.equal(categoryOf(item), 'lab');
  const data = { preferences: { reminders: true, reminderLeads: { lab: '2d' } }, lastSync: now.toISOString(), assignments: [item] };
  assert.equal(reminderCandidates(data, +now).length, 1);
  assert.equal(reminderCandidates({ ...data, preferences: { ...data.preferences, mutedCourses: ['12'] } }, +now).length, 0);
  assert.equal(reminderCandidates({ ...data, preferences: { ...data.preferences, reminderLeads: { lab: 'off' } } }, +now).length, 0);
  assert.equal(reminderCandidates({ ...data, reminderReceipts: { [`a|${dueDate}|2d`]: true } }, +now).length, 0);
  const early = new Date(2026, 8, 28, 6);
  assert.equal(reminderTime(early.toISOString(), 'morning'), +early - 3600000);
  assert.equal(reminderCandidates({ ...data, syncState: { code: 'auth' } }, +now).length, 0);
});
