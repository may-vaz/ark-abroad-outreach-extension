// Outreach playbooks: each one is a goal in the job search, not just a "message type".
// They follow the order a migrant job seeker usually works through: get noticed by
// recruiters, talk to hiring managers, ask people who share their background,
// ask for referrals, and follow up.

export const PLAYBOOKS = {
  recruiter: {
    label: 'Recruiter',
    goal: 'Get onto the recruiter\'s radar for roles they place.',
    ask: 'a short call, or to be kept in mind for relevant roles',
    guidance: 'State the target role and one relevant proof point. Recruiters value clarity: role, level, location.'
  },
  referral: {
    label: 'Referral',
    goal: 'Ask for a referral to one specific open role at their company.',
    ask: 'whether they would be comfortable referring the sender',
    guidance: 'Name the role. Give one or two matching strengths. Make it easy to say no.'
  },
  coffee: {
    label: 'Coffee chat',
    goal: 'Learn from someone further along, ideally with a shared background (same uni, home country, employer or migrant path).',
    ask: 'a 15-minute virtual coffee',
    guidance: 'Lead with the shared background. Small, specific ask. No job request.'
  },
  follow_up: {
    label: 'Follow-up',
    goal: 'Follow up after no reply, or send the first message after they accepted.',
    ask: 'a light next step',
    guidance: 'Short. Add one new piece of value. Never guilt-trip about not replying.'
  },
  reply: {
    label: 'Reply',
    goal: 'Reply to a message the sender received so the conversation moves forward.',
    ask: 'a clear next step (a time to talk, or the info they asked for)',
    guidance: 'Answer what they asked first. Warm and brief. Propose a concrete next step.'
  }
};

export const TONES = {
  warm: 'Friendly and conversational, Australian-professional: relaxed but respectful.',
  formal: 'Polished and professional, but still natural. No old-fashioned formality.',
  direct: 'Concise and to the point. Short sentences, no warm-up.'
};
export const TONE_LABELS = { warm: 'Friendly', formal: 'Professional', direct: 'Direct' };

export function getPlaybook(id) {
  return PLAYBOOKS[id] || PLAYBOOKS.recruiter;
}
