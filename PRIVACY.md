# MYLD privacy policy

*Last updated: September 29, 2026*

MYLD (My Learning Date) is a Chrome extension that shows a Wilfrid Laurier student's coursework deadlines in one side panel. This policy explains what MYLD reads, where it keeps it, and what it never does.

## The short version

- Everything MYLD reads stays **in your own Chrome browser** on your computer.
- MYLD has **no server**. Nothing is sent to the developer or to anyone else.
- MYLD has **no analytics, no ads and no tracking**.
- MYLD **never sees your password**, never exports cookies and never submits, starts or changes any coursework.

## What MYLD reads

**From MyLearningSpace (mylearningspace.wlu.ca)**, using your existing signed-in session:

- your MyLearningSpace user ID, used only to keep each student's saved data separate on a shared computer
- the courses you're enrolled in this term
- assignment, quiz, discussion, calendar and content due dates, titles and links
- whether MyLearningSpace shows your own work as submitted or completed (your submissions, quiz attempts, discussion posts and content completion)

**From Pearson and Macmillan Achieve**, only if you choose to connect them in Settings, and only from course pages you already have open:

- the assignment titles, due dates, links and your completion status shown on the page
- the account name shown on the page. MYLD doesn't keep the name itself. It stores a one-way hash of it, used only to notice if a different account signs in.

MYLD doesn't save grades or scores. If a platform shows a score, MYLD uses it only to tell that the work was done. MYLD doesn't read messages, email, files, or any other website.

## Where it's kept

All of this is stored with Chrome's local extension storage (`chrome.storage.local`) on your device. It isn't synced to your Google account and isn't sent anywhere. The only network requests MYLD makes go to MyLearningSpace, to read the information above.

## Notifications

If you turn on reminders, Chrome shows deadline notifications on your computer. They can include an assignment's name and course code. Reminders are off until you turn them on.

## Deleting your data

Open MYLD → Settings → **Clear local data** to delete everything MYLD has saved. Removing the extension from Chrome also deletes it. Disconnecting Pearson or Achieve deletes what MYLD saved from that platform.

## Permissions

| Permission | Why MYLD needs it |
|---|---|
| Storage | Saving your deadlines, check-offs and settings on your computer |
| Alarms | Re-checking MyLearningSpace every 30 minutes and timing reminders |
| Side panel | Showing MYLD next to the page you're on |
| mylearningspace.wlu.ca | Reading your courses and deadlines, read-only, through your signed-in session |
| Notifications (optional) | Deadline reminders, only if you turn them on |
| Scripting and Pearson/Achieve sites (optional) | Reading the assignment list on Pearson or Achieve pages you've opened, only after you connect them |

## Sharing and sale

MYLD doesn't sell, share, rent or transfer your data to anyone, and doesn't use it for advertising, credit decisions or anything unrelated to showing your deadlines.

## Not affiliated

MYLD is an independent student project. It isn't affiliated with or endorsed by Wilfrid Laurier University, D2L, Pearson or Macmillan Learning.

## Changes and contact

If this policy changes, the new version will be posted here with a new date. Questions can be sent through the project's GitHub page: https://github.com/ahnafh26/MYLD_mylearningdate/issues
