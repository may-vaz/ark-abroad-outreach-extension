# LinkedIn Outreach AI — v8

**For Ark Abroad's clients (international students and skilled migrants in Australia): open a profile, pick a goal, and get three good drafts. Insert one, send it yourself, and it's tracked.**

![Drafts](docs/3-free-drafts.png)

## Product structure
Three tabs, each with a single responsibility:

| Tab | Purpose |
|---|---|
| **Compose** | Reads the open profile automatically → goal → format → **Generate drafts** (3 angles) → edit → **Insert into LinkedIn** (never sends) → **Mark as sent** |
| **Contacts** | People you've messaged: status, follow-up dates, a "contacted" indicator on their profile, CSV export |
| **Profile** | The only place for your data: **Upload resume** or **Import from LinkedIn**, editable details, writing preferences (tone, Premium, monthly note limit), optional AI key |

## Competitive review (25 tools)
I reviewed AI outreach extensions on the Chrome Web Store (OutreachAI, LinkedIn Outreach AI, ConnectAI, LinkedIn Outreach Personalizer, ReachDraft, PitchKraft, LinkedReach, Connection Copilot, ConnectNote AI, NoteSend AI, EngageX, Linkovert, LinkedIn Co-Pilot, LinkedIn Copilot, LinkedIn Job Assistant, LinkedIn Connection Helper, JobRefer.ai, HireMe Messenger, FirstLine, Engage AI, LinkedIn Message Manager, LinkNotes, Connection Assistant) and job-search companions (Teal, Careerflow).

| Pattern | Seen in | v7 |
|---|---|---|
| User context set once (CV, bio, or own LinkedIn) | Most | Profile tab: resume or LinkedIn import, editable |
| Goal / purpose selection | Most | 5 goals for job seekers |
| Tone selection | Most | Saved preference in Profile, not a per-message control |
| Note vs message with character limit | Most | Format toggle, auto-selected from connection status, hard limit enforced |
| Several variants per generation (usually 3) | Common | 3 drafts from distinct angles |
| Insert or copy, never auto-send | All reputable ones | Insert into LinkedIn + Copy; never sends |
| Contact tracking, follow-up reminders, "contacted" badge | Common in trackers | Contacts tab |
| BYO API key, local storage | Common | Optional key; templates work without one |
| **Common ground (university, employer, origin, migrant pathway)** | Rare | **Differentiator** |
| **Quality check tuned to the Australian market** | None | **Differentiator** |

## Feature validation log
Every feature had to pass: *Is it common or clearly needed? Does it help Ark's clients get replies? Does it add a control the user must think about?*

| Feature | Decision | Reason |
|---|---|---|
| Separate background setup in Compose | **Removed** (v6 → v7) | Duplicated the Profile tab. One home for user data |
| Shorter / Rewrite / version history | **Removed** | Did nothing visible in template mode, and 3 drafts already give choice |
| Per-message tone dropdown | **Moved** to Profile | Common in competitors, but a set-once preference, not a per-message decision |
| Hooks panel | **Removed** | Power-user control. Common ground and the profile already drive personalisation |
| Every draft saved to the tracker | **Removed** | Noise. Only sent messages are tracked |
| InMail and email formats | **Removed** from the UI | Rare for the target user. Note and Message cover the real cases |
| Monthly note counter | **Kept** (one line) | Free accounts get only a few personalised notes a month, so it's a real constraint |
| Connection-aware default format | **Kept** | Prevents an impossible action (a note to someone you're already connected to) |
| Additional context | **Kept**, collapsed | Common in competitors. Optional |

## Architecture
```
 Side panel (view only: Compose · Contacts · Profile) ── commands ──► background.js (job runner, single writer)
        ▲                                   │  light read on open · deep read before writing
        └──── chrome.storage.onChanged ◄────┤  writeDrafts(): Claude tool-use → coach → ≤1 batched repair → hard limits
                                            │  or free-mode templates (same angles, limits, coach)
                                            ▼
                               content_script.js ── dynamic import ──► lib/linkedin-text.js (pure parser)
                               scroll-and-restore · insert without sending
```
- **The panel is a pure view of storage**, so closing it loses nothing and it follows you from tab to tab.
- **Structured output:** Claude must call `submit_drafts` with exactly 3 `{angle, message, why}`. There's no free-text parsing.
- **Self-correcting, bounded:** the coach's blocking issues for any draft go back in **one batched repair turn** (cost and latency stay bounded). `fitToLimit` then guarantees LinkedIn's character limits.
- **Safety:** scraped profiles and pasted messages are wrapped as untrusted data (prompt-injection defence), and the model may only use facts it was given.
- **Resilient client:** timeouts, one retry on 429/5xx/network only, and readable errors.
- **Privacy:** the resume is parsed on-device with pdf.js and the PDF is never stored. Only Anthropic is contacted, and only with your own key.

## Tests
```
npm install            # dev only: pdfjs-dist, playwright-core
npm test               # 61 unit + pipeline tests
npm run test:e2e       # 32 feature checks in real Chrome with the unpacked extension
```
- **Profile reading:** a text-based parser (no reliance on LinkedIn CSS classes). The name is picked from several candidates and verified against the profile URL. That fixes the stale-name bug, where LinkedIn's in-app navigation changes the URL first and the content and title later, so the previous person's name was read. The reader waits until the page matches the URL, and results from a page the user has already left are discarded.
- **Resume parsing:** 7 resume formats (pipe-separated, company-first blocks, "Title at Company", dates-first rows, right-aligned dates, internships, dash lists) × 3 visual layouts (single column, right-aligned dates, two-column sidebar), rendered to real PDFs and run through the same pdf.js extraction the extension uses. All 21 parse name, employers, education, role, city and country correctly. Column detection and wrapped-line joining are what make sidebars work.
- **E2E (32 checks):** feed page, auto-read, connection status, in-app navigation from one profile to another, resume import (including two-column), auto-save, preferences, Premium limit, API-key errors, common ground, 3 distinct drafts, draft selection, scroll restore, live quality check, format limits, Referral and Reply goals, the Claude path with a forced revision, the tone reaching the prompt, regenerate, insert without sending, mark as sent, the contacted indicator, the note counter, Contacts statuses, due badge, filters, search, CSV export, persistence, and own-profile import and refusal.

## Trade-offs and next steps
- A BYO key lives in the client. For Ark's clients I'd move generation behind Ark's server (licenses, rate limits, versioned prompts) and keep the same client contract.
- Next metric to instrument: acceptance and reply rate per goal and per angle (from the Tracker). That tells us which angle actually works, and can tune the templates and the coach.

## Install
`chrome://extensions` → Developer mode → **Load unpacked** → this folder → click the toolbar icon to open the side panel.
