// What the person typed and what a content list says, in Codex's wording.
function typed(t) {   // what the person typed, without what Codex wraps around it: the tags of an answer to a question, and the list of attached files ("# Files mentioned by the user:" … "## My request:")
  let s = String(t == null ? '' : t).replace(/<\/?send_user_message_question_reply>/g, ''); const i = s.indexOf('# Files mentioned by the user:');
  if (i >= 0) { const rest = s.slice(i), m = /\n## My request[^\n]*:[ \t]*\n?/.exec(rest); s = s.slice(0, i) + (m ? '\n' + rest.slice(m.index + m[0].length) : ''); }
  return s.trim();
}
const partsText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && typeof x.text === 'string' ? x.text : '')).filter(Boolean).join('\n') : '');

module.exports = { typed, partsText };
