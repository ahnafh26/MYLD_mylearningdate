# Removed Top Hat and Google Calendar — September 29, 2026

- **Top Hat:** removed. It never synced on a real account, so its connection, source filter, page reader, site permissions and tests are gone. Anything it saved is cleared the next time MYLD is installed or reloaded.
- **Google Calendar export:** removed. It was never set up with a Google sign-in client. The Calendar section in Settings, the "Add to Calendar" buttons, the identity and googleapis.com permissions, the setup script and doc, and their tests are gone, along with any saved Calendar settings. MYLD still reads MyLearningSpace's own course calendar for due dates.

# Platform integrations update — September 28, 2026

- **Top Hat (new):** a Top Hat connection in Settings → Connections, a Top Hat source filter, and optional access to app.tophat.com. It reads dated homework, quizzes and readings on open course pages and detects Submitted, Completed, Graded and 100% complete. Pages it can't read import nothing. Not yet checked on a real account.
- **Achieve:** completion now also covers Submitted, Submitted late, Graded, a score and 100%. "In progress", "40% complete" and class-wide "students completed" never count. Undated rows are kept. Rows in collapsed and Past Assignments groups that are already on the page are read without expanding anything. When the course name has no year, the nearest sensible year is used, so January deadlines in a Fall course land in the next year.
- **Pearson:** MyLab rows also complete on Submitted or Completed, and an attempt count alone still doesn't count. Undated rows are kept. Mastering course pages and console.pearson.com course pages are read when they show an assignment table, with links straight to the item when the page has a real link. JavaScript launch buttons are never used as links. Mastering and console layouts are assumed, not yet checked on a real account.
- **MyLS:** quizzes complete from the student's own graded or scored attempts, and discussions from the student's own posts. If MyLS won't share attempts (403), the course falls back to content completion without a warning. Up to 40 of these checks run per course per sync.
- **Matching platform items to MyLS:**
  - Titles are compared after removing platform names, "(online)", "Assignment", trailing due text and punctuation. HW = Homework, and Ch/Ch./Chapter/Chapter 04 are treated as the same.
  - Chapter, quiz, part, module and week numbers must match exactly. A title that contains the other can match, unless the extra words name a different activity (practice, quiz, lab, reading…).
  - Due dates may be up to 26 hours apart, and an undated MyLS item can match.
  - A match must be unique both ways. One MyLS item matching both Pearson and Achieve is no longer merged three ways; it is treated as ambiguous.
  - The platform now owns the merged item: its title, link, status and source filter. MyLS keeps the item id, so check-offs, reminders and Calendar events carry over, and fills in a missing due date. The card reads "Pearson · also on MyLS".
  - A MyLS content visit never marks platform work complete.
  - Every merge decision is listed in Settings → Sync details.
- **Tests:** reader tests against saved HTML fixtures, cross-platform matching cases and MyLS quiz/discussion completion tests; 65 pass.

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
