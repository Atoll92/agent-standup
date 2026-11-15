// test/zh-g2p.test.js: the Chinese phonemes of zh-g2p.js against misaki's own (the Python front end the model was trained with), on lines like the call says them.
// pinyin-pro, jieba-wasm and opencc-js are dev dependencies here; in the app they are installed with the Chinese voices.
const test = require('node:test'), assert = require('node:assert');
const { make, an2cn, split } = require('../zh-g2p.js'), REF = require('./zh-misaki.json').lines;
const g2p = make(require('pinyin-pro'), require('jieba-wasm'), require('opencc-js').Converter({ from: 'tw', to: 'cn' })), en = async (w) => '<' + w + '>';
const syl = (s) => s.match(/[ㄅ-ㄩ十月压言阳要阴应用又中穵外万王为文我瓮元云ㄭ]+[1-5]R?/g) || [];

test('numbers are written in Chinese as cn2an writes them', () => {
  const cases = { '10%': '百分之十', '3.5%': '百分之三点五', '2024': '二千零二十四', '2026年11月14日': '二零二六年十一月十四日', '1.47.0': '一点四七.零', '404': '四百零四', '10': '十', '12': '十二', '101': '一百零一', '1001': '一千零一', '10000': '一万', '12345': '一万二千三百四十五', '100000000': '一亿', '0.5': '零点五', '-3': '负三', '1/2': '二分之一', '第1步': '第一步', 'server2.js': 'server二.js', '470MB': '四百七十MB', '007': '七', '50.5%': '百分之五十点五' };
  for (const [a, b] of Object.entries(cases)) assert.equal(an2cn(a), b, a);
});

test('pinyin becomes the initials and finals of pypinyin\'s strict style', () => {
  const cases = { zhuang4: ['zh', 'uang4'], yi1: ['', 'i1'], you3: ['', 'iou3'], yu2: ['', 'v2'], yuan2: ['', 'van2'], wei4: ['', 'uei4'], jiu4: ['j', 'iou4'], xiu1: ['x', 'iou1'], dui4: ['d', 'uei4'], lun4: ['l', 'uen4'], jun1: ['j', 'vn1'], que4: ['q', 've4'], lv4: ['l', 'v4'], zi3: ['z', 'ii3'], shi4: ['sh', 'iii4'], ri4: ['r', 'iii4'], de0: ['d', 'e5'], er2: ['', 'er2'] };
  for (const [a, b] of Object.entries(cases)) assert.deepEqual(split(a), b, a);
});

test('the phonemes match misaki\'s on nearly every syllable of the reference lines', async () => {
  let same = 0, all = 0, lines = 0;
  for (const [text, ref] of REF) { const out = await g2p(text, en), a = syl(ref), b = syl(out); all += a.length; a.forEach((x, k) => { if (b[k] === x) same++; }); if (out === ref) lines++; }
  assert.ok(same / all >= 0.985, `syllables the same as misaki: ${same}/${all}`); assert.ok(lines >= 80, `lines identical: ${lines}/${REF.length}`);
});

test('the rules that change a tone, and the rest of the line', async () => {
  const say = (t) => g2p(t, en);
  assert.equal(await say('你好'), 'ㄋㄧ2ㄏㄠ3', 'two third tones: the first becomes a second');
  assert.equal(await say('一个人。'), 'ㄧ2ㄍㄜ5/ㄖㄣ2.', '一 before a fourth tone is a second; 个 is neutral');
  assert.equal(await say('不对。'), 'ㄅㄨ2ㄉ为4.', '不 before a fourth tone is a second');
  assert.equal(await say('看一看。'), 'ㄎㄢ4ㄧ5ㄎㄢ4.', '一 between a verb repeated is neutral');
  assert.equal(await say('第一步'), 'ㄉㄧ4ㄧ1ㄅㄨ4', 'an ordinal keeps 一 in the first tone');
  assert.equal(await say('先生，谢谢。'), 'ㄒ言1ㄕㄥ5, ㄒㄝ4ㄒㄝ5.', 'a word that always ends neutral, and a repeated syllable');
  assert.equal(await say('一会儿'), 'ㄧ2ㄏ为R4', 'erhua: 儿 joins the syllable before it');
  assert.equal(await say('打开 package.json 看一下。'), 'ㄉㄚ3ㄎㄞ1 <package> . <json> ㄎㄢ4/ㄧ2ㄒ压4.', 'Latin letters go to the English phonemes, as misaki sends them');
  assert.equal(await say('還有什麼'), await say('还有什么'), 'Traditional is read as the same Simplified words');
  assert.equal(await say('   '), '');
});
