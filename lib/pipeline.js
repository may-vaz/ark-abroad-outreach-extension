// Outreach pipeline: pure functions over a { key: contact } map. Storage is handled by the caller.

export const STATUSES = ['drafted', 'sent', 'accepted', 'replied', 'call_booked', 'closed'];
export const STATUS_LABELS = { drafted: 'Drafted', sent: 'Sent', accepted: 'Accepted', replied: 'Replied', call_booked: 'Call booked', closed: 'Closed' };
export const FOLLOW_UP_DAYS = 5;
export const MAX_CONTACTS = 300;
const DAY = 86400000;

export function upsertContact(map, key, patch, now = Date.now()) {
  const prev = map[key] || { key, status: 'drafted', createdAt: now, drafts: [] };
  const next = { ...prev, ...patch, key, updatedAt: now };
  if (patch.draft) {
    next.drafts = [{ ...patch.draft, at: now }, ...(prev.drafts || [])].slice(0, 5);
    delete next.draft;
  }
  if (patch.status === 'sent' && prev.status !== 'sent') next.followUpAt = now + FOLLOW_UP_DAYS * DAY;
  // After someone accepts is when replies actually happen (about 10% vs about 3% for the note), so the next step is due right away.
  if (patch.status === 'accepted' && prev.status !== 'accepted') next.followUpAt = now;
  if (['replied', 'call_booked', 'closed'].includes(patch.status)) next.followUpAt = null;
  const out = { ...map, [key]: next };
  return prune(out);
}

function prune(map) {
  const keys = Object.keys(map);
  if (keys.length <= MAX_CONTACTS) return map;
  const drop = keys.sort((a, b) => (map[a].updatedAt || 0) - (map[b].updatedAt || 0)).slice(0, keys.length - MAX_CONTACTS);
  const out = { ...map }; drop.forEach(k => delete out[k]); return out;
}

export function listContacts(map, { query = '', status = 'all' } = {}, now = Date.now()) {
  const q = query.toLowerCase();
  return Object.values(map)
    .filter(c => status === 'all' || (status === 'due' ? isDue(c, now) : c.status === status))
    .filter(c => !q || `${c.name} ${c.company} ${c.headline}`.toLowerCase().includes(q))
    .sort((a, b) => (isDue(b, now) - isDue(a, now)) || (b.updatedAt - a.updatedAt));
}

export function isDue(c, now = Date.now()) { return !!(c.followUpAt && c.followUpAt <= now); }

export function toCSV(map) {
  const cols = ['name', 'company', 'headline', 'status', 'profileUrl', 'followUpAt', 'lastMessage'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = Object.values(map).map(c => [c.name, c.company, c.headline, c.status, c.profileUrl,
    c.followUpAt ? new Date(c.followUpAt).toISOString().slice(0, 10) : '', c.drafts?.[0]?.message].map(esc).join(','));
  return [cols.join(','), ...rows].join('\n');
}

// What the user should do next for this contact, in plain words.
export function nextAction(c, now = Date.now()) {
  if (c.status === 'drafted') return 'Not sent yet';
  if (c.status === 'accepted') return 'Send first message';
  if (c.status === 'sent' && isDue(c, now)) return 'Follow-up due';
  if (c.status === 'sent') return `Follow up on ${new Date(c.followUpAt).toLocaleDateString()}`;
  if (c.status === 'replied') return 'Reply and propose a time';
  if (c.status === 'call_booked') return 'Prepare for the call';
  return '';
}

// Monthly connection-note budget (free accounts get only a handful of personalised notes a month).
export function logNote(log, now = Date.now()) { return [...log.filter(t => now - t < 62 * 86400000), now]; }
export function notesThisMonth(log, now = Date.now()) {
  const d = new Date(now); const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return log.filter(t => t >= start && t <= now).length;
}
