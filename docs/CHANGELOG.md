# Unreleased integration preview

- Redesigned the side panel: lavender/white cards, gold progress, original local campus artwork, readable wrapping titles, course pills and source filters.
- Added weekly and tracked-coursework progress, per-course/source scope, date views, verified completion notes and distinct manual check-offs.
- Reconciled historical MyLS completion rows even when they have no due date; retained previously verified completion across incomplete refreshes and cache reloads.
- Added opt-in readers for loaded Pearson MyLab assignment tables and Achieve course lists, with isolated caches, explicit course associations and partial-coverage messages.
- Added Google Calendar OAuth wiring, individual/bulk add controls, deterministic event IDs, changed-date updates and disconnect behavior. Publisher client configuration and live OAuth testing remain required.
- Preserved the original sync routes, session bridge, reminders, badge, settings and side-panel architecture.
- Expanded the automated tests; all 43 pass. Live reader checks found 11 dated Pearson rows (3 completed) and 14 dated Achieve rows (8 completed).

The manifest remains at 3.1.0 with an integration-preview label. The 4.0 release bump is deferred until Google OAuth and the installed extension's end-to-end checks are complete. This is a reviewable beta, not a claim of universal platform support.

## Course and completion reconciliation fix

- Automatically group same-code MyLS/Pearson/Achieve classes.
- Reconcile unique cross-provider activity copies and propagate verified completion within MYLD. Preserve original MyLS course IDs for API reads.
- Keep manual check-offs across merged IDs and source filters across all contributing platforms.
- Show the actual scoped MyLS warning instead of a generic outage banner. The reported BBA warning is a 403 on one submission read, not a failed login.
- 37 automated tests pass, including six new reconciliation regressions. Actual updated installed-extension behavior still needs confirmation after reload.

## Saved publisher deadlines fix

Closed/unreadable tabs and temporary permission failures now retain saved Pearson/Achieve deadlines with a refresh-needed message. Previously hidden missing-tab caches recover on sync. Confirmed account conflicts remain isolated. Three new regression tests cover these cases; 40 tests pass. Installed-extension confirmation remains pending.

## Class quiz lists

Added a Quizzes view and retained undated active MyLS quizzes. Preserved dated content reconciliation and completion evidence, and excluded undated quizzes from deadline notifications and Calendar actions. All 43 tests pass, including three new quiz regressions.
