export const REMINDER_TYPES = { assignment: 'Assignments', lab: 'Labs', quiz: 'Quizzes', discussion: 'Discussions', content: 'Other items' };
export const DEFAULT_LEADS = { assignment: '2d', lab: '2d', quiz: '1d', discussion: 'morning', content: 'morning' };
export const LEADS = ['7d', '6d', '5d', '4d', '3d', '2d', '1d', 'morning'];
export function categoryOf(item) {
  if (item.category && item.category in REMINDER_TYPES) return item.category;
  if (/\blab(?:oratory)?\b/i.test(`${item.title} ${item.categoryName || ''}`)) return 'lab';
  return { Dropbox: 'assignment', Quiz: 'quiz', Discussion: 'discussion' }[item.type] || 'content';
}
export function bucketOf(item, now = new Date()) {
  if (['Submitted', 'Done'].includes(item.status)) return 'Completed';
  if (!Number.isFinite(Date.parse(item.dueDate))) return 'No date listed';
  const due = new Date(item.dueDate), today = new Date(now);
  if (due < today) return 'Overdue';
  const tomorrow = new Date(today); tomorrow.setHours(24, 0, 0, 0);
  if (due < tomorrow) return 'Today';
  const nextMonday = new Date(today); nextMonday.setHours(0, 0, 0, 0);
  nextMonday.setDate(nextMonday.getDate() + (8 - (today.getDay() || 7)));
  if (due < nextMonday) return 'This week';
  nextMonday.setDate(nextMonday.getDate() + 7);
  return due < nextMonday ? 'Next week' : 'Later';
}
export function reminderTime(dueDate, lead) {
  if (!Number.isFinite(Date.parse(dueDate))) return NaN;
  const due = new Date(dueDate);
  if (!Number.isFinite(+due)) return NaN;
  if (lead === 'morning') { const morning = new Date(due); morning.setHours(8, 0, 0, 0); return Math.min(+morning, +due - 3600000); }
  return /^[1-7]d$/.test(lead) ? +due - Number(lead[0]) * 86400000 : NaN;
}
export function termWindow(now = new Date()) {
  const month = Math.floor(now.getMonth() / 4) * 4;
  return { start: new Date(now.getFullYear(), month, 1), end: new Date(now.getFullYear(), month + 4, 1) };
}
export function currentEnrollment(row, now = new Date()) {
  if (row.Access?.CanAccess === false || row.Access?.IsActive === false) return false;
  const access = row.Access || {};
  if (access.StartDate && Date.parse(access.StartDate) > +now || access.EndDate && Date.parse(access.EndDate) < +now) return false;
  const text = `${row.OrgUnit?.Name || ''} ${row.OrgUnit?.Code || ''}`;
  const named = text.match(/\b(Winter|Spring|Summer|Fall)\s+(20\d{2})\b/i);
  const numeric = text.match(/(?:^|\D)(20\d{2})(01|05|09)(?=\D|$)/);
  const year = named ? +named[2] : numeric ? +numeric[1] : null;
  const month = named ? ({ winter: 0, spring: 4, summer: 4, fall: 8 })[named[1].toLowerCase()] : numeric ? +numeric[2] - 1 : null;
  return year == null || year === now.getFullYear() && month === termWindow(now).start.getMonth();
}
export function scheduledItem(row, course, safeLink) {
  if (row.IsExempt || row.ItemId == null) return null;
  const date = row.DueDate || row.EndDate;
  if (!date || !Number.isFinite(Date.parse(date))) return null;
  const type = ({ 3: 'Dropbox', 4: 'Quiz', 5: 'Discussion', 6: 'Discussion' })[row.ActivityType] || 'Event';
  const link = safeLink(row.ItemUrl, `https://mylearningspace.wlu.ca/d2l/le/content/${encodeURIComponent(course.id)}/viewContent/${encodeURIComponent(row.ItemId)}/View`);
  const url = new URL(link);
  const entityId = type === 'Dropbox' ? url.searchParams.get('db') : type === 'Quiz' ? url.searchParams.get('qi') : type === 'Discussion' ? url.searchParams.get('tid') || url.pathname.match(/\/topics\/(\d+)/)?.[1] : null;
  return { id: entityId ? `${type.toLowerCase()}_${course.id}_${entityId}` : `content_${course.id}_${row.ItemId}`,
    contentId: String(row.ItemId), entityId, courseId: course.id, courseCode: course.code, title: row.ItemName || 'Course item', type,
    dueDate: new Date(date).toISOString(), dateKind: row.DueDate ? 'Due' : 'Closes', opensAt: row.StartDate || null,
    status: row.DateCompleted ? 'Submitted' : 'Pending', completionKind: 'Completed', statusSource: row.DateCompleted ? 'MyLS' : 'unverified',
    link, source: 'content', seenIn: ['content'] };
}
export function reconcileItems(items) {
  const result = [];
  const titleKey = title => String(title || '').replace(/\s*[-–:]?\s*(?:due|ends|closes)\s*$/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
  for (const item of items) {
    const candidates = result.filter(other => other.courseId === item.courseId && (
      other.id === item.id || (other.type === item.type && other.entityId && other.entityId === item.entityId) ||
      (other.source !== item.source && titleKey(other.title) === titleKey(item.title) &&
        !(other.entityId && item.entityId && other.entityId !== item.entityId) &&
        (other.type === item.type || other.type === 'Event' || item.type === 'Event') && Math.abs(Date.parse(other.dueDate) - Date.parse(item.dueDate)) < 60000)));
    if (candidates.length !== 1) { result.push({ ...item }); continue; }
    const existing = candidates[0];
    // Content dates can include personal special access. Prefer that dated feed, then tool due dates.
    const score = x => (x.stale ? -20 : 0) + (x.source === 'content' ? 6 : x.source === 'calendar' ? 0 : 3) + (x.dateKind === 'Due' ? 2 : 0);
    const chosen = score(item) > score(existing) ? item : existing;
    const canonical = [existing, item].find(x => x.entityId && x.source !== 'calendar') || chosen;
    const submitted = [existing, item].find(x => x.status === 'Submitted');
    Object.assign(existing, { ...chosen, id: canonical.id, entityId: canonical.entityId || chosen.entityId,
      type: canonical.type, contentId: item.contentId || existing.contentId,
      status: submitted ? 'Submitted' : chosen.status, statusSource: submitted?.statusSource || chosen.statusSource,
      completionKind: submitted?.completionKind, opensAt: item.opensAt || existing.opensAt,
      seenIn: [...new Set([...(existing.seenIn || [existing.source]), ...(item.seenIn || [item.source])].filter(Boolean))] });
  }
  return result;
}
