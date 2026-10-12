// What a transcript record holds, in the small shapes the rest of the core uses: content blocks, tool calls and their results, pictures.
const blocks = (record) => {
  const content = record.message && record.message.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content : [];
};
const clip = (value, maxLength = 700) => String(value == null ? '' : value).slice(0, maxLength);
// What a tool call looks like on a screen: { id, ts, name, arg (a one-line summary), d (the detail, by kind) },
// with its id and time so the result can be matched later.
const toolLabel = (toolUse, ts) => {
  const input = toolUse.input || {};
  return { id: toolUse.id, ts, name: toolUse.name, arg: String(summaryOf(toolUse, input)).slice(0, 90), d: detailOf(toolUse, input) };
};

const firstQuestion = (input) => (Array.isArray(input.questions) && input.questions[0] ? input.questions[0] : null);
const mcpParts = (name) => (/^mcp__/.test(name) ? name.split('__') : null);   // mcp__<server>__<tool>

function summaryOf(toolUse, input) {
  const question = firstQuestion(input), mcp = mcpParts(toolUse.name);
  const firstString = mcp ? Object.values(input).find((value) => typeof value === 'string') : '';
  return input.file_path || input.notebook_path || input.path || input.pattern || input.command || input.url || input.query
    || input.skill || (question && question.question) || input.description || firstString || '';
}

const editDetail = (input) => {
  const edit = input.edits ? input.edits[0] || {} : input;
  return { kind: 'edit', file: input.file_path, old: clip(edit.old_string, 500), new: clip(edit.new_string, 500) };
};

// How each known tool is shown, by tool name. Anything else is shown as text (see detailOf).
const DETAIL = {
  Bash: (input) => ({ kind: 'cmd', text: clip(input.command, 1200), note: clip(input.description, 140) }),
  Read: (input) => ({ kind: 'read', file: input.file_path, offset: input.offset, limit: input.limit }),
  Edit: editDetail,
  MultiEdit: editDetail,
  Write: (input) => ({ kind: 'write', file: input.file_path, text: clip(input.content, 800) }),
  Grep: (input) => ({ kind: 'grep', pattern: clip(input.pattern, 100), path: input.path, glob: input.glob }),
  Glob: (input) => ({ kind: 'glob', pattern: clip(input.pattern, 100), path: input.path }),
  TodoWrite: (input) => ({ kind: 'todo', items: (input.todos || []).slice(0, 20).map((todo) => ({ c: clip(todo.content, 120), s: todo.status })) }),
  WebFetch: (input) => ({ kind: 'web', url: input.url }),
  WebSearch: (input) => ({ kind: 'web', query: input.query }),
  NotebookEdit: (input) => ({ kind: 'edit', file: input.notebook_path, old: '', new: clip(input.new_source, 500) }),
  AskUserQuestion: (input) => {
    const question = firstQuestion(input);
    return { kind: 'text', what: 'question', text: clip(question ? question.question + '\n' + (question.options || []).map((option) => '• ' + (option.label || '')).join('\n') : '', 500) };
  },
  Skill: (input) => ({ kind: 'text', what: 'skill', v: input.skill, text: clip(input.skill + (input.args ? ' ' + input.args : ''), 200) }),
  ToolSearch: (input) => ({ kind: 'text', what: 'toolsearch', text: clip(input.query, 200) }),
};

function detailOf(toolUse, input) {
  if (Object.hasOwn(DETAIL, toolUse.name)) return DETAIL[toolUse.name](input);
  const mcp = mcpParts(toolUse.name);
  if (mcp) return { kind: 'text', what: 'mcp', v: (mcp[1] || '') + ' · ' + (mcp.slice(2).join('__') || ''), text: clip(JSON.stringify(input), 400) };
  return { kind: 'text', text: clip(JSON.stringify(input), 300) };
}
const resultText = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => part.text || '').join('\n') : '');
// Pictures a tool returned (a screenshot, an image file that was read). They are served from the transcript itself, so nothing outside the session files is ever read, and only bitmap types are sent.
const IMG_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const isImg = (block) => !!block && block.type === 'image' && !!block.source && block.source.type === 'base64' && typeof block.source.data === 'string' && IMG_TYPES.has(block.source.media_type);
const resultImages = (content) => (Array.isArray(content) ? content.filter(isImg) : []);
const RESULT_MAX = { AskUserQuestion: 900, Skill: 300, ToolSearch: 500, Read: 1900, Bash: 1300, Grep: 900, Glob: 800, WebFetch: 800, WebSearch: 800, Edit: 200, MultiEdit: 200, Write: 200 };
const NO_RESULT = new Set(['Agent', 'Task', 'SendMessage', 'TodoWrite']);   // internal bookkeeping, nothing to show
const HARNESS = /<(system-reminder|browser_instruction|ide_selection|ide_opened_file|task-notification|command-name|command-message|command-args|local-command-stdout|local-command-caveat)>[\s\S]*?<\/\1>\s*/g;   // blocks the harness wraps around what the human typed

module.exports = { blocks, clip, toolLabel, resultText, IMG_TYPES, isImg, resultImages, RESULT_MAX, NO_RESULT, HARNESS };
