import { assignmentLink, providerOf, PROVIDERS, digest } from './model.js';
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
let queue = Promise.resolve();

export function calendarConfigured() { return Boolean(chrome.runtime.getManifest().oauth2?.client_id); }
async function token(interactive = false) {
  if (!calendarConfigured()) throw new Error('Google Calendar needs publisher OAuth setup. See GOOGLE-CALENDAR-SETUP.md.');
  const result = await chrome.identity.getAuthToken({ interactive, scopes: [CALENDAR_SCOPE], enableGranularPermissions: true });
  if (!result?.token || result.grantedScopes && !result.grantedScopes.includes(CALENDAR_SCOPE)) throw new Error('Google Calendar permission was not granted.');
  return result.token;
}
async function api(accessToken, path = '', options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (response.status === 401) { await chrome.identity.removeCachedAuthToken({ token: accessToken }); throw new Error('Google Calendar needs reconnection.'); }
  if (!response.ok) { const error = new Error(`Google Calendar request failed (${response.status}).`); error.status = response.status; throw error; }
  return response.status === 204 ? {} : response.json();
}
export async function connectCalendar() {
  const { accountId } = await chrome.storage.local.get('accountId');
  if (!accountId) throw new Error('Sync MyLS before connecting Google Calendar.');
  const accessToken = await token(true);
  await api(accessToken, '?maxResults=1&fields=kind');
  if ((await chrome.storage.local.get('accountId')).accountId !== accountId) throw new Error('MyLS account changed. Connect again for the current account.');
  await chrome.storage.local.set({ calendarConnection: { state: 'connected', ownerId: accountId }, calendarAutoUpdate: false });
  return { ok: true };
}
export async function disconnectCalendar() {
  await chrome.storage.local.set({ calendarConnection: { state: 'disconnected' }, calendarAutoUpdate: false });
  await chrome.identity.clearAllCachedAuthTokens();
  return { ok: true };
}
export async function eventIdentity(item, ownerId) { return `m1d${await digest(`${ownerId}|${providerOf(item)}|${item.id}`)}`; }
export function eventBody(item, eventId) {
  const due = new Date(item.dueDate);
  if (!Number.isFinite(+due)) throw new Error('This item has no valid deadline.');
  return { id: eventId, summary: `${item.courseCode} — ${item.title}`, description: `Course: ${item.courseCode}\nAssignment: ${item.title}\nSource: ${PROVIDERS[providerOf(item)].label}\nDue: ${due.toISOString()}\nOpen assignment: ${assignmentLink(item)}`,
    start: { dateTime: due.toISOString() }, end: { dateTime: new Date(+due + 60000).toISOString() },
    extendedProperties: { private: { myld: eventId } } };
}
// Deterministic IDs remain idempotent even after a worker restart or a lost response.
export async function upsertEvent(item, ownerId, request) {
  const id = await eventIdentity(item, ownerId), body = eventBody(item, id);
  let existing;
  try { existing = await request(`/${id}`); } catch (error) { if (error.status !== 404) throw error; }
  if (!existing) {
    try { return await request('', { method: 'POST', body: JSON.stringify(body) }); }
    catch (error) { if (error.status !== 409) throw error; existing = await request(`/${id}`); }
  }
  if (existing.status === 'cancelled') throw new Error('This calendar event was deleted in Google Calendar. Restore it there before updating it.');
  if (existing.extendedProperties?.private?.myld !== id) throw new Error('Calendar event identity could not be verified.');
  const { id: ignored, ...patch } = body;
  return request(`/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
export function addCalendarItems(items, ownerId, automatic = false) {
  const run = async () => {
    const initial = await chrome.storage.local.get(['accountId', 'calendarConnection']);
    if (initial.accountId !== ownerId || initial.calendarConnection?.ownerId !== ownerId || initial.calendarConnection?.state !== 'connected') throw new Error('Connect Google Calendar for the current MyLS account first.');
    const accessToken = await token(false);
    let added = 0;
    for (const item of items) {
      const latest = await chrome.storage.local.get(['accountId', 'calendarConnection', 'calendarEvents', 'calendarAutoUpdate']);
      if (latest.accountId !== ownerId || latest.calendarConnection?.state !== 'connected' || automatic && !latest.calendarAutoUpdate) break;
      const key = `${ownerId}|${item.id}`;
      if (automatic && !latest.calendarEvents?.[key]) continue;
      const event = await upsertEvent(item, ownerId, (path, options) => api(accessToken, path, options));
      const fresh = await chrome.storage.local.get(['accountId', 'calendarEvents']);
      if (fresh.accountId !== ownerId) break;
      await chrome.storage.local.set({ calendarEvents: { ...fresh.calendarEvents, [key]: { eventId: event.id, dueDate: item.dueDate, title: item.title, updatedAt: new Date().toISOString() } } });
      added++;
    }
    return { ok: true, count: added };
  };
  const result = queue.catch(() => {}).then(run);
  queue = result.catch(async error => {
    const { accountId, calendarConnection } = await chrome.storage.local.get(['accountId', 'calendarConnection']);
    if (accountId === ownerId && calendarConnection?.state === 'connected') await chrome.storage.local.set({ calendarConnection: { ...calendarConnection, state: 'error', message: error.message } });
  });
  return result;
}
