// Someone in a session's call: the lead, or a sub-agent it (or a workflow) launched.
class Agent {
  static LEAD_ID = 'main';

  constructor({ id, role, type, name, ownName, launchCallId, workflow, phase, lastActiveAt, translations }) {
    this.id = id;                       // 'main' for the lead; a sub-agent's id is the name of its transcript
    this.role = role;                   // what it was asked to do ('Lead' for the lead)
    this.type = type;                   // the kind of agent ('main', 'general-purpose'…)
    this.name = name;                   // what to call it, when the source says (the lead of a Codex session is 'Codex')
    this.ownName = ownName;             // the name the person gave it (see sources/claude/agentNames.js); without one, the page gives it a first name
    this.launchCallId = launchCallId;   // the tool call that launched it (an Agent call of its parent)
    this.workflow = workflow;           // the workflow run that launched it, if one did
    this.phase = phase;                 // its phase in that workflow
    this.lastActiveAt = lastActiveAt;   // when its transcript was last written to (ms)
    this.translations = translations || {};   // its role in other languages, by language code (the demo)
  }

  static lead({ name } = {}) { return new Agent({ id: Agent.LEAD_ID, role: 'Lead', type: 'main', name }); }

  get isLead() { return this.id === Agent.LEAD_ID; }
}

module.exports = { Agent };
