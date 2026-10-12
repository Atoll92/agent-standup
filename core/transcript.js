// What a transcript record holds, in the small shapes the rest of the core uses: content blocks, tool calls and their results, pictures.
const blocks = (rec) => {
  const c = rec.message && rec.message.content;
  if (typeof c === 'string') return [{ type: 'text', text: c }];
  return Array.isArray(c) ? c : [];
};
const clip = (x, n = 700) => String(x == null ? '' : x).slice(0, n);
// What a tool call looks like on a screen: { id, ts, name, arg (a one-line summary), d (the detail, by kind) },
// with its id and time so the result can be matched later.
const toolLabel = (b, ts) => {
  const input = b.input || {};
  return { id: b.id, ts, name: b.name, arg: String(summaryOf(b, input)).slice(0, 90), d: detailOf(b, input) };
};

const firstQuestion = (input) => (Array.isArray(input.questions) && input.questions[0] ? input.questions[0] : null);
const mcpParts = (name) => (/^mcp__/.test(name) ? name.split('__') : null);   // mcp__<server>__<tool>

function summaryOf(b, input) {
  const question = firstQuestion(input), mcp = mcpParts(b.name);
  const firstString = mcp ? Object.values(input).find((v) => typeof v === 'string') : '';
  return input.file_path || input.notebook_path || input.path || input.pattern || input.command || input.url || input.query
    || input.skill || (question && question.question) || input.description || firstString || '';
}

const editDetail = (i) => {
  const e = i.edits ? i.edits[0] || {} : i;
  return { kind: 'edit', file: i.file_path, old: clip(e.old_string, 500), new: clip(e.new_string, 500) };
};

// How each known tool is shown, by tool name. Anything else is shown as text (see detailOf).
const DETAIL = {
  Bash: (i) => ({ kind: 'cmd', text: clip(i.command, 1200), note: clip(i.description, 140) }),
  Read: (i) => ({ kind: 'read', file: i.file_path, offset: i.offset, limit: i.limit }),
  Edit: editDetail,
  MultiEdit: editDetail,
  Write: (i) => ({ kind: 'write', file: i.file_path, text: clip(i.content, 800) }),
  Grep: (i) => ({ kind: 'grep', pattern: clip(i.pattern, 100), path: i.path, glob: i.glob }),
  Glob: (i) => ({ kind: 'glob', pattern: clip(i.pattern, 100), path: i.path }),
  TodoWrite: (i) => ({ kind: 'todo', items: (i.todos || []).slice(0, 20).map((x) => ({ c: clip(x.content, 120), s: x.status })) }),
  WebFetch: (i) => ({ kind: 'web', url: i.url }),
  WebSearch: (i) => ({ kind: 'web', query: i.query }),
  NotebookEdit: (i) => ({ kind: 'edit', file: i.notebook_path, old: '', new: clip(i.new_source, 500) }),
  AskUserQuestion: (i) => {
    const q = firstQuestion(i);
    return { kind: 'text', what: 'question', text: clip(q ? q.question + '\n' + (q.options || []).map((o) => '• ' + (o.label || '')).join('\n') : '', 500) };
  },
  Skill: (i) => ({ kind: 'text', what: 'skill', v: i.skill, text: clip(i.skill + (i.args ? ' ' + i.args : ''), 200) }),
  ToolSearch: (i) => ({ kind: 'text', what: 'toolsearch', text: clip(i.query, 200) }),
};

function detailOf(b, input) {
  if (Object.hasOwn(DETAIL, b.name)) return DETAIL[b.name](input);
  const mcp = mcpParts(b.name);
  if (mcp) return { kind: 'text', what: 'mcp', v: (mcp[1] || '') + ' · ' + (mcp.slice(2).join('__') || ''), text: clip(JSON.stringify(input), 400) };
  return { kind: 'text', text: clip(JSON.stringify(input), 300) };
}
const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text || '').join('\n') : '');
// Pictures a tool returned (a screenshot, an image file that was read). They are served from the transcript itself, so nothing outside the session files is ever read, and only bitmap types are sent.
const IMG_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const isImg = (x) => !!x && x.type === 'image' && !!x.source && x.source.type === 'base64' && typeof x.source.data === 'string' && IMG_TYPES.has(x.source.media_type);
const resultImages = (c) => (Array.isArray(c) ? c.filter(isImg) : []);
const RESULT_MAX = { AskUserQuestion: 900, Skill: 300, ToolSearch: 500, Read: 1900, Bash: 1300, Grep: 900, Glob: 800, WebFetch: 800, WebSearch: 800, Edit: 200, MultiEdit: 200, Write: 200 };
const NO_RESULT = new Set(['Agent', 'Task', 'SendMessage', 'TodoWrite']);   // internal bookkeeping, nothing to show
const HARNESS = /<(system-reminder|browser_instruction|ide_selection|ide_opened_file|task-notification|command-name|command-message|command-args|local-command-stdout|local-command-caveat)>[\s\S]*?<\/\1>\s*/g;   // blocks the harness wraps around what the human typed

module.exports = { blocks, clip, toolLabel, resultText, IMG_TYPES, isImg, resultImages, RESULT_MAX, NO_RESULT, HARNESS };
