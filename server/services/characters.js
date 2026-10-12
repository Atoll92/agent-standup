// Custom characters: the person's own pixel art replaces the drawn characters. Plain image files in one folder, and nothing else is ever served from it.
//   lead.png / claude.png → the lead · you.png → the human · any other image → a pool for the sub-agents · name-talk.png → an optional open-mouth frame of name.png
// Built-in packs ship with the app (examples/<folder>) and are picked in ⚙ → Characters. examples/characters stays in the repository
// as a model for one's own folder; it is not shipped.
const fs = require('fs'), os = require('os'), path = require('path');

const FILE_NAME = /^[\w][\w .()\-]{0,78}\.(png|gif|webp|jpe?g)$/i;
const MAX_BYTES = 300 * 1024;
const MAX_LISTED = 80;
const CONTENT_TYPES = { png: 'image/png', gif: 'image/gif', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const PACKS = { cats: 'cats' };   // pack name → its folder in examples/
const EXAMPLES = path.join(__dirname, '..', '..', 'examples');

const charactersDir = () => process.env.AGENT_STANDUP_CHARACTERS || path.join(os.homedir(), '.agent-standup', 'characters');
const packDir = (name) => (Object.hasOwn(PACKS, name) ? path.join(EXAMPLES, PACKS[name]) : null);
const packNames = () => Object.keys(PACKS);

// lstat, not stat: a symlink is not a regular file, so it is skipped and never served.
const isServable = (dir, name) => { try { const stat = fs.lstatSync(path.join(dir, name)); return stat.isFile() && stat.size <= MAX_BYTES; } catch { return false; } };

// The characters of the person's folder, or of a pack: { dir, max, chars: [{ stem, file, talk, role: 'lead' | 'you' | 'agent' }] }
function listCharacters(pack) {
  const dir = pack ? packDir(pack) : charactersDir();
  if (!dir) return { dir: '', max: MAX_BYTES, chars: [] };
  let names = [];
  try { names = fs.readdirSync(dir); } catch {}
  const images = names.filter((name) => FILE_NAME.test(name)).filter((name) => isServable(dir, name)).slice(0, MAX_LISTED);
  const stemOf = (name) => name.replace(/\.[^.]+$/, ''), byStem = new Map(images.map((name) => [stemOf(name).toLowerCase(), name]));
  const chars = images.filter((name) => !/-talk$/i.test(stemOf(name))).map((name) => {
    const stem = stemOf(name), lower = stem.toLowerCase();
    return { stem, file: name, talk: byStem.get(lower + '-talk') || null, role: /^(lead|claude)$/.test(lower) ? 'lead' : /^(you|human|user)$/.test(lower) ? 'you' : 'agent' };
  }).sort((first, second) => first.stem.localeCompare(second.stem));
  return { dir, max: MAX_BYTES, chars };
}

// The file to serve for an image asked by name from `dir`, with its type; null for anything that is not a character image of that folder.
function characterImage(dir, name) {
  const file = path.join(dir, name);
  try {
    const stat = fs.lstatSync(file);
    if (!FILE_NAME.test(name) || !file.startsWith(dir + path.sep) || !stat.isFile() || stat.size > MAX_BYTES) return null;
  } catch { return null; }
  return { file, type: CONTENT_TYPES[name.split('.').pop().toLowerCase()] || 'application/octet-stream' };
}

module.exports = { charactersDir, packDir, packNames, listCharacters, characterImage };
