import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './helpers/dom.mjs';
import { readProviderPage } from '../extension/integrations/page-reader.js';

// Fixture dates have no time zone, so expectations use the same local-time construction.
const local = (y, m, d, h = 23, min = 59) => new Date(y, m - 1, d, h, min).toISOString();
const read = async (file, url, provider) => { await loadPage(file, url); return readProviderPage(provider); };
const byId = rows => Object.fromEntries(rows.map(row => [row.externalId, row]));

test('Achieve reads complete, submitted-late, scored, in-progress, undated and collapsed rows', async () => {
  const result = await read('achieve-mycourse.html', 'https://achieve.macmillanlearning.com/courses/c123/mycourse', 'achieve');
  assert.equal(result.state, 'connected'); assert.equal(result.account, 'Sam Student'); assert.equal(result.courseId, 'c123');
  const rows = byId(result.rows);
  assert.deepEqual(Object.keys(rows).sort(), ['a1', 'a2', 'a3', 'a4', 'a5', 'p1', 'w1']);
  assert.equal(rows.a1.completed, true); assert.equal(rows.a1.dueDate, local(2026, 9, 30));
  assert.equal(rows.a2.completed, false, 'in progress, and class-wide "students completed" is not the student');
  assert.equal(rows.a3.completed, true); assert.equal(rows.a3.completionKind, 'Submitted late');
  assert.equal(rows.a4.completed, true); assert.equal(rows.a4.dueDate, null, 'rows without a due date are kept');
  assert.equal(rows.a5.completed, false, '"Graded" in a title and 40% progress are not completion');
  assert.equal(rows.p1.completed, true, 'collapsed Past Assignments rows are read without expanding them');
  assert.equal(rows.w1.completed, true); assert.equal(rows.w1.dueDate, local(2027, 1, 15), 'January in a Fall 2026 course is the next year');
  assert.match(rows.a1.link, /mycourse#a1$/);
});

test('Achieve without a signed-in account or outside My Course fails closed', async () => {
  await loadPage('tophat-empty.html', 'https://achieve.macmillanlearning.com/courses/c123/mycourse');
  assert.equal(readProviderPage('achieve').state, 'needs-login');
  await loadPage('achieve-mycourse.html', 'https://achieve.macmillanlearning.com/courses/c123/gradebook');
  assert.equal(readProviderPage('achieve').state, 'unavailable');
});

test('Pearson MyLab: score and submitted rows complete, attempts alone do not, undated rows kept', async () => {
  const result = await read('pearson-mylab.html', 'https://mylab.pearson.com/courses/555/assignments', 'pearson');
  assert.equal(result.state, 'rows'); assert.equal(result.courseId, '555');
  const rows = byId(result.rows);
  assert.equal(rows.H_1001.completed, true, '"See score"');
  assert.equal(rows.Q_2002.completed, true, 'numeric score'); assert.equal(rows.Q_2002.type, 'Quiz');
  assert.equal(rows.H_1003.completed, false, 'an attempt count alone is not completion');
  assert.equal(rows.H_1004.completed, true); assert.equal(rows.H_1004.dueDate, null);
  assert.equal(rows.H_1001.dueDate, local(2026, 9, 30));
  assert.equal(rows.H_1001.link, 'https://mylab.pearson.com/courses/555/assignments', 'JavaScript launchers are never used as links');
});

test('Pearson Mastering tables deep-link to the item and report completion', async () => {
  const result = await read('pearson-mastering.html', 'https://mylabmastering.pearson.com/courses/777/home', 'pearson');
  assert.equal(result.state, 'context'); assert.equal(result.account, 'Sam Student');
  const rows = byId(result.masteringRows);
  assert.equal(rows['m-1'].completed, true); assert.equal(rows['m-2'].completed, false, '"Not started"');
  assert.equal(rows['m-1'].link, 'https://mylabmastering.pearson.com/myct/assignment?assignmentId=m-1');
  assert.equal(rows['m-2'].dueDate, local(2026, 10, 8));
});

test('Pearson console reads assignment tables, keeps links on Pearson, and fails closed on other layouts', async () => {
  const result = await read('pearson-console.html', 'https://console.pearson.com/courses/abc', 'pearson');
  assert.equal(result.state, 'connected'); assert.equal(result.account, 'Sam Student');
  const rows = byId(result.rows);
  assert.equal(rows['c-1'].completed, true); assert.equal(rows['c-1'].link, 'https://console.pearson.com/courses/abc/assignments/c-1');
  assert.equal(rows['c-2'].completed, false); assert.equal(rows['c-2'].link, 'https://console.pearson.com/courses/abc', 'off-site links are replaced');
  const cards = await read('pearson-console-cards.html', 'https://console.pearson.com/courses/abc', 'pearson');
  assert.equal(cards.state, 'unavailable'); assert.equal(cards.rows, undefined);
});

test('Top Hat reads dated items with submitted, graded and percent completion, and skips undated ones', async () => {
  const result = await read('tophat-course.html', 'https://app.tophat.com/e/424242/content', 'tophat');
  assert.equal(result.state, 'connected'); assert.equal(result.account, 'Sam Student'); assert.equal(result.courseId, '424242');
  const rows = byId(result.rows);
  assert.deepEqual(Object.keys(rows).sort(), ['th-1', 'th-2', 'th-3', 'th-5', 'th-6'], 'undated attendance is left out');
  assert.equal(rows['th-1'].completed, true); assert.equal(rows['th-1'].dueDate, local(2026, 9, 30));
  assert.equal(rows['th-2'].completed, true); assert.equal(rows['th-2'].type, 'Quiz'); assert.equal(rows['th-2'].dueDate, local(2026, 10, 2, 9, 0));
  assert.equal(rows['th-3'].completed, false, '50% complete is progress, not completion');
  assert.equal(rows['th-5'].completed, false, '"Graded" in the title is not a status');
  assert.equal(rows['th-6'].completed, true, '100% complete');
});

test('Top Hat pages without a recognizable list import nothing', async () => {
  const result = await read('tophat-empty.html', 'https://app.tophat.com/e/424242', 'tophat');
  assert.equal(result.state, 'unavailable'); assert.equal(result.rows, undefined);
  await loadPage('pearson-mylab.html', 'https://app.tophat.com/e/424242');
  assert.equal(readProviderPage('tophat').state, 'needs-login');
});

test('Top Hat\'s Canadian site is read the same way', async () => {
  const result = await read('tophat-course.html', 'https://app-ca.tophat.com/e/424242/content', 'tophat');
  assert.equal(result.state, 'connected'); assert.equal(result.rows.length, 5);
  assert.ok(result.rows.every(row => row.link.startsWith('https://app-ca.tophat.com/')));
});

test('blank frames inside a page are ignored instead of reporting an unsupported page', async () => {
  await loadPage('tophat-empty.html', 'https://example.pearson.com/frame');
  globalThis.window = { top: {} };
  try { assert.equal(readProviderPage('pearson').state, 'ignored'); }
  finally { delete globalThis.window; }
  assert.equal(readProviderPage('pearson').state, 'unavailable');
});
