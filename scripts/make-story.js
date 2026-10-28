// Turns the launch video into a vertical 1080x1920 story (Instagram / TikTok / Shorts): the landscape video sits on a blurred copy of itself,
// with a title above and a call to action below, both inside the safe zone (the app UI covers about the top 14% and bottom 20%).
//   node scripts/make-story.js            → docs/media/story.mp4 (EN) and story-fr.mp4 (FR) from promo.mp4 / promo-fr.mp4, and story-sessions*.mp4 from promo-sessions*.mp4 when they are there
//   node scripts/make-story.js sessions   → only the stories whose video has that word in its name
const path = require('path'), os = require('os'), fs = require('fs'), { execFileSync } = require('child_process');
const media = path.join(__dirname, '../docs/media'), BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf', REG = '/System/Library/Fonts/Helvetica.ttc';
const TXT = {
  en: { brand: 'DOUBLE GESTE', title: 'Agent Standup', sub: 'Your Claude Code agents in a video call', cta1: 'Free VS Code extension  -  open source', cta2: 'Link in bio' },
  fr: { brand: 'DOUBLE GESTE', title: 'Agent Standup', sub: 'Vos agents Claude Code en visio', cta1: 'Extension VS Code gratuite  -  open source', cta2: 'Lien en bio' },
};
const JOBS = [['en', 'promo.mp4'], ['fr', 'promo-fr.mp4'], ['en', 'promo-sessions.mp4', 'New in 1.31 - several sessions at once'], ['fr', 'promo-sessions-fr.mp4', 'Nouveau en 1.31 - plusieurs sessions à la fois']];   // [language, video, its own line under the title]
for (const [lang, file, sub] of JOBS) {
  if (!file.includes(process.argv[2] || '') || !fs.existsSync(path.join(media, file))) continue;
  const t = { ...TXT[lang], ...(sub ? { sub } : {}) }, dt = (text, font, size, y, color = 'white', extra = '') => `drawtext=fontfile='${font}':text='${text}':fontsize=${size}:fontcolor=${color}:x=(w-text_w)/2:y=${y}${extra}`;
  const graph = [
    '[0:v]split[a][b]',
    '[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=45:6,eq=brightness=-0.22:saturation=1.1[bg]',
    '[b]scale=1080:-2[fg]',
    '[bg][fg]overlay=0:(H-h)/2[v1]',
    '[v1]' + [
      dt(t.brand, BOLD, 34, 300, '0xF5C04AFF', ':box=0'),
      dt(t.title, BOLD, 96, 360),
      dt(t.sub, REG, 44, 490, '0xE9EAF0FF'),
      dt(t.cta1, REG, 40, 1360, 'white', ':box=1:boxcolor=0x000000AA:boxborderw=18'),
      dt(t.cta2, BOLD, 54, 1450, '0xF5C04AFF'),
    ].join(',') + '[out]',
  ].join(';');
  const gf = path.join(os.tmpdir(), `story-${lang}.txt`); fs.writeFileSync(gf, graph);
  const out = path.join(media, file.replace('promo', 'story'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(media, file), '-filter_complex_script', gf, '-map', '[out]', '-map', '0:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-r', '30', '-c:a', 'copy', '-movflags', '+faststart', out]);
  console.log(out);
}
