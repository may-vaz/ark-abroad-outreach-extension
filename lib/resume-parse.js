// Resume text → sender profile, on-device, no API key.
// Built to handle the common layouts: "Title | Company | Dates", company-first blocks, "Title at Company",
// dates-first rows, company + right-aligned dates, internships sections, and "Title - Company - Dates" lists.
// Covered by fixtures in tests/fixtures/resumes. With an API key, Claude refines the result.

const HEADINGS = {
  summary: /^(summary|profile|professional summary|about me|objective|career objective|personal statement)$/i,
  experience: /^((professional|work|relevant|employment|career) )?(experience|history)$|^employment$|^work history$|^internships?$|^internship experience$/i,
  education: /^(education|academic (background|qualifications)|qualifications|education & training)$/i,
  skills: /^((technical|core|key|professional) )?(skills|competencies|core competencies)$|^tools( & technologies)?$|^technologies$/i,
  other: /^(projects|personal projects|academic projects|certifications?|licen[cs]es( & certifications)?|awards|achievements|languages|interests|hobbies|references|publications|volunteering|volunteer experience|activities|leadership)$/i
};
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const YEAR = '(19|20)\\d{2}';
const ONE_DATE = `(${MON}\\s*)?(\\d{1,2}\\/)?${YEAR}`;
const RANGE_RE = new RegExp(`\\(?\\s*${ONE_DATE}\\s*(–|—|-|to|until)\\s*(${ONE_DATE}|present|current|now|date)\\s*\\)?`, 'gi');
const SINGLE_RE = new RegExp(`\\(?\\s*${ONE_DATE}\\s*\\)?`, 'gi');
const HAS_DATE = new RegExp(`\\b${YEAR}\\b|\\bpresent\\b`, 'i');

const TITLE_WORDS = /\b(engineer|developer|analyst|manager|intern|internship|consultant|associate|specialist|lead|officer|executive|coordinator|designer|scientist|assistant|administrator|accountant|director|architect|representative|advisor|adviser|technician|barista|cashier|waiter|waitress|driver|clerk|operator|agent|support|researcher|teacher|tutor|nurse|chef|cook|recruiter|auditor|marketer|writer|editor|founder|co-founder|president|partner|trainee|apprentice|volunteer|fellow|head|programmer|tester|crew|supervisor|attendant|worker|staff|member|owner|strategist)\b/i;
const ORG_SUFFIX = /\b(ltd|limited|pvt|private|inc|llc|llp|plc|corp|corporation|co\.|company|group|technologies|technology|tech|solutions|services|systems|software|labs|bank|agency|consulting|consultancy|partners|holdings|industries|international|global|australia|india|digital|studios?|media|health|hospital|council|government|department)\b/i;
const EDU_WORD = /\b(univers(ity|ities|ité|ität|idad|idade|ità|ita)|college|institute|institution|school|academy|polytechnic|tafe|iit|nit|iiit|conservatory)\b/i;
const DEGREE = /^(b\.?\s?(e|tech|sc|com|a|ba|bs)\b|m\.?\s?(e|tech|sc|ba|com|s)\b|bachelor|master|mba|phd|diploma|certificate|associate degree|high school|hsc|ssc)/i;

const AU_CITIES = ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra', 'Hobart', 'Darwin', 'Gold Coast', 'Newcastle', 'Geelong', 'Wollongong', 'Sunshine Coast', 'Townsville', 'Cairns'];
const AU_STATES = /\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT|New South Wales|Victoria|Queensland|Western Australia|South Australia|Tasmania)\b/;
const COUNTRIES = ['India', 'Nepal', 'Pakistan', 'Sri Lanka', 'Bangladesh', 'Philippines', 'Vietnam', 'China', 'Indonesia', 'Malaysia', 'Nigeria', 'Kenya', 'Brazil', 'Colombia', 'Iran', 'South Africa', 'Thailand', 'Ghana', 'Zimbabwe', 'Mexico', 'Chile', 'Peru', 'Argentina', 'Egypt', 'Lebanon', 'Fiji', 'Myanmar', 'Mongolia', 'Korea', 'Japan', 'Hong Kong', 'Taiwan', 'Singapore'];
const CITY_COUNTRY = { India: ['Mumbai', 'Delhi', 'New Delhi', 'Bengaluru', 'Bangalore', 'Hyderabad', 'Chennai', 'Pune', 'Goa', 'Kolkata', 'Noida', 'Gurgaon', 'Gurugram', 'Ahmedabad', 'Jaipur', 'Kochi', 'Lucknow', 'Chandigarh', 'Indore'], Pakistan: ['Karachi', 'Lahore', 'Islamabad'], Nepal: ['Kathmandu'], Brazil: ['São Paulo', 'Sao Paulo', 'Rio de Janeiro'], Philippines: ['Manila', 'Cebu'], Vietnam: ['Hanoi', 'Ho Chi Minh'], China: ['Beijing', 'Shanghai', 'Shenzhen'], Bangladesh: ['Dhaka'], 'Sri Lanka': ['Colombo'] };
const PLACES = new Set([...AU_CITIES, ...COUNTRIES, ...Object.values(CITY_COUNTRY).flat(), 'Australia', 'Remote', 'Hybrid', 'Onsite', 'On-site'].map(x => x.toLowerCase()));

const clean = s => String(s || '').replace(/[•●▪◦■►]/g, ' ').replace(/[ \t]+/g, ' ').trim();
const isPlace = f => PLACES.has(f.toLowerCase()) || AU_STATES.test(f) && f.split(' ').length <= 3 || /^\d{4}$/.test(f);
const stripDates = s => s.replace(RANGE_RE, ' ').replace(SINGLE_RE, ' ').replace(/\(\s*\)/g, ' ').replace(/[ \t]+/g, ' ').replace(/[\s\-–—|,:]+$/, '').replace(/^[\s\-–—|,:]+/, '').trim();
function unique(a) { const seen = new Set(); return a.filter(x => { const k = String(x).toLowerCase(); if (!x || seen.has(k)) return false; seen.add(k); return true; }); }
function titleCase(s) { return s === s.toUpperCase() ? s.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase()) : s; }

export function splitSections(text) {
  // Keep raw lines (tabs and wide gaps matter for right-aligned dates), but trim them.
  const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
  const sections = { header: [] };
  let cur = 'header';
  for (const raw of lines) {
    const bare = clean(raw).replace(/[:\-–\s]+$/, '');
    const key = bare.length < 45 && Object.keys(HEADINGS).find(k => HEADINGS[k].test(bare));
    if (key) { cur = key; sections[cur] = sections[cur] || []; continue; }
    (sections[cur] = sections[cur] || []).push(raw);
  }
  return sections;
}

// Bullets and sentences describing work: not entry headers.
function isBullet(raw) {
  const t = raw.trim();
  if (/^[•●▪◦■►*·]/.test(t) || /^[-–—]\s/.test(t)) return true;
  const c = clean(t);
  if (HAS_DATE.test(c) && c.length < 110) return false;
  return (c.length > 35 && /[.;]$/.test(c)) || c.length > 110;
}

function fragmentsOf(line) {
  return stripDates(line.replace(/\t+|\s{3,}/g, ' | '))
    .split(/\s*\|\s*|\s+[–—-]\s+|\s+at\s+|\s*@\s*|,\s*/i)
    .map(clean).map(f => f.replace(/^[(\[]|[)\]]$/g, '').replace(/[\s\-–—|,:]+$/, '').trim()).filter(f => f.length > 1);
}

function parseEntry(lines) {
  let title = '', company = '', strong = '';
  const frags = lines.flatMap(fragmentsOf);
  for (const f of frags) {
    if (isPlace(f)) continue;
    if (!title && TITLE_WORDS.test(f)) { title = f; continue; }
    if (!strong && ORG_SUFFIX.test(f) && !TITLE_WORDS.test(f)) strong = f;
    if (!company && !TITLE_WORDS.test(f)) company = f;
  }
  return { title, company: strong || company };
}

export function parseExperience(lines) {
  const entries = [];
  let block = [];
  const flush = () => {
    if (!block.length) return;
    const dateIdx = block.map((l, i) => (HAS_DATE.test(l) ? i : -1)).filter(i => i >= 0);
    if (!dateIdx.length) { if (block.length <= 3) entries.push(parseEntry(block)); block = []; return; }
    // Attach undated lines to the right date line: if the block starts with a dated line, lines follow their date;
    // otherwise lines precede their date.
    const dateFirst = dateIdx[0] === 0;
    const groups = dateIdx.map(() => []);
    block.forEach((l, i) => {
      let g;
      if (dateFirst) g = dateIdx.filter(d => d <= i).length - 1;
      else { g = dateIdx.findIndex(d => d >= i); if (g < 0) g = dateIdx.length - 1; }
      groups[g].push(l);
    });
    groups.forEach(g => entries.push(parseEntry(g)));
    block = [];
  };
  let prevBullet = false;
  lines.forEach((raw, i) => {
    const c = clean(raw);
    // A wrapped bullet continues on the next line ("…across finance and" / "operations"): treat it as part of the bullet.
    const continuation = prevBullet && !HAS_DATE.test(c) && (/^[a-z(&,]/.test(c) || (lines[i + 1] && isBullet(lines[i + 1])));
    if (isBullet(raw) || continuation) { flush(); prevBullet = true; return; }
    prevBullet = false;
    block.push(raw);
  });
  flush();
  return entries.filter(e => e.title || e.company);
}

// Re-join lines that a narrow column wrapped ("…College of" / "Engineering, Goa").
function joinWrapped(lines) {
  const out = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    const wrapped = prev && !DEGREE.test(l) && (
      /(\b(of|and|for|in|&|de|da|do)|[,\-–—(])$/i.test(prev) ||           // "College of" / "Science -"
      /^[a-z(]/.test(l) ||                                                  // "of Queensland (2022)"
      /\b(univers\w*|college|institute|tafe|school|academy)$/i.test(prev) ||  // "… - TAFE" / "Queensland - 2024"
      (/^(univers|college|institute|school|academy|polytechnic|tafe)/i.test(l) && !EDU_WORD.test(prev) && !/\d{4}\)?$/.test(prev) &&
        (!DEGREE.test(prev) || /\s[-–—|,]\s*[A-Z][\p{L}.']*(\s[A-Z][\p{L}.']*)?$/u.test(prev)))      // "B.Tech … - Anna" / "University, Chennai"
    );
    if (wrapped) out[out.length - 1] = `${prev} ${l}`; else out.push(l);
  }
  return out;
}

function institutions(lines) {
  lines = joinWrapped(lines);
  return unique(lines.flatMap(l => stripDates(l).split(/\s*[|,—–(]\s*|\s+-\s+|\)\s*/)).map(clean).map(f => f.replace(/[\s\-–—|,:]+$/, ''))
    .filter(f => EDU_WORD.test(f) && !DEGREE.test(f) && f.length < 90)
    .map(f => f.replace(/^(at|from)\s+/i, '')));
}

export function parseResume(text) {
  const s = splitSections(text);
  const all = Object.values(s).flat().map(clean);
  const header = s.header.slice(0, 8).map(clean);

  const nameLine = header.find(l => /^[\p{L}][\p{L} .'-]{2,40}$/u.test(l) && l.split(' ').length >= 2 && l.split(' ').length <= 4 && !TITLE_WORDS.test(l) && !AU_STATES.test(l) && !isPlace(l.split(',')[0]));
  const name = nameLine ? titleCase(nameLine) : '';

  const city = AU_CITIES.find(c => header.some(l => l.includes(c))) ||
    (header.map(l => l.match(/\b([A-Z][a-z]+),\s*([A-Z][A-Za-z ]+)\b/)).find(Boolean)?.[1] || '');

  const eduLines = (s.education || []).map(clean);
  const universities = institutions(eduLines.length ? eduLines : all.filter(l => EDU_WORD.test(l))).slice(0, 4);

  const expLines = s.experience || [];
  const roles = parseExperience(expLines);
  const pastCompanies = unique(roles.map(r => r.company).filter(c => c && c.length < 60 && !EDU_WORD.test(c))).slice(0, 6);

  const origin = eduLines.concat(expLines.map(clean)).join(' ');
  const homeCountry = COUNTRIES.find(c => new RegExp(`\\b${c}\\b`).test(origin)) ||
    Object.keys(CITY_COUNTRY).find(k => CITY_COUNTRY[k].some(c => new RegExp(`\\b${c}\\b`).test(origin))) || '';

  const inlineSkills = all.filter(l => /^(technical )?skills\s*:/i.test(l)).map(l => l.replace(/^(technical )?skills\s*:\s*/i, ''));
  const skillLines = (s.skills || []).map(clean).concat(inlineSkills);
  const skills = unique(skillLines.flatMap(l => l.replace(/^[A-Za-z &/]+:\s*/, '').split(/[,;|•·]/)).map(clean)
    .filter(x => x.length > 0 && x.length < 40 && !/^\d+$/.test(x))).slice(0, 15);

  const wins = expLines.map(clean).filter(l => /\d+%|\$\d|\d+x\b|\b\d{2,}\b/.test(l) && l.length > 30 && !HAS_DATE.test(l))
    .sort((a, b) => score(b) - score(a)).slice(0, 2).map(l => l.replace(/^[-–•*]\s*/, '').replace(/\.$/, ''));

  const bio = (s.summary || []).map(clean).join(' ').split(/(?<=[.!?])\s+/).slice(0, 2).join(' ').slice(0, 300);

  return { name, city, homeCountry, universities, pastCompanies, skills, currentRole: roles.find(r => r.title)?.title || '', strengths: wins.join('; '), bio };
}

function score(l) { return (l.match(/\d+%/g) || []).length * 3 + (l.match(/\d/g) || []).length; }
