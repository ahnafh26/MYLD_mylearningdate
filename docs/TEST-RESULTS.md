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

Cross-provider regression coverage: same-code duplicate shells; Achieve completion resolving its MyLS copy; three-source reconciliation; ambiguous/different chapter/deadline safeguards; account quarantine; and undoing manual completion from a merged alias.


Quiz coverage: undated visibility without reminders/weekly due counts; class/source quiz filtering including completed items; completion and dated-content reconciliation. Real course quiz list completeness is not yet verified.
