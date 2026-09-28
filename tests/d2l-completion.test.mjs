import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sync, attemptCompleted, postedBy } from '../extension/background.js';

test('quiz attempts and discussion posts count only when they are the student\'s own finished work', () => {
  assert.equal(attemptCompleted([]), false);
  assert.equal(attemptCompleted([{ AttemptId: 1, IsGraded: false, Score: null }]), false, 'a started attempt is not completion');
  assert.equal(attemptCompleted([{ AttemptId: 1, IsGraded: true }]), true);
  assert.equal(attemptCompleted([{ AttemptId: 1, Score: 7 }]), true);
  assert.equal(postedBy([{ PostingUserId: 5 }], '99'), false, 'other students\' posts');
  assert.equal(postedBy([{ PostingUserId: 99, IsDeleted: true }], '99'), false);
  assert.equal(postedBy([{ PostingUserId: 99 }], '99'), true);
});

test('sync marks quizzes and discussions complete from attempts and posts, and a 403 stays quiet', async () => {
  const soon = new Date(Date.now() + 3 * 86400000).toISOString();
  const state = { accountId: '99', assignments: [] };
  globalThis.chrome = { storage: { local: { get: async () => structuredClone(state), set: async value => Object.assign(state, value) } }, action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} } };
  let attempts = [{ AttemptId: 1, IsGraded: true }], attemptsStatus = 200, attemptCalls = 0;
  globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    let body;
    if (path.endsWith('versions/')) body = [];
    else if (path.endsWith('whoami')) body = { Identifier: 99 };
    else if (path.includes('myenrollments')) body = { Items: [{ OrgUnit: { Id: 12, Code: 'BU111', Name: 'BU111 Business' }, Access: { IsActive: true, CanAccess: true } }], PagingInfo: { HasMoreItems: false } };
    else if (path.includes('content/myItems') || path.endsWith('calendar/events/myEvents/') || path.endsWith('dropbox/folders/')) body = [];
    else if (path.endsWith('/quizzes/')) body = { Objects: [{ QuizId: 3, Name: 'Quiz 1', DueDate: soon }, { QuizId: 4, Name: 'Quiz 2', DueDate: soon }], Next: null };
    else if (/\/quizzes\/\d+\/attempts\/$/.test(path)) { attemptCalls++; if (attemptsStatus !== 200) return new Response('', { status: attemptsStatus }); body = { Objects: path.includes('/3/') ? attempts : [], Next: null }; }
    else if (path.endsWith('discussions/forums/')) body = [{ ForumId: 8 }];
    else if (path.endsWith('/forums/8/topics/')) body = [{ TopicId: 21, Name: 'Week 3 discussion', DueDate: soon }];
    else if (path.endsWith('/topics/21/posts/')) body = [{ PostingUserId: 5 }, { PostingUserId: 99 }];
    else throw new Error(path);
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  assert.equal((await sync()).ok, true);
  const find = id => state.assignments.find(item => item.id === id);
  assert.equal(find('quiz_12_3').status, 'Submitted'); assert.equal(find('quiz_12_3').completionEvidence, 'attempt');
  assert.equal(find('quiz_12_4').status, 'Pending');
  assert.equal(find('discussion_12_21').status, 'Submitted'); assert.equal(find('discussion_12_21').completionKind, 'Posted');
  assert.deepEqual(state.syncState.warnings, []);
  state.assignments = []; attemptsStatus = 403; attemptCalls = 0;
  assert.equal((await sync()).ok, true);
  assert.equal(attemptCalls, 1, 'after a 403 the other quizzes in that course are not requested');
  assert.equal(find('quiz_12_3').status, 'Pending'); assert.deepEqual(state.syncState.warnings, []);
});
