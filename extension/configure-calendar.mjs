import { readFile, writeFile } from 'node:fs/promises';
const clientId = process.argv[2];
if (!/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(clientId || '')) {
  console.error('Pass the public Chrome Extension OAuth client ID from your Google Cloud project. Never pass a client secret.');
  process.exitCode = 1;
} else {
  const path = new URL('./manifest.json', import.meta.url);
  const manifest = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
  manifest.oauth2 = { client_id: clientId, scopes: ['https://www.googleapis.com/auth/calendar.events.owned'] };
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
  console.log('Publisher OAuth client configured. Reload MYLD and test Google Calendar consent before distributing.');
}
