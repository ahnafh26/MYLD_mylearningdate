<div align="center">

<img src="extension/icons/icon128.png" width="96" alt="">

# MYLD — My Learning Date

**Your MyLearningSpace, Pearson and Achieve deadlines in one side panel, with reminders before things close.**

A Chrome extension for Wilfrid Laurier students.

![manifest v3](https://img.shields.io/badge/Chrome-Manifest_V3-EFBC22?style=flat-square&labelColor=4F2675)
![license](https://img.shields.io/badge/license-MIT-EFBC22?style=flat-square&labelColor=4F2675)
![status](https://img.shields.io/badge/status-beta-EFBC22?style=flat-square&labelColor=4F2675)

</div>

---

## Why I made this

I'm a double degree student with classes at Laurier. I used Eric Zou's [WATnow](https://github.com/EricJujianZou/watnow) and wanted one for Laurier, so I made MYLD.

## What you get

- Every dated thing across your courses sits in one list, sorted into Overdue, Today, This week, Next week, Later and Completed. The nearest deadline sits at the top.
- One pill per class, even when MyLearningSpace has duplicate course shells, plus MyLS, Pearson and Achieve source filters.
- A weekly progress bar for work due Monday to Sunday, scoped to whichever class or source you're looking at.
- A quiz list for each class, including quizzes without a posted due date.
- Completion that MyLS, Pearson or Achieve actually shows is kept separate from things you tick off yourself. Ticking something off never submits it.
- MYLD rereads MyLearningSpace every 30 minutes while Chrome is open. Changed due dates are flagged, and each kind of deadline can have its own reminder.
- Lavender, white and gold, with light, dark and system appearance, keyboard controls and reduced motion.

## Install

1. Download or clone this repo, for example into `Documents\MYLD_mylearningdate`.
2. Open `chrome://extensions` and turn on Developer mode.
3. Click **Load unpacked** and select the `extension` folder (the one with `manifest.json`).
4. Reload your signed-in MyLearningSpace tab, open MYLD from the toolbar and sync.

To update, pull the latest version and click **Reload** on the MYLD card. Loading the extension from a different folder creates a separate copy with its own saved data.

## Pearson and Achieve

Sync MyLearningSpace first. Then go to Settings → Connections, connect the platform and allow its page access. MYLD reads the assignment pages you have open. It doesn't open every course on its own, and it never launches or submits anything.

- **Pearson MyLab:** open a course, then Lab Quizzes and Assignments.
- **Achieve:** open My Course → Assignments, and expand groups or use View All to show more work.

Only work that's loaded and has a date is picked up, so treat the platform as the source of truth. When the same assignment shows up on more than one platform (same class, same title, due within 24 hours), MYLD shows it once. If any platform shows it as complete, it counts as complete. Disconnecting a platform removes its saved data.

## Google Calendar

The code to add deadlines to Google Calendar is included, but it needs a Google OAuth client before it can be switched on. See [docs/GOOGLE-CALENDAR-SETUP.md](docs/GOOGLE-CALENDAR-SETUP.md). Once it's set up, each student connects their own Google account. No client secret goes in the extension.

## Status

MYLD is in beta. MyLearningSpace sync works on a real account, but some completion updates still need more live testing. The Pearson and Achieve readers have been tested on real course pages, but other course layouts may not be supported yet. Google Calendar has not been tested live. Details are in [docs/TEST-RESULTS.md](docs/TEST-RESULTS.md) and [docs/CHANGELOG.md](docs/CHANGELOG.md).

## Privacy

Everything stays in Chrome's local storage on your computer. There's no MYLD server, no analytics, no password collection and no cookie export. MYLD only asks for access to MyLearningSpace, plus the Pearson, Achieve and Google Calendar sites if you connect them.

| Permission | Why |
|---|---|
| storage, alarms, sidePanel | Saving your list and settings, scheduling syncs and reminders, and showing the side panel |
| mylearningspace.wlu.ca | Reading your courses and deadlines through your signed-in tab (read-only) |
| notifications (optional) | Deadline reminders, only if you turn them on |
| identity | Signing in to Google for Calendar |
| scripting and Pearson/Achieve sites (optional) | Reading assignment lists on pages you've connected |
| googleapis.com (optional) | Adding deadlines to Google Calendar |

**Clear local data** in Settings removes everything MYLD has saved. It doesn't delete events you already added to Google Calendar.

## Development

No build step. It's plain HTML, CSS and JavaScript on Chrome Manifest V3. Tests need Node.js 22+:

```
node --test tests/*.test.mjs
```

| Path | What's in it |
|---|---|
| `extension/background.js` | MyLearningSpace sync, reminders, badge and notifications |
| `extension/planner.js` | Term detection, date groups and reminder timing |
| `extension/session-bridge.js` | Read-only MyLearningSpace requests through your signed-in tab |
| `extension/integrations/` | Pearson and Achieve readers, cross-platform matching and Google Calendar |
| `extension/popup/` | The side panel |
| `tests/` | Automated tests |

---

Not affiliated with or endorsed by Wilfrid Laurier University, D2L, Pearson or Macmillan Learning. Released under the [MIT License](LICENSE).
