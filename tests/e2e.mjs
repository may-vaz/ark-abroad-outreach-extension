// End-to-end QA: real Chrome + the unpacked extension, against fixture LinkedIn pages and a mocked Anthropic API.
// Prints a checklist of every feature it verifies.
// Run: npm i -D playwright-core && CHROME=/path/to/chrome node tests/e2e.mjs
import { chromium } from 'playwright-core';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const EXT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fx = (f) => readFileSync(path.join(EXT, 'tests/fixtures', f), 'utf8');
const shot = (page, name, full = true) => page.screenshot({ path: path.join(EXT, 'docs', name), fullPage: full });
const passed = [];
const check = async (label, fn) => { await fn(); passed.push(label); console.log('  ✓', label); };

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'oai-')), {
  executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: false, acceptDownloads: true,
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
  viewport: { width: 380, height: 1000 }
});

// ── Mock Anthropic API ──
const apiLog = [];
const good = "Hi Priya, saw you're hiring 5 data analysts in Sydney. We're both Mumbai Uni alumni, and I built a RAG assistant that cut tickets 35%. Open to a quick chat?";
const drafts = (msgs) => ({ content: [{ type: 'tool_use', id: 't' + apiLog.length, name: 'submit_drafts', input: { drafts: msgs.map((m, i) => ({ angle: ['common', 'their_work', 'direct'][i], message: m, why: 'Reason ' + i })) } }], usage: { input_tokens: 900, output_tokens: 210 } });
let draftCalls = 0;
await ctx.route('https://api.anthropic.com/**', r => {
  const req = r.request(); const body = JSON.parse(req.postData()); const key = req.headers()['x-api-key'];
  apiLog.push(body);
  if (key === 'sk-ant-bad') return r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'invalid x-api-key' } }) });
  if (!body.tools) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: 'OK' }], usage: {} }) });
  if (body.tools[0].name === 'save_profile') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'tool_use', id: 'p', name: 'save_profile', input: { name: 'Maeve Vas', strengths: 'x', universities: ['University of Mumbai'], pastCompanies: ['Infosys'] } }], usage: {} }) });
  draftCalls++;
  const third = "Hi Priya, I'm a Junior AI/ML Engineer in Sydney moving into data analytics. I cut support tickets 35% with a RAG assistant. Open to a chat?";
  const msgs = draftCalls === 1 ? ["Dear Ma'am, I came across your profile and kindly request any job.", good.replace('saw', 'noticed'), third]
    : [good, good.replace('saw', 'noticed'), third].map(m => draftCalls > 2 ? m.replace('quick', 'short') : m);
  return r.fulfill({ contentType: 'application/json', body: JSON.stringify(drafts(msgs)) });
});
await ctx.route('https://www.linkedin.com/in/priya-s/**', r => r.fulfill({ contentType: 'text/html', body: fx('profile.html') }));
await ctx.route('https://www.linkedin.com/in/maeve-vas/**', r => r.fulfill({ contentType: 'text/html', body: fx('self.html') }));
await ctx.route('https://www.linkedin.com/in/shilpa-jha/**', r => r.fulfill({ contentType: 'text/html', body: fx('spa.html') }));
await ctx.route('https://www.linkedin.com/feed/**', r => r.fulfill({ contentType: 'text/html', body: '<html><head><title>Feed | LinkedIn</title></head><body><main><p>Start a post</p></main></body></html>' }));

let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const tab = await ctx.newPage();
await tab.goto('https://www.linkedin.com/feed/');
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.linkedin.com/*' }))[0].id);

const panel = await ctx.newPage();
panel.on('pageerror', e => { console.log('PAGE ERROR:', e.message); process.exitCode = 1; });
await panel.addInitScript(() => {   // the panel's "active tab" = the LinkedIn tab (in real use it sits beside it)
  const orig = chrome.tabs.query.bind(chrome.tabs);
  chrome.tabs.query = async (q) => { const id = +(localStorage.getItem('__tab') || 0); return q.active && id ? [await chrome.tabs.get(id)] : orig(q); };
});
await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
await panel.evaluate(id => localStorage.setItem('__tab', id), tabId);
await panel.reload();
const sender = () => panel.evaluate(async () => (await chrome.storage.local.get('sender')).sender || {});
const tabTo = (t) => panel.click(`[data-tab="${t}"]`);

console.log('\nCompose: reading profiles');
await check('Feed page: shows "No profile open" (does not read the feed as a person)', async () => {
  await panel.waitForSelector('#not-profile:not(.hidden)');
});
await check('Opening a profile reads it automatically (no button), with a clean name (no "(4)")', async () => {
  await tab.goto('https://www.linkedin.com/in/priya-s/?trk=feed');
  await panel.waitForFunction(() => document.querySelector('#r-name')?.textContent === 'Priya Sharma', null, { timeout: 15000 });
});
await check('Connection status detected ("Not connected") and Connection note preselected', async () => {
  assert.match(await panel.textContent('#conn-text'), /Not connected/);
  assert.equal(await panel.getAttribute('#format-toggle [data-format="note"]', 'class'), 'active');
});
await check('LinkedIn in-app navigation: shows the NEW person, not the previous one (stale title/heading ignored)', async () => {
  await tab.goto('https://www.linkedin.com/in/shilpa-jha/');
  await panel.waitForFunction(() => document.querySelector('#r-name')?.textContent === 'Shilpa Jha', null, { timeout: 15000 });
  await tab.click('#go');                     // URL changes now; content after 1.5s; title after 3s
  await panel.waitForFunction(() => document.querySelector('#r-name')?.textContent === 'Ansh Kandari', null, { timeout: 15000 });
  assert.match(await panel.textContent('#r-headline'), /^IT Support Executive/);
  await panel.waitForTimeout(3500);           // after the title finally changes, still correct
  assert.equal(await panel.textContent('#r-name'), 'Ansh Kandari');
  await shot(panel, '1-spa-navigation.png', false);
});
await check('Setup banner shown while Profile is empty', async () => { assert.ok(await panel.isVisible('#setup-banner')); });

console.log('\nProfile');
await check('Banner opens Profile; resume PDF parsed on-device (0 API calls)', async () => {
  await tab.goto('https://www.linkedin.com/in/priya-s/');
  await panel.click('#setup-banner');
  await panel.setInputFiles('#resume-input', path.join(EXT, 'tests/fixtures/resume.pdf'));
  await panel.waitForFunction(() => /Imported from resume.pdf/.test(document.querySelector('#import-status').textContent));
  const s = await sender();
  assert.equal(s.name, 'Maeve Vas'); assert.deepEqual(s.pastCompanies, ['The Unmarketing Agency', 'Infosys']); assert.deepEqual(s.universities, ['University of Mumbai']);
  assert.equal(apiLog.length, 0);
});
await check('Two-column resume PDF parsed correctly (employers and education)', async () => {
  await panel.setInputFiles('#resume-input', path.join(EXT, 'tests/fixtures/resume-pdfs/b-company-first.two-column.pdf'));
  await panel.waitForFunction(() => /Imported from b-company-first/.test(document.querySelector('#import-status').textContent));
  const s = await sender();
  assert.deepEqual(s.pastCompanies, ['Deloitte', 'Tata Consultancy Services']); assert.deepEqual(s.universities, ['Monash University', 'University of Mumbai']);
  // restore Maeve's resume for the rest of the run
  await panel.setInputFiles('#resume-input', path.join(EXT, 'tests/fixtures/resume.pdf'));
  await panel.waitForFunction(() => /Imported from resume.pdf/.test(document.querySelector('#import-status').textContent));
});
await check('Manual edits save automatically and survive a panel reload', async () => {
  await panel.fill('#s-targetRole', 'Data Analyst'); await panel.waitForTimeout(700);
  await panel.reload(); await tabTo('profile');
  assert.equal(await panel.inputValue('#s-targetRole'), 'Data Analyst');
  await shot(panel, '2-profile.png');
});
await check('Writing preferences persist (tone, Premium, monthly note limit)', async () => {
  await panel.selectOption('#tone', 'direct'); await panel.check('#premium'); await panel.fill('#note-allowance', '8'); await panel.press('#note-allowance', 'Tab');
  await panel.waitForTimeout(300);
  const st = await panel.evaluate(() => chrome.storage.local.get(['tone', 'premium', 'noteAllowance']));
  assert.deepEqual([st.tone, st.premium, st.noteAllowance], ['direct', true, 8]);
});
await check('Premium raises the connection-note limit to 300', async () => {
  await tabTo('compose');
  await panel.waitForFunction(() => /300 characters/.test(document.querySelector('#format-hint').textContent));
  await panel.evaluate(() => chrome.storage.local.set({ premium: false, noteAllowance: 5 }));
  await panel.waitForFunction(() => /200 characters/.test(document.querySelector('#format-hint').textContent));
});
await check('API key: invalid key shows a clear error; valid key is verified and enables Claude', async () => {
  await tabTo('profile');
  await panel.fill('#api-key', 'sk-ant-bad'); await panel.click('#test-key-btn');
  await panel.waitForFunction(() => /Verification failed: Your API key was rejected/.test(document.querySelector('#key-status').textContent));
  await panel.fill('#api-key', ''); await panel.press('#api-key', 'Tab');
  await panel.evaluate(() => chrome.storage.local.set({ apiKey: '' }));
});

console.log('\nCompose: drafts (template mode)');
await tabTo('compose');
await check('Common ground shown after setup (same university, same employer)', async () => {
  await panel.click('#reanalyze-btn');
  await panel.waitForFunction(() => [...document.querySelectorAll('#cg .chip')].map(e => e.textContent).includes('Same university: University of Mumbai'));
});
await check('Generate drafts → 3 distinct drafts, all within the limit', async () => {
  await panel.click('#write-btn');
  await panel.waitForSelector('#result:not(.hidden)');
  const d = await panel.$$eval('.draft .draft-body', els => els.map(e => e.textContent));
  assert.equal(new Set(d).size, 3); d.forEach(x => assert.ok(x.length <= 200, x));
  await shot(panel, '3-drafts.png');
});
await check('Selecting a draft loads it into the editor', async () => {
  const first = await panel.inputValue('#message');
  await panel.click('.draft:nth-child(2)');
  assert.notEqual(await panel.inputValue('#message'), first);
});
await check('Writing does not move the LinkedIn page (scroll position restored)', async () => {
  await tab.evaluate(() => window.scrollTo(0, 300));
  await panel.click('#write-btn'); await panel.waitForSelector('#result:not(.hidden)');
  assert.equal(await tab.evaluate(() => window.scrollY), 300);
});
await check('Quality check updates live; Insert disabled when over the limit', async () => {
  await panel.fill('#message', 'Dear Sir, kindly consider me for any job. ' + 'x'.repeat(200));
  assert.ok(await panel.isDisabled('#insert-btn'));
  const issues = await panel.$$eval('#issues li', els => els.map(e => e.textContent).join(' '));
  assert.match(issues, /LinkedIn will reject/); assert.match(issues, /stiff/);
  await panel.click('.draft:nth-child(1)');
  assert.ok(!(await panel.isDisabled('#insert-btn')));
});
await check('Message format: limit switches to 1,000 characters', async () => {
  await panel.click('#format-toggle [data-format="dm"]');
  assert.match(await panel.textContent('#count'), /\/ 1000/);
  await panel.click('#format-toggle [data-format="note"]');
});
await check('Referral goal shows the Role field and uses it in drafts', async () => {
  await panel.click('#goal-pills [data-id="referral"]');
  assert.ok(await panel.isVisible('#job-ref'));
  await panel.fill('#job-ref', 'Data Analyst (Job 4821)');
  await panel.click('#write-btn'); await panel.waitForSelector('#result:not(.hidden)');
  const d = await panel.$$eval('.draft .draft-body', els => els.map(e => e.textContent).join(' '));
  assert.match(d, /Job 4821/); assert.match(d, /referring me/);
});
await check('Reply goal requires the received message, then drafts a reply', async () => {
  await panel.click('#goal-pills [data-id="reply"]');
  await panel.click('#write-btn');
  assert.match(await panel.textContent('#error'), /Paste the message/);
  assert.equal(await panel.getAttribute('#format-toggle [data-format="dm"]', 'class'), 'active', 'reply defaults to Message');
  await panel.fill('#their-message', 'Hi Maeve, are you open to analyst roles at Atlassian?');
  await panel.click('#write-btn'); await panel.waitForFunction(() => document.querySelector('.draft .draft-body')?.textContent.includes('Thanks for reaching out'));
  await panel.click('#goal-pills [data-id="recruiter"]');
  assert.equal(await panel.getAttribute('#format-toggle [data-format="note"]', 'class'), 'active', 'recruiter (not connected) defaults back to note');
});

console.log('\nCompose: drafts (Claude mode)');
await check('One Claude call returns 3 drafts; quality check forces one batched revision; all within limit', async () => {
  await panel.evaluate(() => chrome.storage.local.set({ apiKey: 'sk-ant-good' }));
  await panel.click('#write-btn');
  await panel.waitForFunction(() => /Claude/.test(document.querySelector('#metrics').textContent));
  assert.equal(draftCalls, 2);
  const d = await panel.$$eval('.draft .draft-body', els => els.map(e => e.textContent));
  d.forEach(x => assert.ok(x.length <= 200)); assert.ok(!d.some(x => /kindly/.test(x)));
  assert.match(await panel.textContent('#metrics'), /revised after quality check/);
});
await check('Tone preference and profile reach the prompt; scraped data is marked untrusted', async () => {
  const req = apiLog.filter(b => b.tools?.[0]?.name === 'submit_drafts')[0];
  assert.match(req.messages[0].content, /Tone: Concise/); assert.match(req.messages[0].content, /University of Mumbai/);
  assert.match(req.system, /untrusted DATA/);
});
await check('Regenerate (Claude mode only) produces new drafts', async () => {
  assert.ok(await panel.isVisible('#regen-btn'));
  const before = await panel.$$eval('.draft .draft-body', els => els.map(e => e.textContent).join('|'));
  await panel.click('#regen-btn');
  await panel.waitForFunction((b) => [...document.querySelectorAll('.draft .draft-body')].map(e => e.textContent).join('|') !== b, before);
  await shot(panel, '4-claude-drafts.png');
});

console.log('\nSending and Contacts');
await check('Insert into LinkedIn fills the open message box and does not send', async () => {
  const text = await panel.inputValue('#message');
  await panel.click('#insert-btn');
  assert.equal((await tab.textContent('.msg-form__contenteditable')).trim(), text);
});
await check('Mark as sent → "contacted" indicator, note counted, next visit defaults to Follow-up', async () => {
  await panel.click('#sent-btn');
  await panel.waitForSelector('#contacted:not(.hidden)');
  await panel.waitForFunction(async () => ((await chrome.storage.local.get('noteLog')).noteLog || []).length === 1);
  assert.equal(await panel.getAttribute('#goal-pills [data-id="follow_up"]', 'class'), 'active');
});
await check('Contacts lists the person with a follow-up date', async () => {
  await tabTo('contacts'); await panel.waitForSelector('.contact');
  assert.match(await panel.textContent('.contact .next'), /Follow up on/);
});
await check('Status → Accepted makes "Send first message" due; badge and "Follow-up due" filter work', async () => {
  await panel.selectOption('.contact select', 'accepted');
  await panel.waitForFunction(() => document.querySelector('.contact .next')?.textContent === 'Send first message');
  await panel.waitForSelector('#due-badge:not(.hidden)');
  await panel.selectOption('#status-filter', 'due'); assert.equal(await panel.$$eval('.contact', e => e.length), 1);
  await panel.selectOption('#status-filter', 'replied'); assert.equal(await panel.$$eval('.contact', e => e.length), 0);
  await panel.selectOption('#status-filter', 'all');
  await shot(panel, '5-contacts.png', false);
});
await check('Search filters contacts', async () => {
  await panel.fill('#search', 'zzz'); assert.equal(await panel.$$eval('.contact', e => e.length), 0);
  await panel.fill('#search', 'atlassian'); assert.equal(await panel.$$eval('.contact', e => e.length), 1);
  await panel.fill('#search', '');
});
await check('Export CSV downloads a file with the contact', async () => {
  const [dl] = await Promise.all([panel.waitForEvent('download'), panel.click('#export-btn')]);
  const csv = readFileSync(await dl.path(), 'utf8');
  assert.match(csv, /^name,company/); assert.match(csv, /Priya Sharma/);
});
await check('State survives closing and reopening the panel', async () => {
  await panel.reload(); await panel.waitForSelector('#result:not(.hidden)');
});

console.log('\nOwn profile');
await check('Own profile: Compose says so and does not offer drafts', async () => {
  await tab.goto('https://www.linkedin.com/in/maeve-vas/');
  await panel.waitForSelector('#own-profile:not(.hidden)', { timeout: 15000 });
  assert.ok(!(await panel.isVisible('#composer')));
});
await check('Import from LinkedIn (in Profile) imports it and keeps fields the user typed', async () => {
  await panel.click('#own-profile [data-goto="profile"]');
  await panel.evaluate(() => chrome.storage.local.set({ apiKey: '' }));
  await panel.click('#import-linkedin-btn');
  await panel.waitForFunction(() => /Imported from your LinkedIn profile/.test(document.querySelector('#import-status').textContent));
  const s = await sender();
  assert.equal(s.currentRole, 'Junior AI/ML Engineer'); assert.equal(s.targetRole, 'Data Analyst');
});
await check("Import from LinkedIn refuses someone else's profile", async () => {
  await tab.goto('https://www.linkedin.com/in/priya-s/');
  await tabTo('compose'); await panel.waitForFunction(() => document.querySelector('#r-name')?.textContent === 'Priya Sharma', null, { timeout: 15000 });
  await tabTo('profile'); await panel.click('#import-linkedin-btn');
  await panel.waitForFunction(() => /is not yours/.test(document.querySelector('#import-status').textContent));
});

console.log(`\nE2E PASSED: ${passed.length} checks`);
await ctx.close();
