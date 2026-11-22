// Parses a LinkedIn profile from the page's visible TEXT, not its CSS classes.
// LinkedIn renames classes often and the original scraper broke on that. The visible text
// (name, headline, "Experience", "Education"…) changes far less. Pure function, unit-tested.

const SECTION_TITLES = ['About', 'Featured', 'Activity', 'Experience', 'Education', 'Licenses & certifications', 'Skills',
  'Projects', 'Volunteering', 'Volunteer experience', 'Honors & awards', 'Languages', 'Recommendations', 'Interests',
  'Courses', 'Publications', 'Organizations', 'Causes', 'People also viewed', 'People you may know', 'More profiles for you', 'Explore Premium profiles'];
const DATE = /\b(19|20)\d{2}\b|\bpresent\b|\b\d+\s*(yrs?|mos?)\b/i;
const NOISE = /^(see more|…see more|show all.*|show more|show less|follow|message|connect|more|pending|contact info|endorse|\d+ endorsements?|·|--|edit|open to|add profile section|enhance profile|resources|visit my website)$/i;
const EDU = /\b(university|college|institute|school|academy|polytechnic|tafe|iit|nit)\b/i;

// "(4) Maeve V. | LinkedIn" → "Maeve V."  (strips the notification count LinkedIn puts in the title)
export function nameFromTitle(title) {
  return String(title || '').replace(/^\(\d+\+?\)\s*/, '').split('|')[0].replace(/\s+/g, ' ').trim();
}

export function cleanLines(text) {
  const raw = String(text || '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // LinkedIn renders many strings twice (visible + screen-reader copy), so drop consecutive duplicates.
  return raw.filter((l, i) => l !== raw[i - 1]);
}

const NOT_NAMES = /^(feed|linkedin|home|notifications?|messaging|jobs|my network|search|people|premium|sign in|join|about|experience|activity)$/i;
export function isPlausibleName(n) {
  n = String(n || '').trim();
  return n.length >= 2 && n.length <= 60 && !/\d|@|\|/.test(n) && !NOT_NAMES.test(n) && /^[\p{L}][\p{L} .,'’-]*$/u.test(n);
}
// Tokens from the profile URL slug: /in/ansh-kandari-33b2a5270/ → ['ansh','kandari']
export function slugTokens(url) {
  const m = String(url || '').match(/\/in\/([^/?#]+)/);
  if (!m) return [];
  return decodeURIComponent(m[1]).toLowerCase().split(/[-_.]+/).filter(t => t.length > 1 && !/\d/.test(t));
}
const PRONOUN = /^(he|she|they|ze|xe)\/(him|her|them|his|hers|theirs|hir)/i;
const DEGREE = /(^|\s|·)\s*(1st|2nd|3rd\+?)\b/;

// The name is chosen from several candidates and checked against the URL slug, because during LinkedIn's
// client-side navigation the <title> (and sometimes <h1>) still belong to the PREVIOUS page for a moment.
export function pickName(lines, { title = '', h1 = '', url = '' } = {}) {
  const slug = slugTokens(url);
  const cands = [];
  const push = (name, source, base) => {
    name = String(name || '').replace(/^\(\d+\+?\)\s*/, '').replace(/\s+/g, ' ').trim();
    if (!isPlausibleName(name)) return;
    const toks = name.toLowerCase().split(/[\s.'’-]+/).filter(Boolean);
    const slugHit = slug.length && toks.some(t => t.length > 1 && slug.some(s => s === t || s.startsWith(t) || t.startsWith(s)));
    cands.push({ name, source, score: base + (slugHit ? 5 : 0), slugHit: !!slugHit });
  };
  push(h1, 'h1', 2);
  lines.slice(0, 60).forEach((l, i) => {
    const next = lines.slice(i + 1, i + 4).join(' | ');
    if (PRONOUN.test(next) || DEGREE.test(next) || /^verified/i.test(lines[i + 1] || '') || DEGREE.test(l.replace(/^.*?(·\s*(1st|2nd|3rd\+?))\s*$/, ' $1'))) push(l.replace(/\s*·?\s*(1st|2nd|3rd\+?)\s*$/, ''), 'layout', 3);
  });
  push(nameFromTitle(title), 'title', 1);
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  if (!best) return { name: '', confidence: 'none' };
  const confidence = best.slugHit ? 'high' : best.source === 'title' ? 'low' : (slug.length ? 'medium' : 'high');
  return { name: best.name, confidence, source: best.source };
}

export function parseProfileText(text, { title = '', h1 = '', buttons = '', url = '' } = {}) {
  const lines = cleanLines(text);
  const picked = pickName(lines, { title, h1, url });
  const name = picked.name;
  let start = name ? lines.findIndex(l => l === name || l.startsWith(name)) : -1;
  if (start < 0) start = 0;

  // Header block: the lines after the name, before the first section heading
  const firstSection = lines.findIndex((l, i) => i > start && SECTION_TITLES.includes(l));
  const header = lines.slice(start + 1, firstSection > 0 ? Math.min(firstSection, start + 14) : start + 14)
    .map(l => l.replace(/\s*·\s*contact info$/i, '').trim())
    .filter(l => l && !NOISE.test(l) && !PRONOUN.test(l) && !/^·?\s*(1st|2nd|3rd\+?)$/i.test(l) && !/^verified/i.test(l) && !/mutual connections?/i.test(l));
  const headline = header.find(l => l.length > 6 && !/connections?$|followers?$/i.test(l) && l !== name) || '';
  const location = header.find(l => l !== headline && l.length < 70 && (/^[A-Za-zÀ-ÿ .'-]+(,\s*[A-Za-zÀ-ÿ .'-]+){1,2}$/.test(l) || /^(greater )?[A-Za-zÀ-ÿ .'-]+ (area|region|metropolitan area)$/i.test(l))) || '';

  const sec = (t) => {
    const i = lines.indexOf(t);
    if (i < 0) return [];
    const end = lines.findIndex((l, j) => j > i && SECTION_TITLES.includes(l));
    return lines.slice(i + 1, end > 0 ? end : i + 40).filter(l => !NOISE.test(l));
  };

  const about = sec('About').join(' ').replace(/…?\s*see more$/i, '').slice(0, 1200);

  const exp = sec('Experience');
  const experience = [];
  exp.forEach((l, i) => {
    if (!DATE.test(l) || i === 0) return;
    // Common layout: Title / Company · Full-time / Dates / Location
    const prev = exp[i - 1], prev2 = exp[i - 2];
    const companyLine = prev && !DATE.test(prev) ? prev : '';
    const company = companyLine.split('·')[0].trim();
    const title = prev2 && !DATE.test(prev2) ? prev2 : company;
    if (title && !experience.some(e => e.title === title && e.company === company)) experience.push({ title, company: company === title ? '' : company, dates: l });
  });

  const education = sec('Education').filter(l => EDU.test(l) && !DATE.test(l) && l.length < 100).slice(0, 4);
  const skills = sec('Skills').filter(l => l.length < 50 && !/endorse|passed|assessment|experiences? (at|across)/i.test(l) && !DATE.test(l)).slice(0, 12);
  const recentPosts = sec('Activity').filter(l => l.length > 60 && l.length < 700 && !/followers|reposted|commented|liked|posted this/i.test(l)).slice(0, 3);

  const current = experience[0] || {};
  const fromHeadline = headline.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s*[|·,].*)?$/i);
  const topText = lines.slice(start, start + 14).join(' | ');
  const b = buttons || '';
  const connection = /\b1st\b/.test(topText) ? 'connected'
    : /\bpending\b/i.test(b) ? 'pending'
    : /\b(2nd|3rd\+?)\b/.test(topText) ? 'not_connected'
    : /invite .* to connect|\bconnect\b/i.test(b) ? 'not_connected'
    : /\bmessage\b/i.test(b) ? 'connected' : 'unknown';
  const isSelf = /\b(add profile section|enhance profile|open to work|edit intro)\b/i.test(b + ' | ' + topText);

  return {
    name, nameConfidence: picked.confidence, headline, location, about, experience: experience.slice(0, 6), education, skills, recentPosts, connection, isSelf,
    currentTitle: current.title || (fromHeadline ? fromHeadline[1].trim() : ''),
    currentCompany: current.company || (fromHeadline ? fromHeadline[2].trim() : '')
  };
}
