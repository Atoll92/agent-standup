// What the person typed and what a content list says, in Codex's wording.
function typed(rawText) {   // what the person typed, without what Codex wraps around it: the tags of an answer to a question, and the list of attached files ("# Files mentioned by the user:" … "## My request:")
  let text = String(rawText == null ? '' : rawText).replace(/<\/?send_user_message_question_reply>/g, ''); const filesStart = text.indexOf('# Files mentioned by the user:');
  if (filesStart >= 0) { const rest = text.slice(filesStart), requestMatch = /\n## My request[^\n]*:[ \t]*\n?/.exec(rest); text = text.slice(0, filesStart) + (requestMatch ? '\n' + rest.slice(requestMatch.index + requestMatch[0].length) : ''); }
  return text.trim();
}
const partsText = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => (part && typeof part.text === 'string' ? part.text : '')).filter(Boolean).join('\n') : '');

module.exports = { typed, partsText };
