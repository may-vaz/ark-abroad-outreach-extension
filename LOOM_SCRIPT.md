# Loom script (about 6 minutes)

**Before recording:** load v7, then in **Profile** upload your resume or use **Import from LinkedIn** while your own profile is open, and open a real Australian recruiter's profile, ideally someone you share a university or employer with. Have VS Code open on the repo.

---

**0:00 – Who it's for (30s)**
"Ark Abroad helps migrants in Australia move from survival jobs into corporate roles, and outreach is the hardest part of that. Most people send generic, overly formal, overly long messages, or nothing at all. So I didn't add features. I made the core loop work really well."

**0:30 – What was broken (45s)**: show the "Failed to load extension" popup
"As shipped, it doesn't load: the icons and `utils/cache.js` are missing. Deep Mode claims 'OpenAI web enrichment' but it's a regex and a delay. The parser only knows Indian cities, while Ark's users message Australian profiles. It ignores LinkedIn's character limits, never uses the resume, and loses everything when the popup closes."

**1:15 – How I decided what to build (30s)**
"I reviewed 25 comparable tools. The common pattern is: set your context once, open a profile, pick a goal, get three drafts, insert, and track contacts. I built exactly that, kept tone as a saved preference, and added two things almost none of them have: common ground detection and a quality check tuned to Australian employers. The README has the comparison and a log of every feature I cut and why."

**1:45 – Demo (2.5 min)**
1. **Profile:** "All my data lives in one tab. I upload my resume, which is parsed on the device with no API key needed, or import my own LinkedIn profile. Tone and my monthly note limit are set here once."
2. **Open the recruiter's profile:** "It reads automatically, no button. Not connected, so it picks a connection note, and it shows my monthly note budget because free accounts only get a few. The green stars are what we have in common. LinkedIn's own data says a shared employer lifts replies by 27%."
3. Pick **Recruiter** → **Generate drafts**. "Three genuinely different angles: shared background, their work, straight to the point. I pick one and edit it, and the coach re-scores live." Type "Dear Sir, kindly…" to show it flag the stiff phrasing and the length.
4. **Insert into LinkedIn** (in the Connect → Add a note box): "It fills the box but never sends. I stay in control." → **Mark as sent**.
5. "Now this person shows a 'contacted' badge, so I never message them twice. A follow-up is scheduled in Contacts, and next time it defaults to Follow-up."

**4:15 – How it's built (1.5 min)**: README diagram, then code
- `lib/linkedin-text.js`: "LinkedIn changes its CSS classes constantly, so I parse the visible text instead. It even strips the '(4)' notification count from the page title, which was a real bug I hit."
- `lib/writer.js`: "Claude must return exactly three drafts through a tool schema. The coach reviews them, any problems go back in one batched repair turn, and then hard limits are enforced in code."
- "The panel is just a view of storage. The background is the only writer, so closing the panel loses nothing."
- Run `npm test` on screen. "There's also an end-to-end test in real Chrome that caught two bugs before I shipped."

**5:45 – Next (15s)**
"Next, I'd move generation behind Ark's server and measure reply rate per goal and per angle, so we learn which messages actually get Ark's clients hired. Thanks!"
