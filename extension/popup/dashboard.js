import { providerOf } from '../integrations/model.js';
export function completed(item) { return item.status === 'Submitted' || item.status === 'Done'; }
export function weekRange(now = new Date()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start); end.setDate(end.getDate() + 7); return { start, end };
}
export function coursework(item) {
  return !item.isRecurring && (['Dropbox','Quiz','Discussion'].includes(item.type) || ['assignment','lab','quiz','discussion'].includes(item.category));
}
export function weeklyProgress(items, now = new Date()) {
  const { start, end } = weekRange(now);
  const work = items.filter(item => coursework(item) && Date.parse(item.dueDate) >= +start && Date.parse(item.dueDate) < +end);
  const done = work.filter(completed), verified = done.filter(item => item.status === 'Submitted');
  return { total: work.length, done: done.length, verified: verified.length, manual: done.length - verified.length, percent: work.length ? Math.round(done.length / work.length * 100) : 0, stale: work.some(item => item.stale || item.verificationCached) };
}
export function knownProgress(items) {
  const work = items.filter(coursework);
  return { total: work.length, done: work.filter(completed).length };
}
export function inView(item, view, now = new Date()) {
  if (view === 'quizzes') return item.type === 'Quiz';
  const due = Date.parse(item.dueDate), { start, end } = weekRange(now);
  if (view === 'completed') return completed(item);
  if (view === 'overdue') return !completed(item) && due < +now;
  if (view === 'upcoming') return !completed(item) && due >= +now;
  if (view === 'week') return due >= +start && due < +end;
  if (view === 'today') { const day = new Date(now); day.setHours(0,0,0,0); const next = new Date(day); next.setDate(next.getDate()+1); return due >= +day && due < +next; }
  return true;
}
// A merged item belongs to the platform where the work is done, so it shows once, under
// that platform's source filter (its card notes that it's also on MyLS).
export function scopedItems(items, course, source) {
  return items.filter(item => (course === 'all' || item.courseId === course) && (source === 'all' || providerOf(item) === source));
}
