# Google Calendar publisher setup

One publisher OAuth client serves all MYLD installers. Each user grants permission to their own Google account. Students do not create Cloud projects or paste keys. This build has no client ID, so Calendar connection is disabled until the publisher completes setup. No secret is needed or included in the extension.

1. Establish the extension ID you will distribute. For a stable unpacked/store ID, follow Chrome's guide to upload a draft package, obtain its public key, and put that public key in the manifest `key` field. Uploading a draft is separate from publishing. Do not distribute a private signing key.
2. Create a Google Cloud project, enable the Google Calendar API, and configure Google Auth Platform branding, audience and data access. A public student extension needs an external audience. During testing, explicitly add your testers.
3. Create a **Chrome Extension** OAuth client and enter the extension's ID as its Item ID. Development and distribution IDs must match the appropriate client.
4. Run `node extension/configure-calendar.mjs` followed by your actual public client ID as its argument, from the repo root. This writes the `oauth2` manifest field with `calendar.events.owned`. The client ID is public configuration, not an account password.
5. Reload MYLD, sync MyLS, and choose Settings → Connect Google Calendar. Each student completes Google's own sign-in/consent flow. The scope permits events on calendars the user owns; MYLD uses only the primary calendar and only modifies events carrying its own marker.
6. Test an individual deadline, re-add it, change its due date, and confirm there is still one event. Test denied consent, a revoked grant, and a second Google account. Automatic updates are initially off and affect only previously added deadlines. They do not add every newly discovered item.
7. Before public release, finish Google's applicable OAuth verification, production audience setup, privacy-policy publication and Chrome Web Store review. Testing mode is not a general-public authorization setup. Institutional Google accounts may restrict third-party access.

MYLD keeps tokens in Chrome's identity cache, not `chrome.storage.local`. It stores event IDs and the last exported title/date locally. Disconnecting stops MYLD updates and clears cached tokens; existing calendar events remain. Disconnect does not revoke the server-side Google grant. Users can remove that grant in their Google Account's third-party connections page.

An event is a one-minute deadline marker in the primary calendar. Its description includes the course, assignment, source, due time and source link. Missing individual Pearson/Achieve links open their assignment list. MYLD does not mark coursework submitted by adding a calendar event.

References: [Chrome extension OAuth and stable ID setup](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth), [Chrome identity API](https://developer.chrome.com/docs/extensions/reference/api/identity), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [event insertion and client-supplied IDs](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).
