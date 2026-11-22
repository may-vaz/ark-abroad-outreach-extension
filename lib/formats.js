// LinkedIn channel constraints. Hard limits are enforced in code, not only in the prompt.

export const FORMATS = {
  note: {
    label: 'Connection note',
    hasSubject: false,
    // Free accounts: 200 chars; Premium: 300 chars.
    limit: (settings = {}) => (settings.premium ? 300 : 200),
    target: (settings = {}) => (settings.premium ? 260 : 180),
    style: 'No greeting line break or sign-off. One or two sentences.'
  },
  dm: {
    label: 'Direct message',
    hasSubject: false,
    limit: () => 1000,
    target: () => 550,
    style: 'Three short paragraphs at most. Greeting by first name. Short sign-off with the sender\'s first name.'
  },
  inmail: {
    label: 'InMail',
    hasSubject: true,
    subjectLimit: 200,
    limit: () => 1900,
    target: () => 700,
    style: 'Specific subject line under 60 characters. Body in short paragraphs.'
  },
  email: {
    label: 'Email',
    hasSubject: true,
    subjectLimit: 120,
    limit: () => 2500,
    target: () => 800,
    style: 'Specific subject line. Short paragraphs. Sign-off with the sender\'s full name.'
  }
};

export function getFormat(id) {
  return FORMATS[id] || FORMATS.note;
}

// Trim to a limit by dropping whole sentences from the middle-out, never mid-word.
export function fitToLimit(text, limit) {
  const clean = String(text || '').trim();
  if (clean.length <= limit) return clean;
  const sentences = clean.match(/[^.!?\n]+[.!?]*\s*|\n+/g) || [clean];
  // Keep first (hook) and last (ask) sentences; drop from the middle.
  while (sentences.length > 2 && sentences.join('').trim().length > limit) {
    sentences.splice(Math.floor(sentences.length / 2), 1);
  }
  let out = sentences.join('').trim();
  if (out.length > limit) {
    out = out.slice(0, limit - 1);
    out = out.slice(0, out.lastIndexOf(' ')).replace(/[,;:\s]+$/, '') + '…';
  }
  return out;
}
