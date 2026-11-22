// Outreach coach: a rule-based, explainable check of quality, run on every draft.
// The rules encode what Ark Abroad teaches: present experience the way Australian
// employers expect, be specific, and make one clear ask.

const RULES = [
  { id: 'generic_opener', severity: 'warn', weight: 12,
    re: /\b(i came across your profile|hope (this|you) (message )?finds you well|i am writing to|i was impressed by your profile|i hope you are doing well)\b/i,
    tip: 'Generic opener. Lead with something specific to them instead.' },
  { id: 'overly_formal', severity: 'warn', weight: 10,
    re: /\b(kindly|do the needful|respected (sir|madam|ma'am)|dear sir|dear madam|sir\/ma'?am|revert back|please find attached|pfa|hoping for a positive response|esteemed organi[sz]ation)\b/i,
    tip: 'Australian recruiters often read this phrasing as stiff. Use plain, friendly language.' },
  { id: 'desperation', severity: 'warn', weight: 12,
    re: /\b(any (job|role|opportunity)|desperate|struggling to find|survival job|please help me|i really need)\b/i,
    tip: 'Sounds like need, not value. Lead with what you bring.' },
  { id: 'visa_first_touch', severity: 'info', weight: 5,
    re: /\b(visa|485|482|subclass|work rights|sponsorship)\b/i,
    tip: 'Visa details usually work better later in the conversation than in a first message.' },
  { id: 'placeholder', severity: 'error', weight: 30,
    re: /\[[^\]]{2,30}\]|\{[^}]{2,30}\}|<[A-Z][^>]{1,30}>/,
    tip: 'Unfilled placeholder left in the message.' },
  { id: 'hype', severity: 'info', weight: 4,
    re: /\b(passionate|synerg|game[- ]changer|rockstar|ninja|guru|thrilled)\b/i,
    tip: 'Buzzword. Replace it with a concrete fact.' }
];

export function reviewMessage(text, { limit, subject, subjectLimit, recipient = {}, hooks = [] } = {}) {
  const msg = String(text || '');
  const issues = [];
  let score = 100;
  const add = (id, severity, weight, tip) => { issues.push({ id, severity, tip }); score -= weight; };

  if (!msg.trim()) return { score: 0, issues: [{ id: 'empty', severity: 'error', tip: 'Message is empty.' }], length: 0 };

  if (limit && msg.length > limit) add('over_limit', 'error', 35, `${msg.length}/${limit} characters. LinkedIn will reject this.`);
  if (subjectLimit && subject && subject.length > subjectLimit) add('subject_over', 'error', 20, `Subject is over ${subjectLimit} characters.`);

  for (const r of RULES) if (r.re.test(msg)) add(r.id, r.severity, r.weight, r.tip);

  const lower = msg.toLowerCase();
  const specific = [recipient.firstName, recipient.currentCompany, ...hooks.map(h => h.keyword).filter(Boolean)]
    .filter(x => x && x.length > 2 && x !== 'there')
    .some(x => lower.includes(String(x).toLowerCase()));
  if (!specific) add('not_personal', 'warn', 15, 'Nothing in it is specific to this person (name, company or hook).');

  const hasAsk = /\?|\b(would you|could we|open to|happy to|keen to|chat|call|coffee|refer)\b/i.test(msg);
  if (!hasAsk) add('no_ask', 'warn', 12, 'No clear ask. End with one specific, easy-to-answer request.');

  const sentences = msg.split(/(?<=[.!?])\s+/).filter(Boolean);
  const iStarts = sentences.filter(s => /^i\b/i.test(s.trim())).length;
  if (sentences.length >= 3 && iStarts / sentences.length > 0.5) add('self_focused', 'info', 6, 'Most sentences start with "I". Make more of it about them.');

  return { score: Math.max(0, Math.min(100, score)), issues, length: msg.length };
}

export function blockingIssues(review) {
  return review.issues.filter(i => i.severity === 'error' || ['generic_opener', 'overly_formal', 'desperation', 'not_personal', 'no_ask'].includes(i.id));
}
