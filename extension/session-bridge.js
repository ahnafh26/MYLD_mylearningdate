// Requests stay in the signed-in MyLS tab. No cookies or tokens are read or copied.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'MYLD_READ') return;
  let url;
  try { url = new URL(message.path, location.origin); } catch { return; }
  const allowed = [
    /^\/d2l\/api\/versions\/$/,
    /^\/d2l\/api\/lp\/1\.\d+\/(?:users\/whoami|enrollments\/myenrollments\/)$/,
    /^\/d2l\/api\/le\/1\.\d+\/(?:content\/myItems\/(?:due\/|completions\/(?:due\/)?)?|calendar\/events\/myEvents\/)$/,
    /^\/d2l\/api\/le\/1\.\d+\/\d+\/dropbox\/categories\/$/,
    /^\/d2l\/api\/le\/1\.\d+\/\d+\/calendar\/events\/(?:myEvents\/)?$/,
    /^\/d2l\/api\/le\/1\.\d+\/\d+\/quizzes\/$/,
    /^\/d2l\/api\/le\/1\.\d+\/\d+\/discussions\/forums\/(?:\d+\/topics\/)?$/,
    /^\/d2l\/api\/le\/1\.\d+\/\d+\/dropbox\/folders\/(?:\d+\/submissions\/mysubmissions\/)?$/
  ];
  if (url.origin !== 'https://mylearningspace.wlu.ca' || url.username || url.password || !allowed.some(pattern => pattern.test(url.pathname))) return;
  (async () => {
    try {
      const response = await fetch(url.href, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      const isJson = (response.headers.get('content-type') || '').includes('json');
      respond({ status: response.status, isJson, body: response.ok && isJson ? await response.json() : null });
    } catch { respond({ networkError: true }); }
  })();
  return true;
});
