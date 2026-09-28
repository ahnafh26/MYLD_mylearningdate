export const PROVIDERS = {
  d2l: { label: 'MyLS', home: 'https://mylearningspace.wlu.ca/d2l/home', origins: ['https://mylearningspace.wlu.ca'] },
  pearson: { label: 'Pearson', home: 'https://console.pearson.com/courses', origins: ['https://console.pearson.com', 'https://mylabmastering.pearson.com', 'https://mylab.pearson.com'] },
  achieve: { label: 'Achieve', home: 'https://achieve.macmillanlearning.com/courses', origins: ['https://achieve.macmillanlearning.com'] }
};
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
  return { assignments: reconcileProviders(normalized), courses: [...groups.values()] };
}

export function normalizedCourseCode(course) {
  for (const value of [course.name, course.code]) {
    const match = String(value || '').match(/(?:^|[\s(_/–—-])([A-Z]{2,4})[\s_-]*(\d{3})(?:[A-Z]{0,2})(?=$|[\s)_./:–—-])/i);
    if (match) return `${match[1].toUpperCase() === 'SIBU' ? 'BU' : match[1].toUpperCase()} ${match[2]}`;
  }
  return null;
}
function activityTitle(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/^(?:achieve|pearson|mylab)\s*[:–—-]\s*/, '')
    .replace(/\bchapter\s+(\d+)/g, 'ch $1').replace(/\bch\.\s*/g, 'ch ')
    .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
// Only unique, cross-source copies in the same class and due-time window match.
// No fuzzy title matching: chapter, quiz and part numbers must remain identical.
export function reconcileProviders(items) {
  const matches = items.map(() => []);
  for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
    const left = items[a], right = items[b];
    if (left.isRecurring || right.isRecurring) continue;
    if (left.courseId !== right.courseId || providerOf(left) === providerOf(right)) continue;
    const title = activityTitle(left.title);
    if (title.length < 8 || title !== activityTitle(right.title)) continue;
    if (!(Math.abs(Date.parse(left.dueDate) - Date.parse(right.dueDate)) <= 86400000)) continue;
    matches[a].push(b); matches[b].push(a);
  }
  const used = new Set(), result = [];
  for (let index = 0; index < items.length; index++) {
    if (used.has(index)) continue;
    const candidates = [index, ...matches[index]];
    const uniqueSources = new Set(candidates.map(i => providerOf(items[i]))).size === candidates.length;
    const unambiguous = uniqueSources && candidates.every(i => matches[i].every(j => candidates.includes(j)) && candidates.every(j => i === j || matches[i].includes(j)));
    const indices = unambiguous ? candidates : [index];
    indices.forEach(i => used.add(i));
    const rows = indices.map(i => items[i]);
    const primary = rows.find(i => providerOf(i) === 'd2l') || rows[0];
    const verified = rows.find(i => i.status === 'Submitted' && providerOf(i) !== 'd2l') || rows.find(i => i.status === 'Submitted');
    result.push({ ...primary, type: primary.type === 'Event' ? rows.find(i => ['Dropbox','Quiz','Discussion'].includes(i.type))?.type || primary.type : primary.type, memberIds: rows.map(i => i.id), providers: [...new Set(rows.map(providerOf))],
      ...(verified ? { status: 'Submitted', completionKind: verified.completionKind || 'Completed', completionProvider: providerOf(verified), statusSource: PROVIDERS[providerOf(verified)].label, completedAt: verified.completedAt, verificationCached: verified.verificationCached || verified.stale } : {}) });
  }
  return result;
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
