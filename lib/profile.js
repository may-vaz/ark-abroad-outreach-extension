// Normalising profiles, finding common ground and ranking hooks. Pure functions, unit-tested.

const str = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const arr = (v) => (Array.isArray(v) ? v.map(x => (typeof x === 'string' ? str(x) : x)).filter(Boolean) : []);

export function normalizeProfile(raw = {}) {
  const name = str(raw.name);
  return {
    name,
    firstName: name.split(' ')[0] || 'there',
    headline: str(raw.headline),
    currentTitle: str(raw.currentTitle),
    currentCompany: str(raw.currentCompany),
    location: str(raw.location),
    about: str(raw.about).slice(0, 1200),
    recentPosts: arr(raw.recentPosts).slice(0, 3),
    experience: arr(raw.experience || raw.experienceEntries).slice(0, 6),
    education: arr(raw.education || raw.educationEntries).map(e => (typeof e === 'string' ? e : str(e.school || e.name))).slice(0, 4),
    skills: arr(raw.skills).slice(0, 12),
    profileUrl: str(raw.profileUrl).split('?')[0],
    isSelf: !!raw.isSelf,
    nameConfidence: raw.nameConfidence || 'high',
    connection: ['connected', 'pending', 'not_connected'].includes(raw.connection) ? raw.connection : 'unknown'
  };
}

// Contacts are keyed by URL. Falling back to name+company stops two contacts with no URL
// from overwriting each other.
export function contactKey(p) {
  if (p.profileUrl) return p.profileUrl.toLowerCase().replace(/\/$/, '');
  return `anon:${(p.name || 'unknown').toLowerCase()}|${(p.currentCompany || '').toLowerCase()}`;
}

const STOP = new Set(['university', 'of', 'the', 'institute', 'college', 'school', 'technology', 'and', 'pty', 'ltd', 'limited', 'inc', 'group']);
function tokens(s) {
  return str(s).toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2 && !STOP.has(t));
}
function overlaps(a, b) {
  const ta = tokens(a); const tb = new Set(tokens(b));
  if (!ta.length || !tb.size) return false;
  const hit = ta.filter(t => tb.has(t)).length;
  return hit / ta.length >= 0.6;
}
function city(loc) { return str(loc).split(',')[0].toLowerCase().replace(/greater|area|metropolitan/g, '').trim(); }

// Common ground between the sender and the recipient. For migrants this is usually the
// strongest hook: same university, same home country, or the same past employer.
export function findCommonGround(sender = {}, p) {
  const found = [];
  const add = (type, label, value, strength) => { if (!found.some(f => f.type === type && f.value === value)) found.push({ type, label, value, strength }); };
  const recipientText = [p.headline, p.about, ...p.education, ...p.experience.map(e => (typeof e === 'string' ? e : `${e.title} ${e.company} ${e.location || ''}`))].join(' ').toLowerCase();

  for (const uni of arr(sender.universities)) if (p.education.some(e => overlaps(uni, e))) add('alma_mater', 'Same university', uni, 3);
  for (const co of arr(sender.pastCompanies)) {
    const all = [p.currentCompany, ...p.experience.map(e => (typeof e === 'string' ? e : e.company))];
    if (all.some(c => c && overlaps(co, c))) add('company', 'Same employer', co, 3);
  }
  const home = str(sender.homeCountry);
  if (home.length > 2 && recipientText.includes(home.toLowerCase())) add('home_country', 'Shared origin', home, 2);
  if (/\b(migrant|migrated|moved to australia|international student|relocated)\b/.test(recipientText)) add('migrant_path', 'Migrant pathway', 'International student / migrant', 2);
  if (sender.city && p.location && city(sender.city) && city(sender.city) === city(p.location)) add('city', 'Same city', str(p.location).split(',')[0], 1);
  return found;
}

const CG_SENTENCE = {
  alma_mater: v => `we both studied at ${v}`,
  company: v => `we've both worked at ${v}`,
  home_country: v => `we both have roots in ${v}`,
  migrant_path: () => `we've both made the move to Australia`,
  city: v => `we're both based in ${v}`
};
export function commonGroundSentence(c) { return (CG_SENTENCE[c.type] || (() => ''))(c.value); }

// Ranked hook candidates. Each has a stable id so the user can choose which ones the writer uses.
export function buildHooks(p, commonGround = []) {
  const hooks = commonGround.map((c, i) => ({ id: `cg${i}`, text: `${c.label}: ${c.value}`, sentence: commonGroundSentence(c), source: 'common ground', score: 10 + c.strength }));
  p.recentPosts.forEach((post, i) => hooks.push({ id: `post${i}`, text: `Recent post: "${post.slice(0, 140)}"`, source: 'activity', score: 9 - i }));
  if (p.currentTitle && p.currentCompany) hooks.push({ id: 'role', text: `${p.currentTitle} at ${p.currentCompany}`, source: 'experience', score: 5 });
  if (p.about) hooks.push({ id: 'about', text: `About: "${p.about.slice(0, 160)}"`, source: 'about', score: 4 });
  if (p.skills.length) hooks.push({ id: 'skills', text: `Skills: ${p.skills.slice(0, 4).join(', ')}`, source: 'skills', score: 2 });
  return hooks.sort((a, b) => b.score - a.score).slice(0, 6);
}

// One canonical URL per person, whatever sub-page or query string the tab is on.
export function canonicalProfileUrl(url) {
  const m = String(url || '').match(/^https:\/\/(?:[a-z]+\.)?linkedin\.com\/in\/([^/?#]+)/i);
  return m ? `https://www.linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}/` : '';
}
