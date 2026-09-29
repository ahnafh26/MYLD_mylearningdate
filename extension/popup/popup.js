import { DEFAULT_PREFS, ORIGIN, safeLink, effectiveAssignments, courseLabel } from '../background.js';
import { PROVIDERS, EXTERNAL_PROVIDERS, providerOf, assignmentLink, combinedData } from '../integrations/model.js';
import { weeklyProgress, knownProgress, scopedItems, inView } from './dashboard.js';
import { REMINDER_TYPES, DEFAULT_LEADS, LEADS, bucketOf, categoryOf } from '../planner.js';
const $ = id => document.getElementById(id);
let sourceFilter = 'all', deadlineView = 'all', integrationBusy = false;
let data = {}, courseFilter = 'all', syncing = false, localError = '', settingsOpen = false, preferenceWrite = Promise.resolve();
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
const prefs = () => ({ ...DEFAULT_PREFS, ...data.preferences });
const shortDate = value => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
function relative(value) { const m = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`; }
function setSettings(open) { settingsOpen = open; $('settings').hidden = !open; $('dashboard').hidden = open; $('settings-toggle').setAttribute('aria-expanded', String(open)); if (open) renderSettings(); }
function render() {
  const focusKey=document.activeElement?.dataset?.focusKey;
  document.documentElement.dataset.theme = prefs().theme === 'system' ? systemTheme.matches ? 'dark' : 'light' : prefs().theme;
  const courses = (combinedData(data).courses).map(c => ({ ...c, code: courseLabel(c.name, c.code) })).sort((a,b) => a.code.localeCompare(b.code, undefined, { numeric: true }) || a.id.localeCompare(b.id));
  // Platform items can be undated (they show under "No date listed"); MyLS keeps only quizzes undated.
  const assignments = effectiveAssignments(data).filter(item => item.type === 'Quiz' || providerOf(item) !== 'd2l' || Number.isFinite(Date.parse(item.dueDate))).map(item => ({ ...item, courseCode: courses.find(c => c.id === item.courseId)?.code || item.courseCode })).sort((a,b) => (Date.parse(a.dueDate) || Infinity) - (Date.parse(b.dueDate) || Infinity));
  const pending = assignments.filter(item => ['Pending', 'Overdue'].includes(item.status));
  const upcoming = pending.filter(item => Date.parse(item.dueDate) >= Date.now());
  const overdue = pending.filter(item => item.status === 'Overdue');
  const state = data.syncState || {};
  const incomplete = !data.complete || Boolean(state.error) || state.warnings?.length;
  $('refresh').disabled = syncing; $('refresh').classList.toggle('spinning', syncing); $('timeline').setAttribute('aria-busy', String(syncing));
  $('notice').hidden = !(localError || state.error || state.warnings?.length);
  $('notice-text').textContent = localError || (state.error ? data.lastSync ? `Couldn’t refresh MyLS. Showing dates saved ${relative(data.lastSync)}.` : 'Open your signed-in MyLS tab, then sync.' : `${state.warnings?.[0] || ''}${state.warnings?.length > 1 ? ` (+${state.warnings.length - 1} more in Settings)` : ''}`);
  $('hero-label').textContent = upcoming.length ? 'UP NEXT' : 'MY LEARNING DATE';
  const nearest = upcoming[0];
  $('hero-title').textContent = !data.lastSync ? 'Your deadlines. One place.' : nearest ? `${nearest.courseCode} · ${bucketOf(nearest) === 'Today' ? 'due today' : shortDate(nearest.dueDate).split(',').slice(0,2).join(',')}` : overdue.length ? `${overdue.length} overdue ${overdue.length === 1 ? 'item' : 'items'}.` : pending.length ? 'Your coursework.' : incomplete ? 'Your saved deadlines.' : 'All caught up on MyLS.';
  $('hero-detail').textContent = !data.lastSync ? 'Open MyLS, then sync your courses.' : nearest ? `${upcoming.filter(i => Date.parse(i.dueDate) <= Date.now() + 7 * 86400000).length} due in the next 7 days${overdue.length ? ` · ${overdue.length} overdue` : ''}` : pending.length ? 'Check your list below, including quizzes without dates.' : incomplete ? 'Sync again to check for missing items.' : 'No pending deadlines in your synced courses.';
  $('nearest').hidden = !nearest;
  if (nearest) { $('nearest').textContent = `${nearest.title} ↗`; $('nearest').href = assignmentLink(nearest); $('nearest').title = `${nearest.title} · ${shortDate(nearest.dueDate)}`; }
  if (courseFilter !== 'all' && !courses.some(c => c.id === courseFilter)) courseFilter = 'all';
  $('filters').replaceChildren();
  for (const course of [{ id: 'all', code: 'All' }, ...courses]) {
    const count = pending.filter(i => course.id === 'all' || i.courseId === course.id).length;
    const button = node('button', 'filter'); button.type = 'button'; button.title = course.name || 'All courses'; button.setAttribute('aria-pressed', String(course.id === courseFilter));
    button.dataset.focusKey=`course:${course.id}`;
    if (/^#[0-9a-f]{6}$/i.test(course.color)) button.style.setProperty('--course-color', course.color);
    if (course.id !== 'all') button.append(node('span', 'course-dot'));
    button.append(node('span', 'filter-label', course.code), node('span', 'filter-count', String(count)));
    button.addEventListener('click', () => { courseFilter = course.id; render(); }); $('filters').append(button);
  }
  renderSources();
  const scoped = scopedItems(assignments, courseFilter, sourceFilter);
  const progress = weeklyProgress(scoped);
  $('progress-text').textContent = `This week: ${progress.done} / ${progress.total} completed`;
  $('progress-percent').textContent = progress.total ? `${progress.percent}%` : '—';
  $('week-progress').value = progress.percent;
  $('week-progress').setAttribute('aria-valuetext', `${progress.done} of ${progress.total} coursework items completed this week`);
  const partial = incomplete || Object.values(data.external || {}).some(p => p.ownerId === data.accountId && p.partial);
  $('progress-note').textContent = [progress.total ? `${progress.verified} verified · ${progress.manual} checked off manually` : 'No coursework due this week in this view.', partial ? 'Based on available synced items.' : '', progress.stale ? 'Includes previously verified completion.' : ''].filter(Boolean).join(' ');
  const semester = knownProgress(scoped);
  $('semester-progress').textContent = `Tracked coursework: ${semester.done} / ${semester.total} completed${courseFilter === 'all' ? ' across your courses' : ' in this course'}`;
  const visible = scoped.filter(i => inView(i, deadlineView) && (['completed','quizzes'].includes(deadlineView) || prefs().showSubmitted || ['Pending','Overdue'].includes(i.status)));
  $('list-title').textContent = courseFilter === 'all' ? 'Your deadlines' : courses.find(c => c.id === courseFilter)?.code;
  $('pending-count').textContent = `${scopedItems(pending, courseFilter, sourceFilter).length} pending`;
  $('timeline').replaceChildren();
  if (!visible.length) {
    const empty = node('div','empty'); const img = node('img'); img.src = '../icons/mark.svg'; img.alt = '';
    empty.append(img, node('h3','',data.lastSync && !incomplete ? 'All caught up!' : 'No deadlines to show'), node('p','',data.lastSync && !incomplete ? 'Enjoy a little breathing room.' : 'Your course dates appear after syncing.')); $('timeline').append(empty);
  }
  for (const label of ['Overdue','Today','This week','Next week','Later','No date listed','Completed']) {
    const items = visible.filter(i => bucketOf(i) === label); if (!items.length) continue;
    const section = node('section'); section.append(node('h3',`group-heading ${label.toLowerCase()}`,`${label} · ${items.length}`));
    items.forEach(item => section.append(card(item))); $('timeline').append(section);
  }
  $('sync-time').textContent = syncing ? 'Syncing MyLS…' : data.lastSync ? `Synced ${relative(data.lastSync)}` : 'Not synced yet';
  $('sync-time').title = data.lastSync ? shortDate(data.lastSync) : '';
  if (settingsOpen) renderSettings();
  if(focusKey) document.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({preventScroll:true});
}
function card(item) {
  const wrapper = node('article',`deadline${item.status === 'Overdue' ? ' is-overdue' : ''}`);
  const provider = PROVIDERS[providerOf(item)];
  const completionSource = PROVIDERS[item.completionProvider]?.label || provider.label;
  const verified = item.status === 'Submitted', checked = verified || item.manualDone;
  const done = node(verified ? 'span' : 'button', `check-off${verified ? ' verified' : ''}`, checked ? '✓' : '');
  done.title = verified ? `Completion reported by ${completionSource}` : checked ? 'Undo check-off' : 'Mark done locally';
  if (!verified) {
    done.dataset.focusKey=`done:${item.id}`;
    done.type = 'button'; done.setAttribute('aria-pressed',String(checked)); done.setAttribute('aria-label',`${checked ? 'Undo check-off:' : 'Mark done:'} ${item.title}`);
    done.addEventListener('click',async()=>{ done.disabled=true; try { const result=await chrome.runtime.sendMessage({type:'MARK_DONE',id:item.id,accountId:data.accountId,done:!item.manualDone}); if(!result?.ok) throw new Error(); } catch { localError='Could not save your check-off. Sync and try again.';render(); } });
  }
  const link=node('a','card');link.href=assignmentLink(item);link.target='_blank';link.rel='noopener noreferrer';link.title=item.title;
  const top=node('div','card-top');
  const tag=node('span','course-tag'); tag.append(node('span','course-dot'),node('span','',item.courseCode));
  const color=combinedData(data).courses.find(c=>c.id===item.courseId)?.color;
  if(/^#[0-9a-f]{6}$/i.test(color)) tag.style.setProperty('--course-color',color);
  const source=node('span',`source-badge ${providerOf(item)}`,`${provider.label}${item.alsoOn?.includes('d2l')?' · also on MyLS':''}`);
  top.append(tag,source);
  const meta=node('div',`card-meta ${item.status.toLowerCase()} ${item.changedFrom?'changed':''}`);
  const hasDate=Number.isFinite(Date.parse(item.dueDate));
  const time=node(hasDate?'time':'span','',hasDate ? `${verified ? `${item.completionKind || 'Submitted'} · Due` : item.manualDone ? 'Checked off · Due' : item.status === 'Overdue' ? 'Overdue' : item.dateKind || 'Due'} · ${shortDate(item.dueDate)}` : `${verified ? 'Completed · ' : item.manualDone ? 'Checked off · ' : ''}No date listed`);if(hasDate)time.dateTime=item.dueDate;meta.append(time);
  if(item.changedFrom)meta.append(node('del','changed-date',`Was ${shortDate(item.changedFrom)}`));
  link.append(top,node('strong','card-title',item.title),meta);
  if(item.opensAt && Date.parse(item.opensAt)>Date.now())link.append(node('p','verification',`Opens ${shortDate(item.opensAt)}`));
  if(verified) link.append(node('p','verification verified-note',`${item.verificationCached ? 'Previously verified' : 'Verified'} by ${completionSource}`));
  else if(item.manualDone) link.append(node('p','verification','Checked off manually · not a submission'));
  else if(item.statusSource==='restricted') link.append(node('p','verification','MyLS doesn’t share this submission status · check MyLS'));
  if(item.stale)link.append(node('p','verification',`Saved date · check ${provider.label}`));
  wrapper.append(done,link);
  return wrapper;
}
function renderSettings() {
  $('theme').value=prefs().theme; $('show-submitted').checked=prefs().showSubmitted; $('show-badge').checked=prefs().badge; $('sync-interval').value=String(prefs().syncMinutes); $('reminders').checked=prefs().reminders; $('moved-reminders').checked=prefs().movedReminders;
  // Preserve focused sliders while storage changes arrive.
  if (!$('reminder-types').contains(document.activeElement)) {
    $('reminder-types').replaceChildren();
    for(const [type,label] of Object.entries(REMINDER_TYPES)) {
      const lead={...DEFAULT_LEADS,...prefs().reminderLeads}[type];const row=node('div','reminder-row');const heading=node('label','',label); const enabled=node('input');enabled.type='checkbox';enabled.checked=lead!=='off';enabled.setAttribute('aria-label',`${label} reminders`);heading.append(enabled);
      const output=node('output','',lead==='off'?'Off':lead==='morning'?'Morning of':`${lead[0]} ${lead[0]==='1'?'day':'days'} before`);
      const slider=node('input');slider.type='range';slider.min='0';slider.max='7';slider.step='1';slider.value=String(Math.max(0,LEADS.indexOf(lead)));slider.disabled=lead==='off';slider.setAttribute('aria-label',`${label} reminder timing`);
      const setLead=value=>savePreference('reminderLeads',{...DEFAULT_LEADS,...prefs().reminderLeads,[type]:value});
      slider.addEventListener('input',()=>{output.textContent=+slider.value===7?'Morning of':`${LEADS[+slider.value][0]} days before`;});slider.addEventListener('change',()=>setLead(LEADS[+slider.value]));enabled.addEventListener('change',()=>{ const value=enabled.checked?DEFAULT_LEADS[type]:'off'; slider.disabled=!enabled.checked; slider.value=String(Math.max(0,LEADS.indexOf(value))); output.textContent=value==='off'?'Off':value==='morning'?'Morning of':`${value[0]} days before`; setLead(value); });row.append(heading,output,slider);$('reminder-types').append(row);
    }
  }
  $('reminder-courses').replaceChildren();
  for(const course of [...combinedData(data).courses].sort((a,b)=>courseLabel(a.name,a.code).localeCompare(courseLabel(b.name,b.code)))) {
    const label=node('label','',courseLabel(course.name,course.code));const input=node('input');input.type='checkbox';input.checked=!prefs().mutedCourses.includes(course.id);input.setAttribute('aria-label',`Reminders for ${courseLabel(course.name,course.code)}`);input.addEventListener('change',()=>savePreference('mutedCourses',input.checked?prefs().mutedCourses.filter(id=>id!==course.id):[...new Set([...prefs().mutedCourses,course.id])]));label.append(input);$('reminder-courses').append(label);
  }
  renderConnections();
  $('diagnostics').textContent=[data.syncState?.error,...(data.syncState?.warnings||[]),...Object.entries(data.external||{}).map(([p,v])=>`${PROVIDERS[p]?.label || p}: ${v.state} · ${v.message || ''}`),...combinedData(data).mergeLog.slice(0,60),...(data.diagnostics?.requests||[]).map(r=>`${r.status||'NETWORK'} · ${r.via} · ${r.endpoint}`)].filter(Boolean).join('\n')||'No requests yet.';
}
function savePreference(key,value) {
  preferenceWrite=preferenceWrite.catch(()=>{}).then(async()=>{const {preferences={}}=await chrome.storage.local.get('preferences');await chrome.storage.local.set({preferences:{...DEFAULT_PREFS,...preferences,[key]:value}});}).catch(()=>{localError='Could not save your setting.';render();});return preferenceWrite;
}
async function refresh() { if(syncing)return;syncing=true;localError='';render();try{await chrome.runtime.sendMessage({type:'SYNC'});}catch{localError='Sync was interrupted. Try again.';}finally{syncing=false;data=await chrome.storage.local.get(null);render();} }
$('deadline-view').addEventListener('change',e=>{deadlineView=e.target.value;render();});
$('refresh').addEventListener('click',refresh);$('settings-toggle').addEventListener('click',()=>setSettings(!settingsOpen));$('settings-close').addEventListener('click',()=>setSettings(false));
for(const [id,key] of [['show-submitted','showSubmitted'],['show-badge','badge'],['moved-reminders','movedReminders']])$(id).addEventListener('change',e=>savePreference(key,e.target.checked));
$('theme').addEventListener('change',e=>savePreference('theme',e.target.value));$('sync-interval').addEventListener('change',e=>savePreference('syncMinutes',Number(e.target.value)));
$('reminders').addEventListener('change',async e=>{try{const enabled=e.target.checked&&await chrome.permissions.request({permissions:['notifications']});await savePreference('reminders',enabled);}catch{localError='Notification permission could not be enabled.';render();}});
$('copy-diagnostics').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('diagnostics').textContent);$('copy-diagnostics').textContent='Copied';}catch{$('copy-diagnostics').textContent='Select the details above to copy';}});
$('clear-data').addEventListener('click',()=>{$('clear-confirm').hidden=false;});$('clear-no').addEventListener('click',()=>{$('clear-confirm').hidden=true;});
$('clear-yes').addEventListener('click',async()=>{try { const result=await chrome.runtime.sendMessage({type:'CLEAR_DATA'});if(result?.ok){data={};localError='';$('clear-confirm').hidden=true;render();}else{localError='Wait for the current sync to finish, then clear data.';render();}} catch {localError='Could not clear data. Please try again.';render();}});
chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;for(const [key,value]of Object.entries(changes))data[key]=value.newValue;if(changes.syncState)syncing=Boolean(changes.syncState.newValue?.running);render();});
systemTheme.addEventListener('change',render);
async function initialize(){data=await chrome.storage.local.get(null);render();const status=await chrome.runtime.sendMessage({type:'STATUS'});syncing=Boolean(status?.running);render();if(!syncing&&!data.deletedAt&&(!data.lastSync||Date.now()-Date.parse(data.lastSync)>prefs().syncMinutes*60000))await refresh();}
initialize().catch(()=>{localError='Close and reopen MYLD to try again.';render();});setInterval(render,60000);

function sourceSymbol(provider) { return {all:'◇',d2l:'▱',pearson:'Ⓟ',achieve:'▥'}[provider]; }
function renderSources() {
  $('source-filters').replaceChildren();
  for(const [id,label] of [['all','All Sources'],...Object.entries(PROVIDERS).map(([id,p])=>[id,p.label])]) {
    const button=node('button',`source-filter ${id}`);button.type='button';button.setAttribute('aria-pressed',String(sourceFilter===id));
    button.dataset.focusKey=`source:${id}`;
    const icon=node('span','source-symbol',sourceSymbol(id));icon.setAttribute('aria-hidden','true');button.append(icon,node('span','',label));
    button.addEventListener('click',()=>{sourceFilter=id;render();});$('source-filters').append(button);
  }
  const source=data.external?.[sourceFilter];
  const note=EXTERNAL_PROVIDERS.includes(sourceFilter) ? source?.ownerId === data.accountId ? source.message || 'Only loaded course pages are included.' : `Connect ${PROVIDERS[sourceFilter].label} in Settings to read its open assignment pages.` : '';
  $('source-note').hidden=!note;$('source-note').textContent=note;
}
async function runIntegration(message) {
  if(integrationBusy)return;
  integrationBusy=true;localError='';render();
  try {
    const result=await chrome.runtime.sendMessage(message);
    if(!result?.ok) throw new Error(result?.error || result?.message || 'Connection unavailable. Open its course page and try again.');
  } catch(error) {localError=error.message;}
  finally{integrationBusy=false;data=await chrome.storage.local.get(null);render();}
}
async function connectProvider(provider) {
  try {
    const allowed=await chrome.permissions.request({permissions:['scripting'],origins:PROVIDERS[provider].origins.map(origin=>`${origin}/*`)});
    if(!allowed)throw new Error(`${PROVIDERS[provider].label} was not connected. Page access is needed to read assignments.`);
    await runIntegration({type:'PROVIDER_SYNC',provider});
  } catch(error){localError=error.message;render();}
}
function renderConnections() {
  $('connections').replaceChildren();
  for(const provider of EXTERNAL_PROVIDERS) {
    const saved=data.external?.[provider], current=saved?.ownerId===data.accountId;
    const row=node('div','connection');row.append(node('strong','',PROVIDERS[provider].label));
    row.append(node('p','help',current ? `${saved.state==='connected'?'Connected · partial coverage':saved.state.replaceAll('-',' ')}. ${saved.message||''}` : 'Open a signed-in course assignment page, then connect.'));
    const open=node('a','text-button','Open course site ↗');open.href=PROVIDERS[provider].home;open.target='_blank';open.rel='noopener noreferrer';
    const connect=node('button','text-button',current?'Sync open courses':'Connect');connect.type='button';connect.disabled=integrationBusy;connect.addEventListener('click',()=>connectProvider(provider));row.append(open,connect);
    if(current){const disconnect=node('button','text-button','Disconnect');disconnect.disabled=integrationBusy;disconnect.addEventListener('click',()=>runIntegration({type:'PROVIDER_DISCONNECT',provider}));row.append(disconnect);}
    $('connections').append(row);
  }
  if(!$('course-mappings').contains(document.activeElement)) {
    $('course-mappings').replaceChildren();
    for(const [provider,saved] of Object.entries(data.external||{})) {
      if(saved.ownerId!==data.accountId || saved.quarantined)continue;
      for(const course of saved.courses||[]) {
        const label=node('label','mapping',`${PROVIDERS[provider].label}: ${course.code}`),select=node('select');select.setAttribute('aria-label',`Associate ${PROVIDERS[provider].label} ${course.code} with a MyLS course`);
        for(const c of [{id:'',code:'Automatic (course code)'},...(data.courses||[])]) {const opt=node('option','',c.id?courseLabel(c.name,c.code):c.code);opt.value=c.id;select.append(opt);}
        select.value=data.courseMappings?.[course.id]||'';
        select.addEventListener('change',async()=>{try{const {courseMappings={}}=await chrome.storage.local.get('courseMappings');await chrome.storage.local.set({courseMappings:{...courseMappings,[course.id]:select.value}});}catch{localError='Could not save course association.';render();}});
        label.append(select);$('course-mappings').append(label);
      }
    }
  }
}
