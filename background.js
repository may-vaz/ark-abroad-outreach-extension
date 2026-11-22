// background.js: the job runner and the only code that writes job state.
// The UI is a pure view over chrome.storage. Runs keep going if the panel is closed,
// and reopening the panel shows exactly where the run stands.

import { normalizeProfile, contactKey, canonicalProfileUrl, findCommonGround, buildHooks } from './lib/profile.js';
import { writeDrafts } from './lib/writer.js';
import { refineWithClaude } from './lib/resume.js';
import { callClaude } from './lib/llm.js';
import { upsertContact, toCSV, logNote } from './lib/pipeline.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// ─── State helpers (writes are serialised to avoid lost updates) ─────────────
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

const getLocal = (keys) => chrome.storage.local.get(keys);
async function setJob(key, patch) {
  return serial(async () => {
    const id = `job:${key}`;
    const cur = (await chrome.storage.session.get(id))[id] || {};
    await chrome.storage.session.set({ [id]: { ...cur, ...patch, key, updatedAt: Date.now() } });
  });
}
async function getJob(key) { const id = `job:${key}`; return (await chrome.storage.session.get(id))[id]; }
async function patchContacts(fn) {
  return serial(async () => {
    const { contacts = {} } = await getLocal('contacts');
    await chrome.storage.local.set({ contacts: fn(contacts) });
  });
}

// ─── Router ──────────────────────────────────────────────────────────────────
const handlers = {
  ANALYZE: analyze,
  WRITE: write,
  INSERT: insert,
  TEST_KEY: testKey,
  IMPORT_RESUME: importResume,
  CONTACT_UPDATE: contactUpdate,
  CONTACT_DELETE: ({ key }) => patchContacts(c => { const n = { ...c }; delete n[key]; return n; }).then(() => ({ ok: true })),
  EXPORT_CSV: async () => ({ csv: toCSV((await getLocal('contacts')).contacts || {}) })
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  Promise.resolve(h(msg.payload || {}))
    .then(r => sendResponse({ ok: true, ...r }))
    .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
  return true;
});

// ─── Stage 1: scrape → normalise → common ground → hooks ─────────────────────
async function analyze({ tabId, deep = false }) {
  const tab = await chrome.tabs.get(tabId);
  const profileUrl = canonicalProfileUrl(tab.url);
  if (!profileUrl) throw new Error('Open a LinkedIn profile (linkedin.com/in/…) first.');
  const key = contactKey({ profileUrl });
  await setJob(key, { stage: deep ? 'scraping' : 'reading', label: 'Reading profile', error: null });
  try {
    const raw = await scrapeTab(tabId, deep);
    // Discard a read that belongs to a different page (the user navigated mid-read).
    if (raw.pageUrl && canonicalProfileUrl(raw.pageUrl) !== profileUrl) throw new Error('The page changed while reading. Try again.');
    if (!raw.name) throw new Error('Could not find the name on this profile. Wait for the page to load, then refresh.');
    const recipient = normalizeProfile({ ...raw, profileUrl });
    const { sender = {} } = await getLocal('sender');
    const commonGround = findCommonGround(sender, recipient);
    const hooks = buildHooks(recipient, commonGround);
    const prev = await getJob(key);
    await setJob(key, { stage: prev?.result ? 'done' : 'analyzed', label: 'Ready', recipient, commonGround, hooks });
    return { key };
  } catch (err) {
    await setJob(key, { stage: 'error', error: err.message });
    throw err;
  }
}

async function scrapeTab(tabId, deep = false) {
  const ask = () => chrome.tabs.sendMessage(tabId, { type: 'SCRAPE', deep });
  let res;
  try { res = await ask(); } catch {
    // The content script is missing (the tab was open before install/update), so inject it and retry once.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content_script.js'] });
    res = await ask();
  }
  if (!res?.ok) throw new Error(res?.error || 'Scrape failed.');
  return res.data;
}

// ─── Stage 2: full read (lazy sections) → 3 drafts → coach ───────────────────
// Drafts are NOT added to the pipeline. Only messages the user says they sent are tracked, so the list stays meaningful.
async function write({ key, tabId, options }) {
  await analyze({ tabId, deep: true });
  const job = await getJob(key);
  if (!job?.recipient) throw new Error('Could not read this profile.');
  const { apiKey = '', sender = {}, premium = false, tone = 'warm' } = await getLocal(['apiKey', 'sender', 'premium', 'tone']);
  await setJob(key, { stage: 'writing', label: 'Writing', error: null, options });
  try {
    const result = await writeDrafts(
      { recipient: job.recipient, sender, hooks: job.hooks, playbookId: options.playbookId, formatId: options.formatId, tone, settings: { premium }, extra: options.extra },
      { apiKey, onStage: (stage, label) => setJob(key, { stage, label }) }
    );
    await setJob(key, { stage: 'done', label: 'Done', result, selected: 0 });
    return { key };
  } catch (err) {
    await setJob(key, { stage: 'error', error: err.message });
    throw err;
  }
}

async function insert({ tabId, text }) {
  const res = await chrome.tabs.sendMessage(tabId, { type: 'INSERT', text }).catch(() => null);
  return { inserted: !!res?.inserted, where: res?.where || null };
}

async function testKey({ apiKey }) {
  await callClaude({ apiKey, maxTokens: 5, retries: 0, messages: [{ role: 'user', content: 'Reply OK' }] });
  return { valid: true };
}

async function importResume({ text, localDraft }) {
  const { apiKey } = await getLocal('apiKey');
  if (!apiKey) return { profile: localDraft, engine: 'local' };
  try {
    return { profile: await refineWithClaude({ apiKey, text, localDraft }), engine: 'claude' };
  } catch {
    return { profile: localDraft, engine: 'local' }; // If the network or the key fails, the local parse is still useful
  }
}

// Sending a connection note uses up one of the free account's limited monthly notes, so log it.
async function contactUpdate({ key, patch }) {
  await patchContacts(c => upsertContact(c, key, patch));
  if (patch.status === 'sent' && patch.draft?.formatId === 'note') {
    await serial(async () => {
      const { noteLog = [] } = await getLocal('noteLog');
      await chrome.storage.local.set({ noteLog: logNote(noteLog) });
    });
  }
  return { ok: true };
}
