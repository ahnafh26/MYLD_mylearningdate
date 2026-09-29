# Validation — September 29, 2026 (platform integrations)

Automated command: `node --test tests/*.test.mjs`. Result: **60 passed, 0 failed**.

Top Hat and the Google Calendar export were removed on September 29. Top Hat never synced on a real account, and Calendar was never set up. Their code, permissions, fixtures and tests are gone; the notes below cover what remains. The September 28 run (65 passed) was in the America/Toronto, UTC and Asia/Kolkata time zones.

The page readers are now tested against saved HTML fixtures in `tests/fixtures/`, using a small built-in DOM (`tests/helpers/dom.mjs`) so no packages need installing.

- **Achieve fixture:** shaped like the view the reader was checked against on a real account. It covers Complete, Submitted late, Score, In progress, "40% complete", a class-wide "students completed" count, an undated row, a hidden Past Assignments group and a January row in a Fall course.
- **Pearson MyLab fixture:** shaped like the real "Assignments in your course" table. It covers See score, a numeric score, attempts only, Submitted and an undated row.
- **Pearson Mastering and Pearson console fixtures:** these are **assumed layouts**, not copies of real pages. The tests prove the readers behave correctly on that markup (completion rules, due-date parsing, safe links, failing closed), not that they will find rows on the real sites.
- **Cross-platform matching:** Achieve and Pearson "Chapter 4 Homework" (complete) against MyLS "… – Ch. 4 HW" (pending, 3 hours apart) merge into one item owned by the platform and marked Submitted by it. Ch 4 vs Ch 5, the same title in two classes, two MyLS candidates, and one MyLS item matching two platforms never merge. An undated MyLS item takes the platform's date. 23:59 Toronto against 23:59 read in UTC still merges. A MyLS content visit never completes platform work. Previously verified completion survives a closed tab. Pearson and Achieve course names map to the MyLS course.
- **MyLS quizzes and discussions:** a graded or scored quiz attempt, or the student's own discussion post, marks the item complete. A 403 on attempts stops further attempt requests for that course without a warning.
- **Provider sync:** undated rows are kept for Pearson and Achieve. A Mastering page table is used only when the tab has no MyLab assignment frame.

The side panel was rendered in Chromium with synthetic data at 320 and 400 CSS pixels. The source filters fit, and merged cards read "Achieve · also on MyLS".

## Not yet checked on a real account

1. **Pearson Mastering and console:** confirm whether their assignment views are tables with Assignment/Title and Due headers. If they aren't, the reader imports nothing and says so.
2. **Achieve:** re-sync a real course to confirm that hidden Past Assignments rows really stay in the page, and check the exact wording of late, scored and submitted statuses.
3. **Pearson MyLab:** confirm the wording of submitted and completed rows beyond "See score".
4. **MyLS quizzes and discussions:** check whether MyLS lets students read their own quiz attempts and whether posts show `PostingUserId`. If attempts return 403, quizzes rely on content completion as before.
5. **Matching:** look at Settings → Sync details after a real sync, and confirm real MyLS link titles (for example "Achieve – Ch. 4 HW") merge while different chapters don't.

---

# Validation — September 27, 2026

Automated command: `node --test tests/*.test.mjs`.
Baseline before changes: 18 passed. Updated suite: **43 passed, 0 failed**.

New coverage: historical completion without due dates; retention after cache reload; rejecting unrelated completion evidence; manual/verified distinction; week boundaries and recurring-event exclusion; composed filters; owner isolation/course mapping; safe links; stable Calendar IDs; repeated adds; lost-create-response conflicts; unrelated/deleted events; missing OAuth configuration; provider account changes and mixed-account quarantine.

A Calendar ID test caught an invalid character in the initial prefix. It was corrected to a base32hex-compatible prefix before packaging.

## Live evidence

The actual packaged DOM reader was run read-only against signed-in course pages. No coursework was launched, submitted or modified.

- Pearson: parent/frame course identities matched; 11 dated rows, 3 with completion evidence.
- Achieve: 14 dated rows, 8 with explicit personal Complete status. Selectors were corrected from actual role-based markup and retested.
- This verifies extraction for these views, not all products or installed-extension permission/injection behavior.
- No real Google Calendar event was created. Publisher OAuth configuration is absent.
- No real new MyLS submission was made to test a completion transition.
- No real account identifiers or extracted coursework are packaged.

## UI evidence

Actual UI modules ran in Chrome with separate synthetic storage/API fixtures, excluded from the extension. Visual inspection and checks at 320, 360, 400 and 480 CSS pixels found no horizontal overflow or clipped assignment titles. Source filtering, manual check-off with preserved keyboard focus, progress updates, dark theme and Completed view were exercised. Settings disclose partial coverage and disable unconfigured Calendar. These are UI checks, not live sync verification.

## Remaining release checks

1. Reload this exact folder and MyLS; verify the service worker and real sync.
2. Verify an older real submission on fresh install, then a new submission followed by sync. Include special-access/group assignments.
3. Connect Pearson/Achieve through MYLD permission prompts. Check dates, expanded lists, multiple courses, additional MyLab layouts and reload/resync.
4. Test disconnect, permission revocation and account changes. Identical provider display names cannot reliably distinguish accounts.
5. Configure Google OAuth; verify consent rejection/revocation, individual/bulk adds, changed dates, repeated adds, worker restart, disconnect and another Google account. Complete applicable Google and Chrome Web Store requirements.
6. Verify actual OS notifications, alarms and notification navigation; automated tests mock Chrome delivery.

The requested 4.0 release bump remains deferred until these integration checks are complete.

Cross-provider regression coverage: same-code duplicate shells; Achieve completion resolving its MyLS copy; three-source matches (now treated as ambiguous, see above); ambiguous/different chapter/deadline safeguards; account quarantine; and undoing manual completion from a merged alias.


Quiz coverage: undated visibility without reminders/weekly due counts; class/source quiz filtering including completed items; completion and dated-content reconciliation. Real course quiz list completeness is not yet verified.
