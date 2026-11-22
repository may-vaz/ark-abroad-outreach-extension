// sidepanel.js: a view only. It renders from chrome.storage and sends commands to the background.
// Flow: set up once (Me) → open a profile (auto-read) → pick a goal → 3 drafts → pick, edit, insert → "I sent it".

import { PLAYBOOKS } from './lib/playbooks.js';
import { getFormat } from './lib/formats.js';
import { reviewMessage } from './lib/coach.js';
import { canonicalProfileUrl, contactKey } from './lib/profile.js';
import { listContacts, isDue, STATUSES, STATUS_LABELS, nextAction, notesThisMonth } from './lib/pipeline.js';
import { parseResume } from './lib/resume-parse.js';

const $ = (id) => document.getElementById(id);
const send = (type, payload) => chrome.runtime.sendMessage({ type, payload });
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const ui = { tabId: null, key: null, goal: 'recruiter', format: 'note', formatTouched: false, job: null, shownStamp: null,
  selected: 0, premium: false, hasKey: false, sender: {}, noteLog: [], noteAllowance: 5, contacts: {} };

async function init() {
  buildControls(); wireTabs(); wireCompose(); wirePipeline(); wireProfile();
  const s = await chrome.storage.local.get(['apiKey', 'sender', 'premium', 'goal', 'noteLog', 'noteAllowance', 'contacts', 'tone']);
  $('tone').value = s.tone || 'warm';
  Object.assign(ui, { premium: !!s.premium, hasKey: !!s.apiKey, sender: s.sender || {}, noteLog: s.noteLog || [], noteAllowance: s.noteAllowance || 5, contacts: s.contacts || {} });
  if (s.goal && PLAYBOOKS[s.goal]) ui.goal = s.goal;
  markGoal(); fillProfileForm(s); renderEngine(); renderMe();
  chrome.tabs.onActivated.addListener(() => syncTab(true));
  chrome.tabs.onUpdated.addListener((id, info) => { if (id !== ui.tabId) return; if (info.url) syncTab(); else if (info.status === 'complete') syncTab(true); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && ui.key && changes[`job:${ui.key}`]) renderJob(changes[`job:${ui.key}`].newValue);
    if (area !== 'local') return;
    if (changes.contacts) { ui.contacts = changes.contacts.newValue || {}; renderPipeline(); renderContacted(); }
    if (changes.apiKey) { ui.hasKey = !!changes.apiKey.newValue; renderEngine(); }
    if (changes.premium) { ui.premium = !!changes.premium.newValue; renderFormat(); liveReview(); }
    if (changes.noteLog) { ui.noteLog = changes.noteLog.newValue || []; renderFormat(); }
    if (changes.sender) { ui.sender = changes.sender.newValue || {}; renderMe(); renderSetupBanner(); }
  });
  // Listeners first, then the first read, so no update is missed.
  renderPipeline();
  await syncTab();
}

const hasProfile = () => !!(ui.sender.name && (ui.sender.universities?.length || ui.sender.pastCompanies?.length || ui.sender.currentRole));
function renderEngine() { $('engine-pill').textContent = ui.hasKey ? 'Claude' : 'Templates'; }
function renderSetupBanner() { show('setup-banner', !hasProfile() && !ui.job?.recipient?.isSelf); }

// ─── Follow the active tab; read the profile automatically ───────────────────
let lastUrl = null, readSeq = 0;
async function syncTab(force) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  ui.tabId = tab?.id ?? null;
  const url = canonicalProfileUrl(tab?.url);
  const changed = url !== lastUrl;
  lastUrl = url;
  ui.key = url ? contactKey({ profileUrl: url }) : null;
  if (changed) {
    ui.formatTouched = false; ui.shownStamp = null; ui.job = null;
    ['recipient', 'own-profile', 'composer', 'progress', 'result', 'error', 'reading'].forEach(id => show(id, false));
  }
  show('not-profile', !ui.key);
  renderSetupBanner();
  if (!ui.key) return;
  if (!changed && !force) return;
  const key = ui.key;
  const cached = (await chrome.storage.session.get(`job:${key}`))[`job:${key}`];
  if (cached?.recipient && changed) renderJob(cached);
  // Always re-read the page (cheap, no scrolling), so the card reflects what is actually on screen.
  const seq = ++readSeq;
  if (!cached?.recipient) show('reading', true);
  const r = await send('ANALYZE', { tabId: ui.tabId });
  if (seq !== readSeq || key !== ui.key) return; // the user moved on; ignore this result
  show('reading', false);
  if (!r?.ok) { if (!cached?.recipient) showError(r?.error); return; }
  const fresh = (await chrome.storage.session.get(`job:${key}`))[`job:${key}`];
  if (fresh) renderJob(fresh);
}

// ─── Controls ─────────────────────────────────────────────────────────────────
function buildControls() {
  for (const [id, pb] of Object.entries(PLAYBOOKS)) {
    const b = el('button', null, pb.label); b.dataset.id = id; b.title = pb.goal;
    b.addEventListener('click', () => { ui.goal = id; ui.formatTouched = false; chrome.storage.local.set({ goal: id }); markGoal(); autoFormat(); liveReview(); });
    $('goal-pills').appendChild(b);
  }
  document.querySelectorAll('#format-toggle button').forEach(b => b.addEventListener('click', () => { ui.format = b.dataset.format; ui.formatTouched = true; renderFormat(); liveReview(); }));
  $('status-filter').add(new Option('All', 'all'));
  $('status-filter').add(new Option('Follow-up due', 'due'));
  STATUSES.filter(s => s !== 'drafted').forEach(s => $('status-filter').add(new Option(STATUS_LABELS[s], s)));
}
function markGoal() {
  document.querySelectorAll('#goal-pills button').forEach(b => b.classList.toggle('active', b.dataset.id === ui.goal));
  show('job-ref-wrap', ui.goal === 'referral');
  show('reply-wrap', ui.goal === 'reply');
}
// LinkedIn only allows a note before you're connected and a message after, so choose for the user.
function autoFormat() {
  if (!ui.formatTouched) {
    const c = ui.job?.recipient?.connection;
    ui.format = (c === 'connected' || ui.goal === 'reply' || ui.goal === 'follow_up') ? 'dm' : 'note';
  }
  renderFormat();
}
function renderFormat() {
  document.querySelectorAll('#format-toggle button').forEach(b => b.classList.toggle('active', b.dataset.format === ui.format));
  const h = $('format-hint'); h.className = 'hint';
  const c = ui.job?.recipient?.connection;
  if (ui.format === 'note') {
    const limit = ui.premium ? 300 : 200;
    if (c === 'connected') { h.textContent = 'Already connected. Use Message instead.'; h.classList.add('warn'); return; }
    if (ui.premium) { h.textContent = `Up to ${limit} characters.`; return; }
    const used = notesThisMonth(ui.noteLog);
    h.textContent = `${limit} characters max · ${used} of ${ui.noteAllowance} personalised notes used this month`;
    if (ui.noteAllowance - used <= 1) h.classList.add('warn');
  } else {
    h.textContent = c === 'not_connected' ? 'Not connected. Messaging requires Premium (InMail) or an open profile.' : 'Recommended: 3–5 sentences.';
    if (c === 'not_connected') h.classList.add('warn');
  }
}

// ─── Compose ──────────────────────────────────────────────────────────────────
function wireCompose() {
  $('reanalyze-btn').addEventListener('click', async () => { show('error', false); const r = await send('ANALYZE', { tabId: ui.tabId, deep: true }); if (!r?.ok) showError(r?.error); });
  $('write-btn').addEventListener('click', write);
  $('regen-btn').addEventListener('click', write);
  $('message').addEventListener('input', liveReview);
  $('copy-btn').addEventListener('click', copy);
  $('insert-btn').addEventListener('click', insert);
  $('sent-btn').addEventListener('click', markSent);
  document.querySelectorAll('[data-goto]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); switchTab(a.dataset.goto); }));
}

async function write() {
  if (!ui.job?.recipient) return;
  if (ui.goal === 'reply' && !$('their-message').value.trim()) return showError('Paste the message you are replying to.');
  show('error', false);
  const res = await send('WRITE', { key: ui.key, tabId: ui.tabId, options: {
    playbookId: ui.goal, formatId: ui.format,
    extra: { jobRef: $('job-ref').value.trim(), note: $('note').value.trim(), theirMessage: ui.goal === 'reply' ? $('their-message').value.trim() : '' }
  } });
  if (!res?.ok) showError(res?.error);
}

function renderJob(job) {
  if (job && ui.key && job.key && job.key !== ui.key) return;
  const hadRecipient = !!ui.job?.recipient;
  ui.job = job || null;
  const stage = job?.stage;
  const busy = ['scraping', 'writing', 'reviewing'].includes(stage);
  const r = job?.recipient;
  show('own-profile', !!r?.isSelf);
  show('recipient', !!r && !r.isSelf);
  show('composer', !!r && !r.isSelf && !busy);
  show('progress', busy);
  show('result', !!job?.result && !busy && !r?.isSelf);
  $('write-btn').textContent = 'Generate drafts';
  $('progress-label').textContent = job?.label || 'Generating…';
  if (stage === 'error') showError(job.error); else show('error', false);
  renderSetupBanner();
  if (r && !r.isSelf) { renderRecipient(job); if (!hadRecipient) autoFormat(); }
  if (job?.result && stage === 'done' && ui.shownStamp !== job.updatedAt && !busy) {
    ui.shownStamp = job.updatedAt; ui.selected = 0;
    if (job.options?.formatId) { ui.format = job.options.formatId; renderFormat(); }
    renderDrafts(); selectDraft(0);
  }
}

const CONN_TEXT = { connected: 'Connected', pending: 'Invitation pending', not_connected: 'Not connected', unknown: 'Connection status unknown' };
function renderRecipient(job) {
  const r = job.recipient;
  $('r-avatar').textContent = (r.firstName || r.name || '?')[0].toUpperCase();
  $('r-name').textContent = r.name;
  $('r-headline').textContent = r.headline || [r.currentTitle, r.currentCompany].filter(Boolean).join(' · ');
  $('conn-dot').className = `dot ${r.connection}`;
  $('conn-text').textContent = CONN_TEXT[r.connection] || CONN_TEXT.unknown;
  const cg = $('cg'); cg.replaceChildren();
  (job.commonGround || []).forEach(c => cg.appendChild(el('span', 'chip', `${c.label}: ${c.value}`)));
  show('cg-wrap', (job.commonGround || []).length > 0);
  renderContacted();
}
function renderContacted() {
  const c = ui.key && ui.contacts[ui.key];
  const on = !!c && c.status !== 'drafted';
  show('contacted', on);
  if (on) $('contacted').textContent = `Contacted ${new Date(c.sentAt || c.updatedAt).toLocaleDateString()} · ${STATUS_LABELS[c.status]} · ${nextAction(c)}`;
  // Already contacted → the sensible default is a follow-up (once per profile, so it never fights the user).
  if (on && ui.autoGoalFor !== ui.key && ui.goal !== 'reply') { ui.autoGoalFor = ui.key; ui.goal = 'follow_up'; markGoal(); autoFormat(); }
}

function renderDrafts() {
  const box = $('drafts'); box.replaceChildren();
  (ui.job.result.drafts || []).forEach((d, i) => {
    const b = el('button', 'draft'); b.setAttribute('role', 'radio');
    const head = el('div', 'draft-head'); head.append(el('span', null, d.label), el('span', null, `${d.message.length} chars · ${d.review.score}`));
    b.append(head, el('div', 'draft-body', d.message));
    b.addEventListener('click', () => selectDraft(i));
    box.appendChild(b);
  });
  const res = ui.job.result;
  show('regen-btn', res.engine === 'claude');
  $('metrics').textContent = res.engine === 'claude' && res.metrics
    ? `Claude · ${(res.metrics.latencyMs / 1000).toFixed(1)}s · ${res.metrics.inputTokens + res.metrics.outputTokens} tokens${res.repaired ? ' · revised after quality check' : ''}`
    : 'Template drafts. Add an API key in Profile for AI-written drafts.';
}
function selectDraft(i) {
  ui.selected = i;
  document.querySelectorAll('.draft').forEach((b, j) => { b.classList.toggle('active', j === i); b.setAttribute('aria-checked', j === i); });
  $('message').value = ui.job.result.drafts[i]?.message || '';
  liveReview();
}

// Re-score on every keystroke, so the user sees the effect of their own edits.
function liveReview() {
  if (!ui.job?.recipient || $('result').classList.contains('hidden')) return;
  const limit = getFormat(ui.format).limit({ premium: ui.premium });
  const text = $('message').value;
  const review = reviewMessage(text, { limit, recipient: ui.job.recipient });
  const pct = Math.min(100, (text.length / limit) * 100);
  $('meter-bar').style.width = pct + '%';
  $('meter-bar').className = 'meter-bar' + (text.length > limit ? ' over' : pct > 90 ? ' warn' : '');
  $('count').textContent = `${text.length} / ${limit} characters`;
  const chip = $('score-chip');
  chip.textContent = `Quality ${review.score}/100`;
  chip.className = 'score-chip' + (review.score < 60 ? ' low' : review.score < 80 ? ' mid' : '');
  const ul = $('issues'); ul.replaceChildren();
  review.issues.forEach(x => ul.appendChild(el('li', x.severity, x.tip)));
  $('insert-btn').disabled = text.length > limit;
}

async function copy() { await navigator.clipboard.writeText($('message').value); flash('copy-btn', 'Copied ✓'); }
async function insert() {
  const res = await send('INSERT', { tabId: ui.tabId, text: $('message').value });
  if (res?.inserted) flash('insert-btn', `Inserted into ${res.where}. Review and send in LinkedIn.`, 3000);
  else { await navigator.clipboard.writeText($('message').value); flash('insert-btn', `Copied. Open ${ui.format === 'note' ? 'Connect › Add a note' : 'Message'} in LinkedIn and paste.`, 3500); }
}
async function markSent() {
  const r = ui.job.recipient;
  await send('CONTACT_UPDATE', { key: ui.key, patch: { status: 'sent', name: r.name, headline: r.headline, company: r.currentCompany, profileUrl: r.profileUrl, sentAt: Date.now(),
    draft: { message: $('message').value, formatId: ui.format, playbookId: ui.goal } } });
  flash('sent-btn', 'Saved to Contacts · follow-up in 5 days', 2600);
}
function flash(id, text, ms = 2200) { const b = $(id); const old = b.textContent; b.textContent = text; setTimeout(() => (b.textContent = old), ms); }
function showError(msg) { $('error').textContent = msg || 'Something went wrong.'; show('error', true); }

// Import from LinkedIn: reads the open tab if it is the user's own profile. One place for all background data.
async function importFromLinkedIn() {
  const say = (t) => ($('import-status').textContent = t);
  if (!ui.key) return say('Open your own LinkedIn profile (linkedin.com/in/your-name), then select Import from LinkedIn.');
  say('Reading profile…');
  const res = await send('ANALYZE', { tabId: ui.tabId, deep: true });
  if (!res?.ok) return say(res?.error || 'Could not read the profile.');
  const job = (await chrome.storage.session.get(`job:${ui.key}`))[`job:${ui.key}`];
  const r = job?.recipient;
  if (!r?.isSelf) return say(`The open profile (${r?.name || 'unknown'}) is not yours. Open your own profile, then import.`);
  const companies = [...new Set([r.currentCompany, ...r.experience.map(e => e.company)].filter(Boolean))];
  const fromLinkedIn = { name: r.name, currentRole: r.currentTitle, universities: r.education, pastCompanies: companies, skills: r.skills, city: (r.location || '').split(',')[0], bio: (r.about || '').slice(0, 300) };
  const merged = { ...ui.sender };
  for (const [k, v] of Object.entries(fromLinkedIn)) if (v && (!Array.isArray(v) || v.length)) merged[k] = v;
  await chrome.storage.local.set({ sender: merged });
  ui.sender = merged; fillProfileForm({ sender: merged }); renderMe(); renderSetupBanner();
  $('edit-details').open = true;
  say('Imported from your LinkedIn profile. Review the details below.');
}

// ─── Tracker ──────────────────────────────────────────────────────────────────
function wirePipeline() {
  $('search').addEventListener('input', renderPipeline);
  $('status-filter').addEventListener('change', renderPipeline);
  $('export-btn').addEventListener('click', async () => {
    const { csv } = await send('EXPORT_CSV');
    const a = el('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `outreach-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  });
}
function renderPipeline() {
  const tracked = Object.fromEntries(Object.entries(ui.contacts).filter(([, c]) => c.status !== 'drafted'));
  const due = Object.values(tracked).filter(c => isDue(c)).length;
  $('due-badge').textContent = due; show('due-badge', due > 0);
  $('due-callout').innerHTML = `<span><strong>${due} follow-up${due === 1 ? '' : 's'} due</strong></span><span aria-hidden="true">›</span>`;
  show('due-callout', due > 0);
  const list = listContacts(tracked, { query: $('search').value, status: $('status-filter').value });
  const root = $('contacts'); root.replaceChildren();
  show('no-contacts', !Object.keys(tracked).length);
  show('export-btn', Object.keys(tracked).length > 0);
  for (const c of list) {
    const card = el('div', 'contact' + (isDue(c) ? ' due' : ''));
    const top = el('div', 'row');
    const a = el('a', 'grow', c.name || 'Unknown');
    if (c.profileUrl) { a.href = c.profileUrl; a.target = '_blank'; }
    const sel = el('select', 'mini'); sel.setAttribute('aria-label', 'Status');
    STATUSES.filter(s => s !== 'drafted').forEach(s => sel.add(new Option(STATUS_LABELS[s], s, false, s === c.status)));
    sel.addEventListener('change', () => send('CONTACT_UPDATE', { key: c.key, patch: { status: sel.value } }));
    top.append(a, sel);
    card.append(top, el('div', 'muted small', c.company || ''), el('div', 'msg', c.drafts?.[0]?.message || ''), el('div', 'next', nextAction(c)));
    root.appendChild(card);
  }
}

// ─── Me ───────────────────────────────────────────────────────────────────────
const FIELDS = ['name', 'targetRole', 'currentRole', 'strengths', 'skills', 'universities', 'pastCompanies', 'homeCountry', 'city', 'bio'];
const LISTS = ['skills', 'universities', 'pastCompanies'];

function fillProfileForm({ apiKey, sender = {}, premium, noteAllowance }) {
  if (apiKey !== undefined) $('api-key').value = apiKey || '';
  if (premium !== undefined) $('premium').checked = !!premium;
  $('note-allowance').value = noteAllowance || ui.noteAllowance;
  FIELDS.forEach(f => { const v = sender[f]; $(`s-${f}`).value = Array.isArray(v) ? v.join(', ') : (v || ''); });
}
function readSender() {
  const s = {};
  FIELDS.forEach(f => { const v = $(`s-${f}`).value.trim(); s[f] = LISTS.includes(f) ? v.split(',').map(x => x.trim()).filter(Boolean) : v; });
  return s;
}
function renderMe() {
  const s = ui.sender;
  show('me-summary', hasProfile());
  $('me-name').textContent = s.name || '';
  $('me-role').textContent = [s.currentRole, s.targetRole && `→ targeting ${s.targetRole}`].filter(Boolean).join(' ');
  const chips = $('me-chips'); chips.replaceChildren();
  [...(s.universities || []), ...(s.pastCompanies || []), s.homeCountry, s.city].filter(Boolean).forEach(t => chips.appendChild(el('span', 'chip', t)));
  if (hasProfile() && !s.targetRole) $('edit-details').open = true;
}

let saveTimer;
function wireProfile() {
  FIELDS.forEach(f => $(`s-${f}`).addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => { ui.sender = readSender(); await chrome.storage.local.set({ sender: ui.sender }); $('save-status').textContent = 'Saved ✓'; }, 400);
  }));
  $('premium').addEventListener('change', () => chrome.storage.local.set({ premium: $('premium').checked }));
  $('note-allowance').addEventListener('change', () => { ui.noteAllowance = Math.max(1, +$('note-allowance').value || 5); chrome.storage.local.set({ noteAllowance: ui.noteAllowance }); renderFormat(); });
  $('api-key').addEventListener('change', () => chrome.storage.local.set({ apiKey: $('api-key').value.trim() }));
  $('test-key-btn').addEventListener('click', async () => {
    const apiKey = $('api-key').value.trim(); if (!apiKey) return;
    $('key-status').textContent = 'Verifying…';
    const res = await send('TEST_KEY', { apiKey });
    if (res?.ok) { await chrome.storage.local.set({ apiKey }); $('key-status').textContent = 'Verified. Drafts will be written by Claude.'; }
    else $('key-status').textContent = `Verification failed: ${res?.error || 'invalid key'}`;
  });
  $('tone').addEventListener('change', () => chrome.storage.local.set({ tone: $('tone').value }));
  const input = $('resume-input');
  input.addEventListener('change', () => { if (input.files[0]) handleResume(input.files[0]); input.value = ''; });
  $('import-linkedin-btn').addEventListener('click', importFromLinkedIn);
}

// pdf.js is loaded only when needed, so the panel opens instantly.
async function readPdf(file) {
  const pdfjs = await import('./vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.min.mjs');
  const { pdfToText } = await import('./lib/pdf-text.js');
  return pdfToText(pdfjs, new Uint8Array(await file.arrayBuffer()));
}

async function handleResume(file) {
  const say = (t) => ($('import-status').textContent = t);
  if (file.type !== 'application/pdf') return say('Select a PDF file.');
  if (file.size > 5 * 1024 * 1024) return say('The file exceeds 5 MB.');
  try {
    say('Reading resume…');
    const text = await readPdf(file);
    if (text.replace(/\s/g, '').length < 100) return say('No text found in this PDF (it may be a scanned image). Enter your details manually below.');
    const local = parseResume(text);
    if (ui.hasKey) say('Refining with Claude…');
    const res = await send('IMPORT_RESUME', { text, localDraft: local });
    const merged = { ...ui.sender };
    for (const [k, v] of Object.entries(res?.profile || local)) if (v && (!Array.isArray(v) || v.length)) merged[k] = v;
    await chrome.storage.local.set({ sender: merged });
    ui.sender = merged; fillProfileForm({ sender: merged }); renderMe(); renderSetupBanner();
    say(`Imported from ${file.name}${res?.engine === 'claude' ? ' (refined by Claude)' : ''}. Review the details below. The file itself is not stored.`);
    $('edit-details').open = true;
  } catch (err) {
    say(`Could not read this PDF (${err.message}). Enter your details manually below.`);
  }
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function wireTabs() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); }
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => { const on = t.dataset.tab === name; t.classList.toggle('active', on); t.setAttribute('aria-selected', on); });
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
}

init();
