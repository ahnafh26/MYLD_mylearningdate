// This function runs in an isolated extension world. It reads rendered coursework only:
// it never clicks, expands, opens or submits anything. Everything it needs is defined
// inside the function because chrome.scripting serializes it into the page.
export function readProviderPage(provider) {
  const text = element => (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  // Without a year on the page, pick the year that puts the date closest to the course
  // year (or today), so a Fall course's January deadlines land in the next year.
  const withYear = (month, day, hours, minutes, year, yearHint) => {
    if (year) return new Date(year, month, day, hours, minutes);
    const base = yearHint || new Date().getFullYear();
    const anchor = yearHint ? new Date(yearHint, 8, 1) : new Date();
    return [base - 1, base, base + 1].map(y => new Date(y, month, day, hours, minutes)).sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor))[0];
  };
  const clock = (hour, minute, meridiem) => {
    let hours = +hour % 12;
    if (/p/i.test(meridiem || '')) hours += 12;
    else if (!meridiem) hours = +hour;
    return [hours, +(minute || 0)];
  };
  const parseDate = (value, yearHint) => {
    const source = String(value || '');
    let match = source.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s*(?:at\s*)?(\d{1,2}):(\d{2})\s*([ap])\.?m\.?)?/i);
    if (match) {
      const [hours, minutes] = match[4] ? clock(match[4], match[5], match[6]) : [23, 59];
      const date = new Date(match[3].length === 2 ? 2000 + +match[3] : +match[3], +match[1] - 1, +match[2], hours, minutes);
      return Number.isFinite(+date) ? date.toISOString() : null;
    }
    match = source.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?(?:,?\s*(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?)?/i);
    if (!match) return null;
    const [hours, minutes] = match[4] ? clock(match[4], match[5], match[6]) : [23, 59];
    const date = withYear(MONTHS[match[1].toLowerCase()], +match[2], hours, minutes, match[3] ? +match[3] : null, yearHint);
    return Number.isFinite(+date) ? date.toISOString() : null;
  };
  // The due date that follows a "Due" label, or a <time datetime> inside the row.
  const dueFrom = (element, labelText, yearHint) => {
    const time = element?.querySelector?.('time[datetime]')?.getAttribute('datetime');
    if (time && Number.isFinite(Date.parse(time))) return new Date(time).toISOString();
    const due = String(labelText || '').match(/(?:\b(?:[Dd]ue|DUE|[Cc]loses|[Dd]eadline)|(?<=[a-z])Due)\b[:\s]*(?:on\s+)?(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?(.{4,40})/i);
    return due ? parseDate(due[1], yearHint) : null;
  };
  // Completion must be the student's own status. Attempt counts, "x% complete" progress and
  // class-wide "students completed" totals are not evidence of completion.
  const completion = value => {
    const status = String(value || '').replace(/\d+\s*(?:of\s*\d+\s*)?students?\s+(?:have\s+)?completed/gi, ' ').replace(/\b\d+\s*(?:of|\/)\s*\d+\s+attempts?(?:\s+used)?\b|\battempts?\s*(?:used)?\s*:?\s*\d+(?:\s*(?:of|\/)\s*\d+)?/gi, ' ');
    if (/\b(?:not\s+(?:yet\s+)?(?:complete|completed|submitted|started|graded)|incomplete|in\s+progress|unsubmitted|not\s+attempted)\b/i.test(status)) return null;
    if (/\b100\s*%\s*(?:complete)?/i.test(status)) return 'Completed';
    if (/\b\d{1,2}(?:\.\d+)?\s*%\s*complete\b/i.test(status)) return null;
    if (/\b(?:late[\s-]?complete|completed?\s+late|submitted\s+late)\b/i.test(status)) return 'Submitted late';
    if (/\b(?:submitted|turned\s+in|handed\s+in)\b/i.test(status)) return 'Submitted';
    if (/\b(?:graded|scored)\b/i.test(status)) return 'Graded';
    if (/\bsee\s+score\b|\bscore\s*:?\s*\d+(?:\.\d+)?\s*(?:%|\/\s*\d+)|^\s*\d+(?:\.\d+)?\s*(?:%|\/\s*\d+)/i.test(status)) return 'Graded';
    if (/\bcomplete(?:d)?\b/i.test(status)) return 'Completed';
    return null;
  };
  const sameOriginLink = (anchor, fallback) => {
    try {
      const href = anchor?.getAttribute('href');
      if (!href || /^\s*javascript:/i.test(href)) return fallback;
      const url = new URL(href, location.href);
      return url.origin === location.origin && !url.username && !url.password ? url.href : fallback;
    } catch { return fallback; }
  };
  const typeOf = title => /\b(?:quiz|test|exam|midterm)\b/i.test(title) ? 'Quiz' : 'Dropbox';
  // Reads a table by its header labels, so column order changes don't break it.
  const tableRows = (table, fallbackLink, yearHint) => {
    const headers = [...table.querySelectorAll('thead th, thead td, tr:first-child th')].map(text);
    const col = pattern => headers.findIndex(header => pattern.test(header));
    const titleCol = col(/assignment|title|name|item/i), dueCol = col(/\bdue\b|deadline/i), statusCol = col(/status|score|grade|result|progress|submitted/i);
    if (titleCol < 0 || dueCol < 0) return null;
    const seen = new Set();
    return [...table.querySelectorAll('tbody tr')].map(row => {
      const cells = [...row.querySelectorAll('th, td')];
      const titleCell = cells[titleCol], anchor = titleCell?.querySelector('a');
      const title = text(anchor || titleCell);
      const dueText = text(cells[dueCol]);
      const dueDate = dueFrom(cells[dueCol], `due ${dueText}`, yearHint);
      const kind = completion(statusCol >= 0 ? text(cells[statusCol]) : '') || completion(text(row.querySelector('[class*="status" i]')));
      const href = anchor?.getAttribute('href') || '';
      const id = row.getAttribute('data-id') || row.id || href.match(/(?:assignmentId|itemId|id)=([\w-]+)/i)?.[1] || href.match(/\/(\d{3,})(?:[/?#]|$)/)?.[1] || (title ? `t:${title.toLowerCase().slice(0, 80)}` : null);
      if (!title || !id || seen.has(id) || !(dueDate || /no\s+due|—|^-$|^$/i.test(dueText))) return null;
      seen.add(id);
      return { externalId: id, title, dueDate, completed: Boolean(kind), completionKind: kind || undefined, type: typeOf(title), link: sameOriginLink(anchor, fallbackLink) };
    }).filter(Boolean);
  };
  const accountFrom = selectors => {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const label = (element.getAttribute('aria-label') || '').replace(/\b(?:account|profile|user)\s*(?:options|menu|settings)?\b.*$/i, '').replace(/^(?:hi|hello),?\s*/i, '').trim() || text(element).replace(/^(?:hi|hello),?\s*/i, '');
        if (label && label.length <= 80 && !/^(?:account|profile|menu|sign\s*in|log\s*in)$/i.test(label)) return label;
      }
    }
    return '';
  };

  if (provider === 'achieve' && location.origin === 'https://achieve.macmillanlearning.com') {
    const courseId = location.pathname.match(/^\/courses\/([^/]+)\/mycourse/)?.[1];
    const account = [...document.querySelectorAll('button[aria-label]')].find(el => /account options menu/i.test(el.getAttribute('aria-label')));
    if (!account) return { state: 'needs-login', message: 'Open your signed-in Achieve course.' };
    if (!courseId) return { state: 'unavailable', message: 'Open an Achieve course in the My Course assignments view.' };
    const courseName = [...document.querySelectorAll('[data-test-id="course-header"] button, h1 button, [data-test-id="course-header"], h1')].map(text).find(value => /[A-Z]{2,4}\s*-?\s*\d{3}|20\d{2}/i.test(value)) || '';
    const yearHint = +(courseName.match(/\b20\d{2}\b/)?.[0] || 0) || null;
    // Rows in collapsed groups and "Past Assignments" stay in the page even when hidden,
    // so every row is read, not only visible ones. Nothing is expanded or clicked.
    const seen = new Set();
    const rows = [...document.querySelectorAll('main li[id][data-test-id][aria-label], [role="main"] li[id][data-test-id][aria-label]')].map(el => {
      if (seen.has(el.id)) return null;
      seen.add(el.id);
      const label = el.getAttribute('aria-label');
      const title = text(el.querySelector('p[aria-label]')) || label.split(/,|\bdue\b/i)[0].trim();
      // Only status labels (and any "Status: ..." part of the row label) are read, never the title.
      const statuses = [...el.querySelectorAll('[data-test-id^="status-"]')].map(text).join(' · ');
      const labelStatus = label.match(/\bstatus\b[:\s]*(.*)$/i)?.[1] || '';
      const kind = /^complete$/i.test(text(el.querySelector('[data-test-id="status-complete-label"]'))) ? 'Completed' : completion(`${statuses} ${labelStatus}`);
      return { externalId: el.id, title, dueDate: dueFrom(el, label, yearHint) || dueFrom(el, text(el), yearHint), completed: Boolean(kind), completionKind: kind || undefined, type: typeOf(title),
        link: `${location.origin}${location.pathname}${/^[a-z0-9_-]+$/i.test(el.id) ? `#${el.id}` : ''}` };
    }).filter(row => row?.title);
    return { state: rows.length ? 'connected' : 'unavailable', account: account.getAttribute('aria-label').replace(/account options menu.*$/i, '').trim(), courseId, courseName, rows,
      partial: true, message: rows.length ? 'Reads the assignments loaded in open Achieve course tabs, including collapsed and Past Assignments groups already on the page. Use View All to load more. Dates use your device time zone.' : 'No assignments were found. Open My Course → Assignments and use View All.' };
  }

  if (provider === 'pearson' && location.origin === 'https://mylabmastering.pearson.com') {
    const account = text(document.querySelector('.user-text')).replace(/^Hi,\s*/i, '');
    const courseName = text(document.querySelector('.course-title'));
    const courseId = location.pathname.match(/^\/courses\/(\d+)/)?.[1] || new URLSearchParams(location.search).get('courseId');
    if (!account || !courseId) return { state: 'needs-login', message: 'Sign into Pearson and open a MyLab or Mastering course.' };
    // Mastering course pages list assignments in a table on the course site itself.
    const table = [...document.querySelectorAll('table')].map(el => tableRows(el, location.href)).find(rows => rows?.length);
    // Used only when the tab has no MyLab assignment frame, so rows are never read twice.
    return { state: 'context', account, courseName, courseId, ...(table ? { masteringRows: table, message: 'Reads the Mastering assignment table in open course tabs. This layout is new and not yet checked on a real account.' } : {}) };
  }

  if (provider === 'pearson' && location.origin === 'https://mylab.pearson.com') {
    const courseId = location.pathname.match(/^\/courses\/(\d+)\/assignments/)?.[1];
    const table = [...document.querySelectorAll('table')].find(el => /Assignments in your course/i.test(el.getAttribute('aria-label') || el.querySelector('caption')?.textContent || el.getAttribute('summary') || ''));
    if (!courseId || !table) return { state: 'unavailable', message: 'Open Lab Quizzes and Assignments in MyLab.' };
    const listLink = `${location.origin}/courses/${courseId}/assignments`;
    const rows = [...table.querySelectorAll('tbody tr')].map(el => {
      const heading = el.querySelector('th[scope="row"]');
      const link = heading?.querySelector('a');
      const title = text(link);
      const action = link?.getAttribute('href') || '';
      const scoreNode = el.querySelector('[id^="Q_"], [id^="H_"]');
      const id = action.match(/do(?:Test|Homework)\((\d+)/)?.[1] || scoreNode?.id.match(/^[QH]_(\d+)_/)?.[1];
      const dateText = text(el.querySelector('td .due')) || text(el.querySelector('td'));
      const kind = completion(text(scoreNode)) || completion(text(el.querySelector('[class*="status" i]')));
      // Launch links here are JavaScript calls, so only real page links become deep links.
      return { externalId: id ? `${/Homework/.test(action) || scoreNode?.id.startsWith('H_') ? 'H' : 'Q'}_${id}` : null, title, dueDate: parseDate(dateText), completed: Boolean(kind), completionKind: kind || undefined,
        type: /Homework/.test(action) || scoreNode?.id.startsWith('H_') ? typeOf(title) : 'Quiz', link: sameOriginLink(link, listLink) };
    }).filter(row => row.externalId && row.title);
    return { state: 'rows', courseId, rows, partial: true, message: 'Reads rows loaded in open MyLab assignment tables. Links open the assignment list when MyLab only offers a launch button.' };
  }

  if (provider === 'pearson' && location.origin === 'https://console.pearson.com') {
    const courseId = location.pathname.match(/\/courses?\/([\w-]+)/)?.[1];
    const account = accountFrom(['[data-testid*="user-name" i]', '[data-test-id*="user-name" i]', 'button[aria-label*="account" i]', 'button[aria-label*="profile" i]']);
    if (!courseId) return { state: 'unavailable', message: 'Open a Pearson course, then its assignments list.' };
    if (!account) return { state: 'unavailable', message: 'Could not identify the signed-in Pearson account on this page, so nothing was imported.' };
    const courseName = text(document.querySelector('h1'));
    const rows = [...document.querySelectorAll('table')].map(el => tableRows(el, location.href, +(courseName.match(/\b20\d{2}\b/)?.[0] || 0) || null)).find(found => found?.length);
    if (!rows) return { state: 'unavailable', message: 'This Pearson course view has no assignment table MYLD can read yet. Open the course in MyLab or Mastering instead. No coursework was imported.' };
    return { state: 'connected', account, courseId, courseName, rows, partial: true, message: 'Reads assignment tables on open Pearson course pages. This layout is new and not yet checked on a real account.' };
  }

  // Blank or helper frames inside a course page say nothing, so they can't hide the page's own message.
  if (typeof window !== 'undefined' && window.top !== window) return { state: 'ignored' };
  // Unsupported markup fails closed instead of inventing assignments.
  return { state: 'unavailable', message: 'This page isn’t one MYLD can read yet. No coursework was imported.' };
}
