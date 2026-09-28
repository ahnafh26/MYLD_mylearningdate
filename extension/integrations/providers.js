import { PROVIDERS, digest, keepVerified } from './model.js';
import { readProviderPage } from './page-reader.js';

export async function syncProvider(provider, labelCourse) {
  if (!['pearson', 'achieve'].includes(provider)) throw new Error('Unknown provider.');
  const data = await chrome.storage.local.get(['accountId', 'external']);
  if (!data.accountId) throw new Error('Sync MyLS first to associate this connection with your account.');
  const ownerId = data.accountId;
  const previous = data.external?.[provider]?.ownerId === ownerId ? data.external[provider] : {};
  const origins = PROVIDERS[provider].origins.map(origin => `${origin}/*`);
  let next = { ...previous, ownerId };
  // A missing tab is not evidence that the student changed accounts.
  let accountMismatch = previous.quarantineReason === 'account-mismatch' || /Multiple provider accounts/.test(previous.message || '');
  try {
    if (!await chrome.permissions.contains({ permissions: ['scripting'], origins })) throw new Error('Connect this provider to allow reading its open course pages.');
    const tabs = await chrome.tabs.query({ url: origins });
    const snapshots = [];
    const observedAccounts = new Set();
    let reason = { state: 'needs-login', message: `Open a signed-in ${PROVIDERS[provider].label} course tab, then sync.` };
    for (const tab of tabs) {
      try {
        const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: provider === 'pearson' }, func: readProviderPage, args: [provider] });
        const context = results.find(row => row.result?.state === 'context')?.result;
        for (const { result } of results) {
          if (result?.account) observedAccounts.add(await digest(`${provider}|${result.account}`));
          if (result?.state === 'rows' && context?.courseId === result.courseId) Object.assign(result, context, { state: result.rows?.length ? 'connected' : 'unavailable' });
          if (result?.state === 'connected' && result.account && Array.isArray(result.rows)) snapshots.push(result);
          else if (result?.message) reason = result;
        }
      } catch { reason = { state: 'unavailable', message: 'This course tab could not be read. Reload it and try again.' }; }
    }
    if (!snapshots.length) {
      if (observedAccounts.size) accountMismatch = observedAccounts.size > 1 || Boolean(previous.accountKey && !observedAccounts.has(previous.accountKey));
      next = { ...next, state: reason.state, message: `${previous.assignments?.length && !accountMismatch ? 'Showing saved deadlines; refresh needed. ' : ''}${reason.message}`, quarantined: accountMismatch, quarantineReason: accountMismatch ? 'account-mismatch' : null };
    }
    else {
      const keys = [...new Set(await Promise.all(snapshots.map(row => digest(`${provider}|${row.account}`))))];
      if (keys.length !== 1 || observedAccounts.size > 1) {
        accountMismatch = true;
        throw new Error('Multiple provider accounts are open. Keep only the intended account open and retry.');
      }
      const accountKey = keys[0], changed = previous.accountKey && previous.accountKey !== accountKey;
      const oldItems = changed ? [] : previous.assignments || [];
      const courses = new Map((changed ? [] : previous.courses || []).map(course => [course.id, course]));
      const assignments = new Map(oldItems.map(item => [item.id, { ...item, stale: true }]));
      for (const snapshot of snapshots) {
        const courseId = `${provider}:${accountKey.slice(0, 16)}:${snapshot.courseId}`;
        const course = { id: courseId, externalId: snapshot.courseId, provider, name: snapshot.courseName, code: labelCourse(snapshot.courseName), color: provider === 'achieve' ? '#83b963' : '#e58baa' };
        courses.set(courseId, course);
        for (const row of snapshot.rows) {
          if (!row.externalId || !row.title || !Number.isFinite(Date.parse(row.dueDate))) continue;
          const id = `${courseId}:${row.externalId}`, before = assignments.get(id);
          const item = { id, externalId: row.externalId, provider, source: provider, courseId, courseCode: course.code, title: row.title.slice(0, 1000), type: /quiz|test|exam/i.test(row.title) ? 'Quiz' : 'Dropbox', dueDate: row.dueDate, dateKind: 'Due', link: row.link,
            status: row.completed ? 'Submitted' : 'Pending', completionKind: 'Completed', statusSource: row.completed ? PROVIDERS[provider].label : 'unverified', lastSynced: new Date().toISOString(), stale: false };
          if (before && before.dueDate !== item.dueDate) { item.changedFrom = before.dueDate; item.changedAt = new Date().toISOString(); }
          assignments.set(id, item);
        }
      }
      next = { ownerId, accountKey, state: 'connected', quarantined: false, partial: true, courses: [...courses.values()], assignments: keepVerified([...assignments.values()], oldItems), lastSync: new Date().toISOString(), message: snapshots[0].message };
    }
  } catch (error) { next = { ...next, state: 'error', message: `${previous.assignments?.length && !accountMismatch ? 'Showing saved deadlines; refresh needed. ' : ''}${error.message}`, quarantined: accountMismatch, quarantineReason: accountMismatch ? 'account-mismatch' : null }; }
  const current = await chrome.storage.local.get(['accountId', 'external']);
  if (current.accountId !== ownerId) return { ok: false };
  await chrome.storage.local.set({ external: { ...current.external, [provider]: next } });
  return { ok: next.state === 'connected', state: next.state, message: next.message };
}
