// This function runs in an isolated extension world. It reads rendered coursework only.
export function readProviderPage(provider) {
  const text = element => (element?.innerText || element?.textContent || '').trim();
  const visible = element => Boolean(element?.getClientRects().length);
  if (provider === 'achieve' && location.origin === 'https://achieve.macmillanlearning.com') {
    const courseId = location.pathname.match(/^\/courses\/([^/]+)\/mycourse/)?.[1];
    const account = [...document.querySelectorAll('button[aria-label]')].find(el => /account options menu/i.test(el.getAttribute('aria-label')));
    if (!account) return { state: 'needs-login', message: 'Open your signed-in Achieve course.' };
    if (!courseId) return { state: 'unavailable', message: 'Open an Achieve course in the My Course assignments view.' };
    const courseName = [...document.querySelectorAll('[data-test-id="course-header"] button, h1 button')].map(text).find(value => /20\d{2}/.test(value)) || '';
    const year = courseName.match(/\b20\d{2}\b/)?.[0];
    if (!year) return { state: 'unavailable', message: 'Could not determine the course year; no dates were imported.' };
    const rows = [...document.querySelectorAll('main li[id][data-test-id][aria-label], [role="main"] li[id][data-test-id][aria-label]')].filter(visible).map(el => {
      const title = text(el.querySelector('p[aria-label]'));
      const due = el.getAttribute('aria-label').match(/\bDue\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{1,2}:\d{2})\s+(AM|PM)\b/i);
      const dueDate = due ? new Date(`${due[1]} ${due[2]}, ${year} ${due[3]} ${due[4]}`) : null;
      const completed = text(el.querySelector('[data-test-id="status-complete-label"]')) === 'Complete';
      return { externalId: el.id, title, dueDate: dueDate && Number.isFinite(+dueDate) ? dueDate.toISOString() : null, completed, link: `${location.origin}${location.pathname}${/^[a-z0-9_-]+$/i.test(el.id) ? `#${el.id}` : ''}` };
    }).filter(row => row.title && row.dueDate);
    return { state: rows.length ? 'connected' : 'unavailable', account: account.getAttribute('aria-label').replace(/account options menu.*$/i, '').trim(), courseId, courseName, rows,
      partial: true, message: 'Reads loaded assignments in open course tabs. Use View All and expand Past Assignments to include more work. Dates use your device time zone.' };
  }
  if (provider === 'pearson' && location.origin === 'https://mylabmastering.pearson.com') {
    const account = text(document.querySelector('.user-text')).replace(/^Hi,\s*/i, '');
    const courseName = text(document.querySelector('.course-title'));
    const courseId = location.pathname.match(/^\/courses\/(\d+)/)?.[1];
    return account && courseId ? { state: 'context', account, courseName, courseId } : { state: 'needs-login', message: 'Sign into Pearson and open a MyLab course.' };
  }
  if (provider === 'pearson' && location.origin === 'https://mylab.pearson.com') {
    const courseId = location.pathname.match(/^\/courses\/(\d+)\/assignments/)?.[1];
    const table = [...document.querySelectorAll('table')].find(el => /Assignments in your course/i.test(el.getAttribute('aria-label') || el.querySelector('caption')?.textContent || el.getAttribute('summary') || ''));
    if (!courseId || !table) return { state: 'unavailable', message: 'Open Lab Quizzes and Assignments in MyLab.' };
    const rows = [...table.querySelectorAll('tbody tr')].filter(visible).map(el => {
      const heading = el.querySelector('th[scope="row"]');
      const link = heading?.querySelector('a');
      const title = text(link);
      const action = link?.getAttribute('href') || '';
      const scoreNode = el.querySelector('[id^="Q_"], [id^="H_"]');
      const id = action.match(/do(?:Test|Homework)\((\d+)/)?.[1] || scoreNode?.id.match(/^[QH]_(\d+)_/)?.[1];
      const dateText = text(el.querySelector('td .due')) || text(el.querySelector('td'));
      const date = dateText.match(/(\d{2})\/(\d{2})\/(\d{2,4})\s*(\d{1,2}):(\d{2})\s*(am|pm)/i);
      let dueDate = null;
      if (date) { const hours = +date[4] % 12 + (date[6].toLowerCase() === 'pm' ? 12 : 0); const year = date[3].length === 2 ? 2000 + +date[3] : +date[3]; dueDate = new Date(year, +date[1]-1, +date[2], hours, +date[5]).toISOString(); }
      const scoreText = text(scoreNode);
      // An attempt count alone is not evidence of submission.
      const completed = /see score/i.test(scoreText) || /^\d+(?:\.\d+)?\s*(?:%|\/\s*\d+)/.test(scoreText);
      return { externalId: id ? `${/Homework/.test(action) || scoreNode?.id.startsWith('H_') ? 'H' : 'Q'}_${id}` : null, title, dueDate, completed, link: `${location.origin}/courses/${courseId}/assignments` };
    }).filter(row => row.externalId && row.title && row.dueDate);
    return { state: 'rows', courseId, rows, partial: true, message: 'Reads rows loaded in open MyLab assignment tables. Other MyLab products may use a different view. Links open the assignment list.' };
  }
  // Unsupported product markup fails closed instead of inventing assignments.
  return { state: 'unavailable', message: 'This Pearson assignment view has not been verified. No coursework was imported.' };
}
