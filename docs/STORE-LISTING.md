# Chrome Web Store listing

Text to paste into each part of the Chrome Web Store Developer Dashboard. The upload ZIP is the **contents** of the `extension` folder, with `manifest.json` at the top level of the ZIP.

## Store listing tab

**Name** (from the manifest): MYLD — My Learning Date

**Summary** (from the manifest, 132 characters max): Your MyLearningSpace deadlines, in one calm place. Built for Laurier students.

**Category:** Education (Tools)

**Language:** English (Canada)

**Description:**

```
MYLD puts every deadline from your Laurier courses in one side panel, so you don't have to click through each course to find out what's due next.

WHAT YOU GET
• One list for everything: assignments, quizzes, discussions and course dates from MyLearningSpace, sorted into Overdue, Today, This week, Next week, Later and Completed.
• What's due next, right at the top.
• One pill per class, even when MyLearningSpace has duplicate course shells.
• A quiz list for each class, including quizzes without a posted due date.
• Real completion: when MyLearningSpace shows your work as submitted, MYLD marks it done. Your own check-offs are kept separate, and ticking something off never submits it.
• A weekly progress bar for work due Monday to Sunday.
• Moved due dates are flagged, and optional reminders arrive before things are due.
• Pearson and Macmillan Achieve (optional): connect them to add homework from course pages you have open. When the same assignment is also posted on MyLearningSpace, it shows once, under the platform where you do the work.
• Laurier purple and gold, with light, dark and system themes.

PRIVATE BY DESIGN
Everything stays in Chrome on your computer. MYLD has no server, no analytics and no ads. It never sees your password, and it only reads. It never submits, starts or changes any coursework.

HOW TO START
1. Log in to MyLearningSpace in Chrome.
2. Click the MYLD icon to open the side panel. It syncs your courses automatically.
3. Optional: in Settings, connect Pearson or Achieve and turn on reminders.

MYLD is in beta. Check your courses for the final word on deadlines.

MYLD is an independent student project. It isn't affiliated with or endorsed by Wilfrid Laurier University, D2L, Pearson or Macmillan Learning.
```

**Graphics:**
- Store icon: `extension/icons/icon128.png` (128×128)
- Screenshots (1280×800): `MYLD-screenshot-1.png` to `MYLD-screenshot-4.png`
- Small promo tile (440×280): `MYLD-promo-440x280.png`

**Official URL:** leave empty. **Homepage URL:** https://github.com/ahnafh26/MYLD_mylearningdate. **Support URL:** https://github.com/ahnafh26/MYLD_mylearningdate/issues

## Privacy tab

**Single purpose:**

```
MYLD shows a Wilfrid Laurier student's coursework deadlines and completion status from MyLearningSpace (and, optionally, Pearson and Macmillan Achieve course pages the student has open) in one side panel, with optional deadline reminders.
```

**Permission justifications:**

| Field | Paste this |
|---|---|
| storage | Saves the student's deadlines, check-offs and settings locally so the side panel works offline and between syncs. |
| alarms | Re-reads MyLearningSpace every 30 minutes (adjustable) and schedules optional deadline reminders. |
| sidePanel | MYLD's interface is a side panel shown next to the page the student is on. |
| notifications | Optional. Shows deadline reminders only after the student turns reminders on in Settings. |
| scripting | Optional. After the student connects Pearson or Achieve in Settings, reads the assignment list (titles, due dates, completion status) on those course pages the student already has open. Read-only: it never clicks, opens or submits anything. |
| Host permission: mylearningspace.wlu.ca | Reads the student's enrolled courses, due dates and their own submission/completion status from MyLearningSpace (Laurier's D2L Brightspace) using read-only GET requests through their signed-in session. A content script on MyLearningSpace pages relays these same read-only requests when the browser blocks them from the background worker. |
| Optional hosts: console.pearson.com, mylabmastering.pearson.com, mylab.pearson.com, achieve.macmillanlearning.com | Requested only when the student connects Pearson or Achieve. Used to read the assignment list on course pages the student already has open. |

**Remote code:** No, I am not using remote code. (All JavaScript is included in the package. There are no remote scripts, eval or WebAssembly.)

**Data usage.** Tick these, because MYLD handles them even though everything stays on the device:
- ☑ **Personally identifiable information.** The MyLearningSpace user ID is used to keep each student's saved data separate. A Pearson or Achieve account name is stored only as a one-way hash.
- ☑ **Website content.** Course names, assignment titles, due dates, links and completion status.

Leave everything else unticked: health, financial, authentication information, personal communications, location, web history and user activity.

**Certify all three:**
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/ahnafh26/MYLD_mylearningdate/blob/main/PRIVACY.md

## Distribution tab

- **Visibility:** *Unlisted* to start (only people with the link can install it, which suits a beta), or *Public* when you're ready.
- **Regions:** Canada, or all regions.
