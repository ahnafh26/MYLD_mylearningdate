import { combinedData, keepVerified, assignmentLink, providerOf, EXTERNAL_PROVIDERS } from './integrations/model.js';
import { syncProvider } from './integrations/providers.js';
import { connectCalendar, disconnectCalendar, addCalendarItems } from './integrations/google-calendar.js';
import { DEFAULT_LEADS, categoryOf, reminderTime, termWindow, currentEnrollment, scheduledItem, reconcileItems } from './planner.js';
export const ORIGIN = 'https://mylearningspace.wlu.ca';
export const DEFAULT_PREFS = { showSubmitted: false, badge: true, syncMinutes: 30, reminders: false, theme: 'light', reminderLeads: DEFAULT_LEADS, mutedCourses: [], movedReminders: true };
const COLORS = ['#a78bfa', '#e9bc63', '#67c9b7', '#83b8ed', '#e7a0bf', '#b3cc79'];
const HOUR = 3600000;
let inFlight;
let requestTransport = 'worker';
let diagnostics = [];
let completionWrite = Promise.resolve();
let notificationsRunning = false;
let integrationPending = 0;

class ApiError extends Error {
  constructor(message, code = 'network') { super(message); this.code = code; }
}

export function safeLink(value, fallback = `${ORIGIN}/d2l/home`) {
  try {
    const raw = String(value || '').replace(/^\[.*?\]\((.*?)\)/, '$1');
    const url = new URL(raw, ORIGIN);
    if (raw && url.origin === ORIGIN && url.pathname.startsWith('/d2l/') && !url.username && !url.password) return url.href;
  } catch {}
  return fallback;
}

async function request(path, options = {}) {
  const url = new URL(path, ORIGIN);
  if (url.origin !== ORIGIN || !url.pathname.startsWith('/d2l/api/')) throw new ApiError('Invalid API address.', 'data');
  let response;
  let via = 'worker';
  if (requestTransport === 'tab') {
    const bridged = await tabRequest(url);
    if (bridged?.status === 200 && bridged.isJson) {
      recordRequest(url, bridged.status, 'tab');
      return bridged.body;
    }
  }
  try {
    response = await fetch(url, { credentials: 'include', cache: 'no-store', redirect: 'error',
      ...options, headers: { Accept: 'application/json', ...options.headers }, signal: AbortSignal.timeout(20000) });
  } catch {}
  if (!response || [401, 403].includes(response.status) || (response.ok && !(response.headers.get('content-type') || '').includes('json'))) {
    const bridged = await tabRequest(url);
    if (bridged) { via = 'tab'; response = new Response(bridged.isJson ? JSON.stringify(bridged.body) : '', {
      status: bridged.status, headers: { 'content-type': bridged.isJson ? 'application/json' : 'text/html' }
    }); if (bridged.status === 200 && bridged.isJson) requestTransport = 'tab'; }
  }
  recordRequest(url, response?.status || 0, via);
  if (!response) throw new ApiError('Could not reach MyLS. Keep your signed-in MyLS tab open, reload that tab, then refresh MYLD.');
  if (response.status === 401) throw new ApiError(`MyLS did not accept the session (401). Reload your signed-in MyLS tab, then refresh MYLD. Request: ${url.pathname}`, 'auth');
  if (response.status === 403) throw new ApiError(`MyLS denied this request (403). This can be an API permission restriction, even while signed in. Request: ${url.pathname}`, 'permission');
  if (response.status === 429) throw new ApiError('MyLS is busy. Wait a few minutes before refreshing.', 'rate');
  if (!response.ok) throw new ApiError(`MyLS returned HTTP ${response.status}.`, String(response.status));
  if (!(response.headers.get('content-type') || '').includes('json')) throw new ApiError('Please log in to MyLearningSpace to sync your courses', 'auth');
  try { return await response.json(); } catch { throw new ApiError('MyLS returned unreadable data.', 'data'); }
}

function recordRequest(url, status, via) {
  diagnostics.push({ endpoint: url.pathname.replace(/\/\d+(?=\/|$)/g, '/{id}'), status, via });
  if (diagnostics.length > 150) diagnostics.shift();
}

async function tabRequest(url) {
  if (!globalThis.chrome?.tabs?.query) return null;
  let last = null;
  try {
    const tabs = await chrome.tabs.query({ url: `${ORIGIN}/d2l/*` });
    for (const tab of tabs.sort((a, b) => Number(b.active) - Number(a.active))) {
      try {
        const reply = await chrome.tabs.sendMessage(tab.id, { type: 'MYLD_READ', path: url.href });
        if (!reply || reply.networkError || !Number.isInteger(reply.status) || reply.status < 200 || reply.status > 599) continue;
        if (reply.status === 200 && reply.isJson) return reply;
        last = reply;
      } catch {}
    }
  } catch {}
  return last;
}

export async function listPages(path, get = request) {
  const rows = [], seen = new Set();
  let next = new URL(path, ORIGIN).href;
  while (next) {
    if (seen.has(next) || seen.size >= 200) throw new ApiError('MyLS pagination did not finish.', 'data');
    seen.add(next);
    const page = await get(next);
    const items = Array.isArray(page) ? page : page?.Items ?? page?.Objects;
    if (!Array.isArray(items)) throw new ApiError('Unexpected MyLS list format.', 'data');
    rows.push(...items);
    next = null;
    if (page?.PagingInfo?.HasMoreItems) {
      if (!page.PagingInfo.Bookmark) throw new ApiError('MyLS omitted a pagination bookmark.', 'data');
      const url = new URL(path, ORIGIN);
      url.searchParams.set('bookmark', page.PagingInfo.Bookmark);
      next = url.href;
    } else if (page?.Next) {
      const url = new URL(page.Next, ORIGIN);
      if (url.origin !== ORIGIN || !url.pathname.startsWith('/d2l/api/')) throw new ApiError('Invalid pagination link.', 'data');
      next = url.href;
    }
  }
  return rows;
}

async function versions() {
  const preferred = { lp: '1.43', le: '1.67' };
  try {
    const result = await request('/d2l/api/versions/');
    for (const item of Array.isArray(result) ? result : []) {
      if (item.ProductCode in preferred && /^1\.\d+$/.test(item.LatestVersion)) preferred[item.ProductCode] = item.LatestVersion;
    }
  } catch (error) { if (error.code === 'rate') throw error; }
  return preferred;
}

export function statusOf(item, now = Date.now()) {
  if (item.status === 'Submitted') return 'Submitted';
  if (item.manualDone) return 'Done';
  return Date.parse(item.dueDate) < now ? 'Overdue' : 'Pending';
}

export function courseLabel(name, code) {
  // Display names describe the course; OrgUnit.Code can be an internal MyLS ID.
  const extract = value => {
    const text = String(value || '').trim();
    const match = text.match(/(?:^|[\s(_/–—-])([A-Z]{2,4})[\s_-]*(\d{3})(?:[A-Z]{0,2})(?=$|[\s)_./–—-])/i);
    if (!match) return null;
    const subject = match[1].toUpperCase();
    if (subject === 'SIBU') return `BU ${match[2]}`;
    return `${subject} ${match[2]}`;
  };
  return extract(name) || extract(code) || String(name || 'Course').trim();
}

export function effectiveAssignments(data, now = Date.now()) {
  return combinedData(data).assignments.map(item => {
    const next = { ...item, manualDone: (item.memberIds || [item.id]).some(id => Boolean(data.completedIds?.[id])) };
    return { ...next, status: statusOf(next, now) };
  });
}

export function trackChanges(items, old, now = new Date().toISOString()) {
  const previous = new Map(old.map(item => [item.id, item]));
  return items.map(item => {
    const before = previous.get(item.id);
    if (!item.stale && before && Number.isFinite(Date.parse(before.dueDate)) && Number.isFinite(Date.parse(item.dueDate)) && before.dueDate !== item.dueDate) return { ...item, changedFrom: before.dueDate, changedAt: now };
    if (before?.changedAt && Date.parse(now) - Date.parse(before.changedAt) < 7 * 86400000) return { ...item, changedFrom: before.changedFrom, changedAt: before.changedAt };
    return item;
  });
}

function iso(value) { const time = value ? Date.parse(value) : NaN; return Number.isFinite(time) ? new Date(time).toISOString() : null; }
function plain(value) { return typeof value === 'string' ? value : value?.Text || ''; }
function typeOf(value = '') { return /dropbox|assignment/i.test(value) ? 'Dropbox' : /quiz/i.test(value) ? 'Quiz' : /discussion/i.test(value) ? 'Discussion' : 'Event'; }
function folderLink(course, id) { return `${ORIGIN}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${encodeURIComponent(id)}&ou=${encodeURIComponent(course)}`; }

export function normalizeEvents(events, course) {
  return events.flatMap(wrapped => {
    const event = wrapped.EventDataInfo || wrapped;
    if ([1, 2, 4].includes(Number(event.EventType)) || event.VisibilityRestrictions?.Type === 5) return [];
    const entity = event.AssociatedEntity || {};
    const type = typeOf(entity.AssociatedEntityType || event.Type);
    if (!entity.AssociatedEntityId && (event.IsRecurring || !/due|deadline|assignment|quiz|lab|exam|test|report|project|essay|discussion|homework|midterm|final|presentation/i.test(event.Title || ''))) return [];
    const entityId = entity.AssociatedEntityId == null ? null : String(entity.AssociatedEntityId);
    const dates = wrapped.Occurrences?.length ? wrapped.Occurrences : [event];
    return dates.flatMap((date, index) => {
      const dueDate = iso(date.DueDate || (!entityId && (date.StartDateTime || date.StartDay)) || date.EndDate || date.EndDateTime || date.StartDateTime || date.StartDay || date.EndDay);
      if (!dueDate) return [];
      const fallback = type === 'Dropbox' && entityId ? folderLink(course.id, entityId)
        : type === 'Quiz' && entityId ? `${ORIGIN}/d2l/lms/quizzing/user/quiz_summary.d2l?qi=${encodeURIComponent(entityId)}&ou=${encodeURIComponent(course.id)}`
        : `${ORIGIN}/d2l/home/${encodeURIComponent(course.id)}`;
      const item = {
        id: `evt_${course.id}_${event.CalendarEventId ?? event.Id ?? entityId ?? 'event'}_${date.RecurrenceId ?? index}`,
        source: 'calendar', seenIn: ['calendar'], courseId: course.id, courseCode: course.code, title: event.Title || 'Untitled event', type,
        dueDate, description: plain(event.Description), entityId,
        link: safeLink(entity.Link || event.Url || event.CalendarEventViewUrl, fallback),
        status: 'Pending', statusSource: 'unverified', dateKind: [3, 5].includes(Number(event.EventType)) ? 'Closes' : Number(event.EventType) === 6 || event.DueDate ? 'Due' : 'Calendar'
      };
      item.status = statusOf(item);
      return [item];
    });
  });
}

export function hasSubmission(data) {
  if (Array.isArray(data)) return data.some(hasSubmission);
  return Boolean(data && (Array.isArray(data.Submissions) && data.Submissions.length > 0 || data.SubmissionDate || data.CompletionDate || [1, 2, 3].includes(Number(data.Status))));
}

export function normalizeTool(row, type, course) {
  const entityId = row.QuizId ?? row.TopicId ?? row.Id;
  const dueDate = iso(row.DueDate || row.UnlockEndDate || row.EndDate || row.PostEndDate);
  if (entityId == null || (!dueDate && type !== 'Quiz') || row.IsHidden === true || row.IsActive === false) return null;
  const query = new URLSearchParams({ ou: course.id });
  if (type === 'Quiz') query.set('qi', entityId); else query.set('tid', entityId);
  const path = type === 'Quiz' ? '/d2l/lms/quizzing/user/quiz_summary.d2l' : '/d2l/le/discussions/List';
  return { id: `${type.toLowerCase()}_${course.id}_${entityId}`, entityId: String(entityId), ...(type === 'Discussion' && row.ForumId != null ? { forumId: String(row.ForumId) } : {}), courseId: course.id, courseCode: course.code, title: row.Name || type,
    source: type.toLowerCase(), seenIn: [type.toLowerCase()], opensAt: row.StartDate || row.UnlockStartDate || null, type, dueDate, dateKind: row.DueDate ? 'Due' : 'Closes', status: 'Pending', statusSource: 'unverified', link: `${ORIGIN}${path}?${query}` };
}

function mergeTool(items, item) {
  if (!item) return items;
  const calendar = items.find(other => other.type === item.type && other.entityId === item.entityId && !other.stale);
  if (calendar) {
    item.link = calendar.link;
    if (!item.dueDate) { item.dueDate = calendar.dueDate; item.dateKind = calendar.dateKind; }
  }
  return [...items.filter(other => !(other.type === item.type && other.entityId === item.entityId)), item];
}

async function courseData(course, version, old, calendarRows, accountId) {
  const base = `/d2l/api/le/${version}/${encodeURIComponent(course.id)}`;
  const warnings = [];
  let items = [], folders = [], calendarOK = false, foldersOK = false;
  try {
    const window = termWindow();
    const query = new URLSearchParams({ startDateTime: new Date(+window.start - 14 * 86400000).toISOString(), endDateTime: new Date(+window.end + 21 * 86400000).toISOString() });
    items = normalizeEvents(calendarRows ?? await listPages(`${base}/calendar/events/myEvents/?${query}`), course);
    calendarOK = true;
  } catch (error) {
    if (error.code === 'auth' || error.code === 'rate') throw error;
    warnings.push(`${course.code}: calendar unavailable; cached events retained.`);
    items = old.map(item => ({ ...item, stale: true }));
  }
  try { folders = await listPages(`${base}/dropbox/folders/`); foldersOK = true; }
  catch (error) {
    if (error.code === 'auth' || error.code === 'rate') throw error;
    warnings.push(`${course.code}: assignments unavailable; cached assignments retained.`);
    const ids = new Set(items.map(item => item.id));
    items.push(...old.filter(item => item.type === 'Dropbox' && !ids.has(item.id)).map(item => ({ ...item, stale: true })));
  }
  let categories = [];
  if (folders.some(folder => folder.CategoryId != null)) {
    try { categories = await listPages(`${base}/dropbox/categories/`); } catch (error) { if (['auth', 'rate'].includes(error.code)) throw error; }
  }
  for (const folder of folders.filter(folder => !folder.IsHidden && folder.Id != null)) {
    const id = String(folder.Id);
    const linked = items.filter(item => item.type === 'Dropbox' && item.entityId === id);
    const dueDate = linked.find(item => item.dateKind === 'Due')?.dueDate || iso(folder.DueDate || folder.Availability?.EndDate) || linked[0]?.dueDate;
    if (!dueDate) continue;
    let submitted = false, verified = false, restricted = false, groupId = null;
    try {
      const submissions = await request(`${base}/dropbox/folders/${encodeURIComponent(id)}/submissions/mysubmissions/`);
      submitted = hasSubmission(submissions); verified = true;
      if (Array.isArray(submissions)) groupId = submissions.find(row => row.Entity?.EntityId)?.Entity.EntityId;
    }
    catch (error) {
      if (error.code === 'auth' || error.code === 'rate') throw error;
      // 403: MyLS doesn't share submissions for this folder (e.g. info-only program shells), which isn't a sync failure.
      restricted = error.code === 'permission';
      if (!restricted) warnings.push(`${course.code}: a submission status could not be verified.`);
      submitted = old.some(item => item.entityId === id && item.type === 'Dropbox' && item.status === 'Submitted');
    }
    items = items.filter(item => !(item.type === 'Dropbox' && item.entityId === id));
    const item = {
      id: `dropbox_${course.id}_${id}`, entityId: id, courseId: course.id, courseCode: course.code,
      title: folder.Name || linked[0]?.title || 'Assignment', type: 'Dropbox', dueDate,
      source: 'dropbox', seenIn: ['dropbox'], categoryName: categories.find(category => category.Id === folder.CategoryId)?.Name, opensAt: folder.Availability?.StartDate || null,
      description: plain(folder.CustomInstructions), link: folder.GroupTypeId != null ? groupId ? `${folderLink(course.id, id)}&grpid=${encodeURIComponent(groupId)}` : `${ORIGIN}/d2l/lms/dropbox/user/folders_list.d2l?ou=${encodeURIComponent(course.id)}` : linked[0]?.link || folderLink(course.id, id),
      status: submitted ? 'Submitted' : 'Pending', statusSource: verified || (restricted && submitted) ? 'MyLS' : restricted ? 'restricted' : 'unverified', ...(submitted ? { completionEvidence: 'submission' } : {}),
      dateKind: folder.DueDate || linked.some(item => item.dateKind === 'Due') ? 'Due' : 'Closes', stale: !verified && !restricted
    };
    if (restricted && submitted) item.verificationCached = true;
    item.status = statusOf(item);
    items.push(item);
  }
  for (const type of ['Quiz', 'Discussion']) {
    try {
      let rows;
      if (type === 'Quiz') rows = await listPages(`${base}/quizzes/`);
      else {
        rows = [];
        const forums = await listPages(`${base}/discussions/forums/`);
        for (const forum of forums.filter(f => !f.IsHidden && f.ForumId != null)) rows.push(...(await listPages(`${base}/discussions/forums/${encodeURIComponent(forum.ForumId)}/topics/`)).map(topic => ({ ...topic, ForumId: topic.ForumId ?? forum.ForumId })));
      }
      for (const row of rows) items = mergeTool(items, normalizeTool(row, type, course));
    } catch (error) {
      if (error.code === 'auth' || error.code === 'rate') throw error;
      warnings.push(`${course.code}: ${type.toLowerCase()} details unavailable; check MyLS.`);
      for (const previous of old.filter(item => item.type === type)) {
        if (!items.some(item => item.type === type && item.entityId === previous.entityId)) items.push({ ...previous, stale: true });
      }
    }
  }
  await verifyToolCompletion(items, base, accountId);
  return { items, warnings, complete: calendarOK && foldersOK && !warnings.length };
}

// Quizzes and discussions have no "my submission" route, so completion comes from the
// student's own quiz attempts and discussion posts. MyLS may not expose these to students
// (403/404); then the course's items keep relying on content completion, without a warning.
export function attemptCompleted(attempts) {
  return (Array.isArray(attempts) ? attempts : []).some(attempt => Boolean(attempt && (attempt.TimeCompleted || attempt.DateCompleted || attempt.CompletedDate || attempt.SubmittedDate || attempt.IsGraded === true || (attempt.Score != null && attempt.Score !== ''))));
}
export function postedBy(posts, accountId) {
  return (Array.isArray(posts) ? posts : []).some(post => accountId != null && String(post?.PostingUserId) === String(accountId) && !post.IsDeleted);
}
async function toolCompleted(item, base, accountId) {
  if (item.type === 'Quiz') return attemptCompleted(await listPages(`${base}/quizzes/${encodeURIComponent(item.entityId)}/attempts/`)) && 'attempt';
  if (item.type === 'Discussion' && item.forumId) return postedBy(await listPages(`${base}/discussions/forums/${encodeURIComponent(item.forumId)}/topics/${encodeURIComponent(item.entityId)}/posts/`), accountId) && 'post';
  return false;
}
async function verifyToolCompletion(items, base, accountId) {
  const blocked = new Set(), now = Date.now();
  let budget = 40;
  for (const item of items) {
    if (item.status === 'Submitted' || !item.entityId || !['Quiz', 'Discussion'].includes(item.type) || blocked.has(item.type) || budget <= 0) continue;
    if (item.type === 'Discussion' && (!item.forumId || accountId == null)) continue;
    const due = Date.parse(item.dueDate);
    if (Number.isFinite(due) && (due < now - 30 * 86400000 || due > now + 60 * 86400000)) continue;
    budget--;
    try {
      const evidence = await toolCompleted(item, base, accountId);
      if (evidence) Object.assign(item, { status: 'Submitted', statusSource: 'MyLS', completionKind: evidence === 'post' ? 'Posted' : 'Completed', completionEvidence: evidence, stale: false });
    } catch (error) {
      if (['auth', 'rate'].includes(error.code)) throw error;
      if (['permission', '404'].includes(error.code)) blocked.add(item.type);
    }
  }
}

async function performD2LSync() {
  diagnostics = [];
  requestTransport = 'worker';
  const old = await chrome.storage.local.get(['assignments', 'courses', 'accountId']);
  await chrome.storage.local.set({ syncState: { running: true, startedAt: new Date().toISOString() } });
  try {
    const version = await versions();
    const user = await request(`/d2l/api/lp/${version.lp}/users/whoami`);
    if (user.Identifier == null) throw new ApiError('MyLS did not identify the signed-in account.', 'data');
    const accountId = String(user.Identifier);
    if (old.accountId !== accountId) {
      old.assignments = []; old.courses = [];
      await chrome.storage.local.set({ accountId, assignments: [], courses: [], completedIds: {}, reminderReceipts: {}, notificationItems: {}, external: {}, courseMappings: {}, calendarConnection: { state: 'disconnected' }, calendarEvents: {}, calendarAutoUpdate: false, lastSync: null, complete: false });
    }
    const enrolled = await listPages(`/d2l/api/lp/${version.lp}/enrollments/myenrollments/?orgUnitTypeId=3`);
  let courses = enrolled.filter(row => row.OrgUnit?.Id != null && currentEnrollment(row))
      .map(row => {
        const unit = row.OrgUnit, id = String(unit.Id);
        const hash = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
        return { id, code: courseLabel(unit.Name, unit.Code), name: unit.Name, color: COLORS[hash % COLORS.length] };
      });
    courses.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }) || a.id.localeCompare(b.id));
    const shared = await readShared(courses, version.le);
    let assignments = []; const warnings = [...shared.warnings];
    let complete = !warnings.length;
    for (const course of courses) {
      const result = await courseData(course, version.le, (old.assignments || []).filter(item => item.courseId === course.id), shared.calendars.get(course.id), accountId);
      assignments.push(...result.items); warnings.push(...result.warnings); complete &&= result.complete;
    }
    assignments = reconcileItems([...assignments, ...shared.items]);
    assignments = applyCompletionEvidence(assignments, shared.completions);
    assignments = keepVerified(assignments, old.assignments || []);
    for (const previous of old.assignments || []) {
      if (previous.status === 'Submitted' && courses.some(course => course.id === previous.courseId) && !assignments.some(item => item.id === previous.id)) assignments.push({ ...previous, stale: true, verificationCached: true });
    }
    courses = courses.filter(course => /\b[A-Z]{2,4} \d{3}\b/.test(course.code) || assignments.some(item => item.courseId === course.id && Date.parse(item.dueDate) >= Date.now()));
    assignments = assignments.filter(item => courses.some(course => course.id === item.courseId));
    for (const previous of old.assignments || []) {
      if (courses.some(course => course.id === previous.courseId) && shared.failedContent.has(previous.courseId) && (previous.source === 'content' || previous.seenIn?.includes('content')) && !assignments.some(item => item.id === previous.id)) assignments.push({ ...previous, stale: true });
    }
    assignments.sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate));
    await chrome.storage.local.set({ schemaVersion: 3, deletedAt: null, accountId, courses, assignments: trackChanges(assignments, old.assignments || []), complete,
      lastSync: new Date().toISOString(), apiVersions: version,
      diagnostics: { recordedAt: new Date().toISOString(), requests: diagnostics },
      syncState: { running: false, error: null, warnings: [...new Set(warnings)] } });
    await updateBadge();
    return { ok: true };
  } catch (error) {
    await chrome.storage.local.set({ diagnostics: { recordedAt: new Date().toISOString(), requests: diagnostics }, syncState: { running: false, error: error.message, code: error.code || 'network', warnings: [] } });
    await updateBadge();
    return { ok: false, error: error.message };
  }
}

export function sync() {
  if (integrationPending && !inFlight) return integrationQueue.catch(() => {}).then(sync);
  if (!inFlight) inFlight = performSync().finally(() => { inFlight = null; });
  return inFlight;
}

async function updateBadge() {
  const data = await chrome.storage.local.get(['assignments', 'courses', 'completedIds', 'preferences', 'syncState', 'complete', 'external', 'accountId', 'courseMappings']);
  const count = effectiveAssignments(data).filter(item => ['Pending', 'Overdue'].includes(item.status) && Date.parse(item.dueDate) <= Date.now() + 48 * HOUR).length;
  const error = data.syncState?.error || data.complete === false;
  await chrome.action.setBadgeText({ text: data.preferences?.badge === false ? '' : error ? '!' : count ? String(Math.min(count, 999)) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: error ? '#aa6e24' : '#7556c7' });
  await chrome.action.setTitle({ title: error ? 'MYLD — sync needs attention' : `MYLD — ${count} pending items overdue or due within 48 hours` });
}

async function schedule() {
  await chrome.alarms.clear('live-sync');
  await chrome.alarms.clear('tick');
  await chrome.alarms.clear('reminder');
  await chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true });
  const { preferences, deletedAt } = await chrome.storage.local.get(['preferences', 'deletedAt']);
  if (deletedAt) { await chrome.alarms.clear('myld-sync'); await chrome.alarms.clear('myld-badge'); return; }
  const minutes = [15, 30, 60, 120].includes(preferences?.syncMinutes) ? preferences.syncMinutes : 30;
  const existing = await chrome.alarms.get('myld-sync');
  if (!existing || existing.periodInMinutes !== minutes) await chrome.alarms.create('myld-sync', { periodInMinutes: minutes });
  if (!await chrome.alarms.get('myld-badge')) await chrome.alarms.create('myld-badge', { periodInMinutes: 1 });
}

export async function markDone(id, accountId, done) {
  const data = await chrome.storage.local.get(['assignments', 'courses', 'completedIds', 'accountId', 'external', 'courseMappings']);
  const item = combinedData(data).assignments.find(item => item.id === id);
  if (data.accountId !== accountId || !item) return { ok: false };
  const completedIds = { ...data.completedIds };
  for (const member of item.memberIds || [id]) {
    if (done) completedIds[member] = new Date().toISOString(); else delete completedIds[member];
  }
  await chrome.storage.local.set({ completedIds });
  await updateBadge();
  return { ok: true };
}

export function reminderCandidates(data, now = Date.now()) {
  if (!data.preferences?.reminders || !data.lastSync || data.syncState?.code === 'auth') return [];
  const preferences = { ...DEFAULT_PREFS, ...data.preferences };
  return effectiveAssignments(data, now).flatMap(item => {
    if (!Number.isFinite(Date.parse(item.dueDate))) return [];
    const lead = { ...DEFAULT_LEADS, ...preferences.reminderLeads }[categoryOf(item)];
    const key = `${item.id}|${item.dueDate}|${lead}`;
    const fireAt = reminderTime(item.dueDate, lead);
    if (preferences.mutedCourses.includes(item.courseId) || lead === 'off' || item.status !== 'Pending' || Date.parse(item.dueDate) <= now || fireAt > now || !Number.isFinite(fireAt) || data.reminderReceipts?.[key] || data.reminderReceipts?.[`${item.id}|${item.dueDate}`]) return [];
    return [{ ...item, reminderKey: key }];
  });
}

export async function sendReminders() {
  if (inFlight || notificationsRunning || integrationPending) return;
  notificationsRunning = true;
  try { await deliverReminders(); } finally { notificationsRunning = false; }
}
async function deliverReminders() {
  const data = await chrome.storage.local.get(null);
  if (!data.preferences?.reminders || !await chrome.permissions.contains({ permissions: ['notifications'] })) return;
  const due = reminderCandidates(data);
  const moves = effectiveAssignments(data).filter(item => data.preferences.movedReminders !== false && item.changedAt && Number.isFinite(Date.parse(item.dueDate)) && !item.stale && item.status === 'Pending' && !data.preferences.mutedCourses?.includes(item.courseId) && !data.reminderReceipts?.[`moved|${item.id}|${item.changedAt}`]);
  for (const item of [...due, ...moves]) {
    const isMove = !item.reminderKey;
    const key = item.reminderKey || `moved|${item.id}|${item.changedAt}`;
    const latest = await chrome.storage.local.get(['accountId', 'completedIds']);
    if (latest.accountId !== data.accountId || latest.completedIds?.[item.id]) continue;
    if (!await shouldNotify(item, data)) continue;
    const notificationId = `myld-${crypto.randomUUID()}`;
    const date = new Date(item.dueDate).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    await chrome.notifications.create(notificationId, { type: 'basic', iconUrl: 'icons/icon128.png', title: `${item.courseCode} · ${isMove ? 'Deadline changed' : 'Deadline reminder'}`, message: `${item.title}\n${item.dateKind || 'Due'} ${date}${item.stale || data.syncState?.error ? '\nBased on your saved MyLS dates.' : providerOf(item) !== 'd2l' ? '\nBased on your saved provider dates.' : ''}` });
    const saved = await chrome.storage.local.get(['reminderReceipts', 'notificationItems']);
    await chrome.storage.local.set({ reminderReceipts: { ...saved.reminderReceipts, [key]: new Date().toISOString() }, notificationItems: { ...saved.notificationItems, [notificationId]: { id: item.id, accountId: data.accountId } } });
  }
}

async function shouldNotify(item, data) {
  if (providerOf(item) !== 'd2l') {
    const latest = await chrome.storage.local.get(null);
    const current = effectiveAssignments(latest).find(row => row.id === item.id);
    return latest.accountId === data.accountId && current && !['Submitted', 'Done'].includes(current.status);
  }
  const version = data.apiVersions;
  if (!version) return true;
  try {
    const user = await request(`/d2l/api/lp/${version.lp}/users/whoami`);
    if (String(user.Identifier) !== data.accountId) return false;
    let completed = false;
    const base = `/d2l/api/le/${version.le}/${encodeURIComponent(item.sourceCourseId || item.courseId)}`;
    if (item.type === 'Dropbox' && item.entityId) {
      completed = hasSubmission(await request(`${base}/dropbox/folders/${encodeURIComponent(item.entityId)}/submissions/mysubmissions/`)) && 'submission';
    } else {
      if (['Quiz', 'Discussion'].includes(item.type) && item.entityId) {
        try { completed = await toolCompleted(item, base, data.accountId); } catch (error) { if (['auth', 'rate'].includes(error.code)) throw error; }
      }
      if (!completed && item.contentId) {
        const query = new URLSearchParams({ orgUnitIdsCSV: item.sourceCourseId || item.courseId });
        const rows = await listPages(`/d2l/api/le/${version.le}/content/myItems/completions/?${query}`);
        completed = rows.some(row => String(row.ItemId) === item.contentId && Boolean(row.DateCompleted)) && 'content';
      }
    }
    if (completed) {
      const fresh = await chrome.storage.local.get(['accountId', 'assignments']);
      if (fresh.accountId === data.accountId && !inFlight) await chrome.storage.local.set({ assignments: fresh.assignments.map(row => row.id === item.id ? { ...row, status: 'Submitted', statusSource: 'MyLS', completionKind: item.type === 'Dropbox' ? 'Submitted' : completed === 'post' ? 'Posted' : 'Completed', completionEvidence: completed } : row) });
      return false;
    }
    return true;
  } catch (error) { return !['auth', 'rate'].includes(error.code); }
}

async function readShared(courses, version) {
  const items = [], completions = [], warnings = [], calendars = new Map(), failedContent = new Set();
  const window = termWindow();
  const range = { startDateTime: new Date(+window.start - 14 * 86400000).toISOString(), endDateTime: new Date(+window.end + 21 * 86400000).toISOString() };
  for (let index = 0; index < courses.length; index += 100) {
    const batch = courses.slice(index, index + 100), ids = batch.map(course => course.id).join(',');
    for (const route of ['content/myItems/', 'content/myItems/due/', 'content/myItems/completions/', 'content/myItems/completions/due/', 'calendar/events/myEvents/']) {
      const completion = route.includes('/completions/');
      const query = new URLSearchParams({ orgUnitIdsCSV: ids, ...(completion ? { completedFromDateTime: range.startDateTime, completedToDateTime: new Date(Date.now() + 86400000).toISOString() } : range) });
      try {
        const rows = await listPages(`/d2l/api/le/${version}/${route}?${query}`);
        if (route.startsWith('calendar/')) {
          for (const course of batch) calendars.set(course.id, rows.filter(row => String((row.EventDataInfo || row).OrgUnitId) === course.id));
        } else {
          for (const row of rows) {
            const course = batch.find(course => course.id === String(row.OrgUnitId));
            if (!course) continue;
            if (completion && row.DateCompleted) completions.push(row);
            const item = scheduledItem(row, course, safeLink);
            if (item) items.push(item);
          }
        }
      } catch (error) {
        if (['auth', 'rate'].includes(error.code)) throw error;
        if (route.startsWith('content/')) {
          batch.forEach(course => failedContent.add(course.id));
          warnings.push('Some content or completion information is unavailable.');
        }
      }
    }
  }
  return { items: reconcileItems(items), completions, warnings: [...new Set(warnings)], calendars, failedContent };
}

if (globalThis.chrome?.runtime?.id && typeof document === 'undefined') {
  chrome.notifications?.onClicked.addListener(async notificationId => {
    const data = await chrome.storage.local.get(['notificationItems', 'assignments', 'accountId', 'external', 'courseMappings']);
    const target = data.notificationItems?.[notificationId];
    const item = target?.accountId === data.accountId && combinedData(data).assignments.find(item => item.id === target.id);
    if (item) await chrome.tabs.create({ url: assignmentLink(item) });
    await chrome.notifications.clear(notificationId);
  });
  chrome.runtime.onInstalled.addListener(() => { schedule().then(sync).catch(console.error); });
  chrome.runtime.onStartup.addListener(() => { schedule().then(async () => { if (!(await chrome.storage.local.get('deletedAt')).deletedAt) await sync(); }).catch(console.error); });
  chrome.alarms.onAlarm.addListener(alarm => {
    if (!['myld-sync', 'myld-badge'].includes(alarm.name)) return;
    (alarm.name === 'myld-sync' ? sync() : updateBadge()).then(sendReminders).catch(console.error);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.preferences) schedule().then(updateBadge).catch(console.error);
    if (area === 'local' && (changes.external || changes.courseMappings)) updateBadge().catch(console.error);
  });
  chrome.identity?.onSignInChanged?.addListener(() => disconnectCalendar().catch(console.error));
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup/popup.html')) return;
    if (message?.type === 'SYNC') { sync().then(async result => { await schedule(); await sendReminders(); return result; }).then(respond).catch(error => respond({ ok: false, error: error.message })); return true; }
    if (message?.type === 'CLEAR_DATA') {
      if (inFlight || notificationsRunning || integrationPending) { respond({ ok: false }); return; }
      completionWrite = completionWrite.catch(() => {}).then(async () => {
        await chrome.identity?.clearAllCachedAuthTokens();
        await chrome.storage.local.clear();
        await chrome.storage.local.set({ deletedAt: new Date().toISOString() });
        if (await chrome.permissions.contains({ permissions: ['notifications'] })) {
          const notifications = await chrome.notifications.getAll();
          await Promise.all(Object.keys(notifications).map(id => chrome.notifications.clear(id)));
        }
        await schedule(); await updateBadge(); return { ok: true };
      });
      completionWrite.then(respond, () => respond({ ok: false })); return true;
    }
    if (['PROVIDER_SYNC', 'PROVIDER_DISCONNECT', 'CALENDAR_CONNECT', 'CALENDAR_DISCONNECT', 'CALENDAR_ADD', 'CALENDAR_ALL'].includes(message?.type)) {
      integrationAction(message).then(respond, error => respond({ ok: false, error: error.message })); return true;
    }
    if (message?.type === 'STATUS') { respond({ running: Boolean(inFlight) }); }
    if (message?.type === 'MARK_DONE' && typeof message.id === 'string' && typeof message.done === 'boolean') {
      completionWrite = completionWrite.catch(() => {}).then(() => markDone(message.id, message.accountId, message.done));
      completionWrite.then(respond, () => respond({ ok: false })); return true;
    }
  });
  schedule().catch(console.error);
}

export function applyCompletionEvidence(items, rows) {
  return items.map(item => {
    const evidence = rows.find(row => {
      if (String(row.OrgUnitId) !== item.courseId || !row.DateCompleted || !Number.isFinite(Date.parse(row.DateCompleted))) return false;
      if (String(row.ItemId) === item.contentId) return true;
      try {
        const url = new URL(row.ItemUrl, ORIGIN);
        if (url.origin !== ORIGIN) return false;
        const id = item.type === 'Dropbox' ? url.searchParams.get('db') : item.type === 'Quiz' ? url.searchParams.get('qi') : item.type === 'Discussion' ? url.searchParams.get('tid') || url.pathname.match(/\/topics\/(\d+)/)?.[1] : null;
        return id && id === item.entityId;
      } catch { return false; }
    });
    return evidence ? { ...item, status: 'Submitted', statusSource: 'MyLS', completedAt: evidence.DateCompleted, completionKind: 'Completed', completionEvidence: item.completionEvidence || 'content' } : item;
  });
}
async function performSync() {
  const result = await performD2LSync();
  const data = await chrome.storage.local.get(null);
  for (const provider of EXTERNAL_PROVIDERS) {
    if (data.external?.[provider]?.ownerId === data.accountId) {
      try { await syncProvider(provider, courseLabel); } catch (error) { console.warn('Provider sync unavailable:', provider); }
    }
  }
  const fresh = await chrome.storage.local.get(null);
  if (fresh.calendarAutoUpdate && fresh.calendarConnection?.state === 'connected') {
    const changed = effectiveAssignments(fresh).filter(item => {
      const saved = fresh.calendarEvents?.[`${fresh.accountId}|${item.id}`];
      return saved && (saved.dueDate !== item.dueDate || saved.title !== item.title) && !item.stale;
    });
    if (changed.length) { try { await addCalendarItems(changed, fresh.accountId, true); } catch { /* Connection details are recorded separately. */ } }
  }
  await updateBadge();
  return result;
}
let integrationQueue = Promise.resolve();
function integrationAction(message) {
  integrationPending++;
  const run = async () => {
    if (inFlight) await inFlight;
    if (message.type === 'PROVIDER_SYNC') return syncProvider(message.provider, courseLabel);
    if (message.type === 'PROVIDER_DISCONNECT') {
      const { external = {} } = await chrome.storage.local.get('external'); delete external[message.provider]; await chrome.storage.local.set({ external }); return { ok: true };
    }
    if (message.type === 'CALENDAR_CONNECT') return connectCalendar();
    if (message.type === 'CALENDAR_DISCONNECT') return disconnectCalendar();
    const data = await chrome.storage.local.get(null);
    const items = effectiveAssignments(data).filter(item => message.type === 'CALENDAR_ADD' ? item.id === message.id : item.status === 'Pending' && Date.parse(item.dueDate) >= Date.now());
    if (!items.length) return { ok: false, error: 'No matching deadlines to add.' };
    return addCalendarItems(items, data.accountId);
  };
  const result = integrationQueue.catch(() => {}).then(run).finally(() => { integrationPending--; }); integrationQueue = result; return result;
}
