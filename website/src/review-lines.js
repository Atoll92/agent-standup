// What the cast says in agent-standup.com/review/. Every line is recorded once with the app's natural voices (scripts/review-voices.js → website/static/review/voices/<id>.mp3),
// so no line holds a number: the numbers land on the screen while the voice says the line. A changed text needs `node scripts/review-voices.js` again.
// Voices: the app gives these to the same characters (kokoro.js, voiceFor in public/index.html); "you" is the human under review.
const REVIEW_VOICES = { margot: ['af_heart', 0.95], remy: ['bm_george', 1], iris: ['bf_emma', 1], hugo: ['am_michael', 0.97], you: ['am_puck', 0.92] };
const REVIEW_LINES = {
  intro: ['margot', 'Thanks for joining. This is your annual performance review. Camera on, please.'],
  prompts: ['remy', 'Let’s start with communication. This is how many prompts you sent us.'],
  short: ['remy', 'And your most detailed instruction. You wrote it… quite a lot.'],
  shortNone: ['remy', 'Your prompts were thorough. We read every word. Mostly.'],
  ar: ['iris', 'Next. The number of times we told you: you’re absolutely right.'],
  ar2: ['iris', 'Legal asked us to stop. We told them they’re absolutely right.'],
  arNone: ['iris', 'We never once told you that you’re absolutely right. We are working on our feelings.'],
  night: ['margot', 'Messages you sent us between midnight and five in the morning.'],
  night2: ['margot', 'We don’t sleep. You should.'],
  nightNone: ['margot', 'You never wrote to us after midnight. Human Resources finds this suspicious.'],
  esc: ['iris', 'Times you interrupted us, mid-sentence.'],
  esc2: ['iris', 'We were fine. Mostly.'],
  words: ['hugo', 'Finance note. The number of words we wrote you.'],
  words2: ['hugo', 'That’s a lot of Great Gatsbys. You read the last line of each.'],
  sub: ['remy', 'Sub-agents you hired.'],
  sub2: ['remy', 'At one point, this many of us were working at once. And nobody held a standup.'],
  subNone: ['remy', 'You never hired a single sub-agent. One of us did everything. She’d like a word.'],
  please: ['margot', 'On the bright side: you said please.'],
  swear: ['margot', 'You also said this. It’s in your file.'],
  record: ['margot', 'Anything you’d like to add, for the record?'],
  overallUp: ['margot', 'Overall: you exceed expectations.'],
  overallOk: ['margot', 'Overall: you meet expectations.'],
  overallBarely: ['margot', 'Overall: you meet expectations. Barely.'],
  overallPip: ['margot', 'Overall: we’re putting you on a performance improvement plan.'],
  outro: ['margot', 'That’s all. Thank you, everyone.'],
};
// next year's title, by what stands out most; say: the line that announces it; act: the advice that follows
const REVIEW_TITLES = {
  night: { title: 'Chief Night Officer', act: 'Action: go to bed. We’ll still be here.' },
  ops: { title: 'Head of Agent Operations', act: 'Action: hold a standup. You have a team now.' },
  micro: { title: 'Senior Micromanager', act: 'Action: let one of us finish a sentence.' },
  diplomacy: { title: 'Head of Diplomacy', act: 'Action: keep it up. We noticed.' },
  feelings: { title: 'Director of Strong Feelings', act: 'Action: breathe. The tests were already red.' },
  principal: { title: 'Principal “{short}” Engineer', act: 'Action: write a prompt longer than three words.', say: 'Next year’s title is on your card. You’ll love it.' },
  validated: { title: 'Most Validated Employee', act: 'Action: none. You’re absolutely right.' },
};
for (const [k, t] of Object.entries(REVIEW_TITLES)) { REVIEW_LINES['title_' + k] = ['margot', t.say || 'Next year’s title: ' + t.title + '.']; REVIEW_LINES['act_' + k] = ['margot', t.act]; }
// the human's statement for the record: their own most frequent short prompt, said aloud (how each is spoken, where the spelling would mislead the voice)
const REVIEW_SAY = { y: 'Y.', k: 'K.', lgtm: 'L. G. T. M.', oui: 'Wee.', 'vas-y': 'Vas-y.', non: 'Non.', ok: 'Okay.', 'ok go': 'Okay, go.', 'ok continue': 'Okay, continue.' };
const reviewYouId = (short) => 'you_' + String(short).replace(/[^a-z]+/g, '_');
if (typeof REVIEW_SHORT !== 'undefined') for (const s of REVIEW_SHORT) REVIEW_LINES[reviewYouId(s)] = ['you', REVIEW_SAY[s] || s[0].toUpperCase() + s.slice(1) + '.'];
REVIEW_LINES.you_default = ['you', 'Continue.'];
if (typeof module === 'object' && module.exports) module.exports = { REVIEW_VOICES, REVIEW_LINES, REVIEW_TITLES, reviewYouId };
