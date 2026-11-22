'use strict';
// content_script.js: reads the profile and inserts drafts into LinkedIn. It never clicks Send.
// Parsing lives in lib/linkedin-text.js (a pure, unit-tested module) and works from the page's visible text,
// so it survives LinkedIn renaming its CSS classes.

if (!window.__outreachAI) {
  window.__outreachAI = true;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'SCRAPE') {
      scrape(msg.deep).then(data => sendResponse({ ok: true, data })).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    }
    if (msg.type === 'INSERT') { sendResponse(insertText(msg.text)); return false; }
  });

  async function scrape(deep) {
    if (deep) {
      // Lazy sections (Experience, Skills, Activity) only render once scrolled into view. Restore the user's position afterwards.
      const startY = window.scrollY;
      for (let y = 600; y < Math.min(document.body.scrollHeight, 6000); y += 700) { window.scrollTo(0, y); await wait(220); }
      window.scrollTo({ top: startY, behavior: 'instant' });
    }
    const { parseProfileText } = await import(chrome.runtime.getURL('lib/linkedin-text.js'));
    const read = () => {
      const main = document.querySelector('main') || document.body;
      const buttons = Array.from(main.querySelectorAll('button, a[role="button"], a[href*="/overlay/"]')).slice(0, 80)
        .map(b => (b.getAttribute('aria-label') || b.innerText || '').trim()).filter(Boolean).join(' | ');
      return parseProfileText(main.innerText, { title: document.title, h1: main.querySelector('h1')?.innerText || '', buttons, url: location.href });
    };
    // LinkedIn swaps pages client-side: the URL changes first, the content follows. Wait (up to ~6s) until
    // the page shows the person in the URL, so we never read the previous page.
    let data = read();
    for (let i = 0; i < 24 && data.nameConfidence !== 'high'; i++) { await wait(250); data = read(); }
    return { ...data, pageUrl: location.href };
  }

  // Fill the open invite-note or message box. Never clicks Send.
  function insertText(text) {
    const note = document.querySelector('textarea[name="message"], textarea#custom-message, div[role="dialog"] textarea');
    if (note) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(note, text);
      note.dispatchEvent(new Event('input', { bubbles: true }));
      note.focus();
      return { inserted: true, where: 'invite note' };
    }
    const box = Array.from(document.querySelectorAll('div.msg-form__contenteditable[contenteditable="true"], div[role="textbox"][contenteditable="true"]'))
      .find(b => b.offsetParent !== null);
    if (box) {
      box.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      return { inserted: true, where: 'message box' };
    }
    return { inserted: false };
  }
}
