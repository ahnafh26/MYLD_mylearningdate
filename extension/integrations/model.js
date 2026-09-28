export const PROVIDERS = {
  d2l: { label: 'MyLS', home: 'https://mylearningspace.wlu.ca/d2l/home', origins: ['https://mylearningspace.wlu.ca'] },
  pearson: { label: 'Pearson', home: 'https://console.pearson.com/courses', origins: ['https://console.pearson.com', 'https://mylabmastering.pearson.com', 'https://mylab.pearson.com'] },
  achieve: { label: 'Achieve', home: 'https://achieve.macmillanlearning.com/courses', origins: ['https://achieve.macmillanlearning.com'] },
  tophat: { label: 'Top Hat', home: 'https://app.tophat.com/e', origins: ['https://app.tophat.com'] }
};
export const EXTERNAL_PROVIDERS = Object.keys(PROVIDERS).filter(id => id !== 'd2l');
export const providerOf = item => Object.hasOwn(PROVIDERS, item.provider) ? item.provider : 'd2l';
export function assignmentLink(item) {
  const provider = PROVIDERS[providerOf(item)];
  try { const url = new URL(item.link); if (provider.origins.includes(url.origin) && !url.username && !url.password) return url.href; } catch {}
  return provider.home;
}
export function combinedData(data) {
  const assignments = (data.assignments || []).map(item => ({ ...item, provider: 'd2l' }));
  const rawCourses = [...(data.courses || [])];
  for (const [provider, saved] of Object.entries(data.external || {})) {
    if (!Object.hasOwn(PROVIDERS, provider) || !data.accountId || saved.ownerId !== data.accountId || saved.quarantined) continue;
    rawCourses.push(...(saved.courses || []));
    for (const item of saved.assignments || []) {
      assignments.push({ ...item, provider, stale: item.stale || saved.state !== 'connected' });
    }
  }
  // Older caches can contain rows before course metadata becomes available.
  for (const item of assignments) if (!rawCourses.some(c => c.id === item.courseId)) rawCourses.push({ id: item.courseId, code: item.courseCode });
  const groups = new Map(), aliases = new Map();
  for (const course of rawCourses) {
    const target = rawCourses.find(c => c.id === data.courseMappings?.[course.id]) || course;
    const code = normalizedCourseCode(target);
    const key = code || target.id;
    if (!groups.has(key)) groups.set(key, { ...target, code: code || target.code || target.name || 'Course', memberIds: [] });
    const group = groups.get(key);
    if (!group.memberIds.includes(course.id)) group.memberIds.push(course.id);
    aliases.set(course.id, group);
  }
  const normalized = assignments.map(item => {
    const course = aliases.get(item.courseId);
    return { ...item, sourceCourseId: item.sourceCourseId || item.courseId, courseId: course?.id || item.courseId, courseCode: course?.code || item.courseCode };
  });
  const mergeLog = [];
  return { assignments: reconcileProviders(normalized, mergeLog), courses: [...groups.values()], mergeLog };
}

export function normalizedCourseCode(course) {
  for (const value of [course.name, course.code]) {
    const match = String(value || '').match(/(?:^|[\s(_/–—-])([A-Z]{2,4})[\s_-]*(\d{3})(?:[A-Z]{0,2})(?=$|[\s)_./:–—-])/i);
    if (match) return `${match[1].toUpperCase() === 'SIBU' ? 'BU' : match[1].toUpperCase()} ${match[2]}`;
  }
  return null;
}
const PLATFORM_WORDS = /\b(?:macmillan(?:\s+learning)?|achieve|pearson|my\s*labs?(?:\s+(?:and|&)\s+mastering)?|mastering|top\s*hat|tophat)\b/g;
const NUMBER_LABELS = new Set(['ch', 'part', 'quiz', 'module', 'week', 'unit', 'lesson', 'section', 'test', 'lab', 'exam', 'midterm', 'case', 'set']);
const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'to', 'in', 'on', 'with', 'your', 'my', 'online', 'assignment', 'assignments', 'homework']);
// Words that name a different activity; containment matches never bridge them.
const DISTINCT_WORDS = new Set(['practice', 'pre', 'post', 'prelab', 'lab', 'lecture', 'reading', 'video', 'adaptive', 'quiz', 'test', 'exam', 'midterm', 'final', 'review', 'bonus', 'extra', 'makeup', 'participation', 'attendance', 'discussion', 'reflection', 'survey', 'graded', 'ungraded', 'optional', 'learningcurve', 'sapling']);
export function activityKey(value) {
  let text = String(value || '').normalize('NFKC').toLowerCase().replace(/&/g, ' and ');
  // Trailing due text such as "- due Sep 30" or "(closes 10/02)".
  text = text.replace(/[\s,;:|([\-–—]+(?:due|closes|ends)\b[\s:]*(?:on\s+)?(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?(?:[a-z]{3,9}\.?\s+\d{1,2}|\d{1,2}\/\d{1,2}|today|tomorrow).*$/, '');
  text = text.replace(/\(\s*online\s*\)/g, ' ').replace(PLATFORM_WORDS, ' ')
    .replace(/\bhw\b|\bhmwk\b/g, 'homework')
    .replace(/\b(?:ch|chap|chapter|chapters)\.?\s*(?=\d)/g, 'ch ')
    .replace(/\b(?:mod|module)\.?\s*(?=\d)/g, 'module ').replace(/\b(?:wk|week)\.?\s*(?=\d)/g, 'week ').replace(/\b(?:pt|part)\.?\s*(?=\d)/g, 'part ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\b0+(?=\d)/g, '').trim();
  const tokens = text ? text.split(' ') : [];
  const numbers = [], words = [];
  tokens.forEach((token, index) => {
    if (/^\d+$/.test(token)) numbers.push(`${NUMBER_LABELS.has(tokens[index - 1]) ? tokens[index - 1] : ''}:${token}`);
    else if (!STOP_WORDS.has(token)) words.push(token);
  });
  return { text, numbers: numbers.sort().join(' '), words: [...new Set(words)].sort() };
}
// Returns 'exact', 'contains' or a reason the titles don't match.
export function titleMatch(leftTitle, rightTitle) {
  const left = activityKey(leftTitle), right = activityKey(rightTitle);
  if (left.numbers !== right.numbers) return 'numbers differ';
  if (!left.numbers && Math.min(left.words.join(' ').length, right.words.join(' ').length) < 8) return 'title too short';
  if (left.words.join(' ') === right.words.join(' ')) return 'exact';
  const [small, large] = left.words.length <= right.words.length ? [left.words, right.words] : [right.words, left.words];
  if (!small.every(word => large.includes(word))) return 'titles differ';
  if (large.some(word => !small.includes(word) && DISTINCT_WORDS.has(word))) return 'different activity type';
  return 'contains';
}
// External rows are read in the device time zone; D2L dates are exact instants. Allow a
// little over a day so 23:59 local vs midnight/next-day UTC and DST shifts still match.
const DUE_WINDOW = 26 * 3600000;
function dueCompatible(d2l, external) {
  const a = Date.parse(d2l.dueDate), b = Date.parse(external.dueDate);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return Math.abs(a - b) <= DUE_WINDOW;
}
function describe(item) { return `${PROVIDERS[providerOf(item)].label} "${item.title}" (${item.courseCode || item.courseId})`; }
// Each external item merges with at most one MyLS item, and only when that pairing is
// unique in both directions. Numbers (chapter, quiz, part, week...) must always agree.
export function reconcileProviders(items, log = []) {
  const d2l = [], external = [];
  items.forEach((item, index) => (providerOf(item) === 'd2l' ? d2l : external).push(index));
  const candidates = new Map(), reverse = new Map();
  for (const e of external) {
    const ext = items[e];
    if (ext.isRecurring) continue;
    for (const d of d2l) {
      const row = items[d];
      if (row.isRecurring || row.courseId !== ext.courseId) continue;
      const match = titleMatch(row.title, ext.title);
      if (!['exact', 'contains'].includes(match)) continue;
      if (!dueCompatible(row, ext)) { log.push(`Not merged: ${describe(ext)} and ${describe(row)}: due dates more than 26 hours apart.`); continue; }
      if (!Number.isFinite(Date.parse(row.dueDate)) && !Number.isFinite(Date.parse(ext.dueDate)) && match !== 'exact') continue;
      candidates.set(e, [...(candidates.get(e) || []), d]);
      reverse.set(d, [...(reverse.get(d) || []), e]);
    }
  }
  const pairs = new Map(), merged = new Set();
  for (const [e, ds] of candidates) {
    if (ds.length > 1) { log.push(`Not merged: ${describe(items[e])} matches ${ds.length} MyLS items (${ds.map(d => `"${items[d].title}"`).join(', ')}).`); continue; }
    const others = reverse.get(ds[0]);
    if (others.length > 1) { log.push(`Not merged: ${describe(items[ds[0]])} matches ${others.length} platform items (${others.map(o => describe(items[o])).join(', ')}).`); continue; }
    pairs.set(ds[0], e); merged.add(ds[0]); merged.add(e);
    log.push(`Merged: ${describe(items[e])} with MyLS "${items[ds[0]].title}".`);
  }
  const result = [];
  items.forEach((item, index) => {
    if (!merged.has(index)) { result.push({ ...item, memberIds: item.memberIds || [item.id], providers: [providerOf(item)] }); return; }
    if (!pairs.has(index)) return;
    result.push(mergePair(item, items[pairs.get(index)]));
  });
  return result;
}
// The platform where the work is done owns the merged item. MyLS keeps the stable id so
// check-offs, reminders and Calendar events carry over, and fills in a missing due date.
function mergePair(d2l, ext) {
  const provider = providerOf(ext), extDated = Number.isFinite(Date.parse(ext.dueDate));
  // A MyLS content "completion" only means the link was opened, so it never completes
  // platform work. Real MyLS evidence (a submission, attempt or post) still counts.
  const d2lEvidence = d2l.status === 'Submitted' && d2l.completionEvidence !== 'content' && d2l.source !== 'content';
  const verified = ext.status === 'Submitted' ? ext : d2lEvidence ? d2l : null;
  const item = { ...d2l, ...ext, id: d2l.id, provider, source: ext.source || provider, link: ext.link, title: ext.title, courseId: ext.courseId, courseCode: ext.courseCode || d2l.courseCode,
    sourceCourseId: ext.sourceCourseId || ext.courseId, d2lCourseId: d2l.sourceCourseId || d2l.courseId, entityId: d2l.entityId, contentId: d2l.contentId,
    type: ['Dropbox', 'Quiz', 'Discussion'].includes(d2l.type) ? d2l.type : ext.type,
    dueDate: extDated ? ext.dueDate : d2l.dueDate, dateKind: extDated ? ext.dateKind : d2l.dateKind,
    changedFrom: extDated ? ext.changedFrom : d2l.changedFrom, changedAt: extDated ? ext.changedAt : d2l.changedAt,
    memberIds: [...new Set([d2l.id, ext.id, ...(d2l.memberIds || []), ...(ext.memberIds || [])])], providers: [provider, 'd2l'], alsoOn: ['d2l'],
    status: 'Pending', statusSource: 'unverified', completionKind: undefined, completionProvider: undefined, completedAt: undefined, verificationCached: undefined };
  if (verified) Object.assign(item, { status: 'Submitted', completionKind: verified.completionKind || 'Completed', completionProvider: providerOf(verified), statusSource: PROVIDERS[providerOf(verified)].label, completedAt: verified.completedAt, verificationCached: verified.verificationCached || verified.stale || undefined });
  return item;
}
export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function keepVerified(items, previous) {
  const byId = new Map(previous.filter(item => item.status === 'Submitted').map(item => [item.id, item]));
  return items.map(item => {
    const old = byId.get(item.id);
    return old && item.status !== 'Submitted' ? { ...item, status: 'Submitted', statusSource: old.statusSource, completedAt: old.completedAt, completionKind: old.completionKind, verificationCached: true } : item;
  });
}
