// Chinese text → the phonemes Kokoro-82M-v1.1-zh was trained on: a port of misaki's ZHG2P(version='1.1') (hexgrad/misaki, Apache-2.0: zh.py, zh_frontend.py and tone_sandhi.py,
// themselves adapted from PaddleSpeech, Apache-2.0) to JavaScript, on packages the Chinese voices add to the install: pinyin-pro (MIT) for pypinyin and jieba-wasm (MIT) for jieba.
// Each syllable is written as its initial and final in Zhuyin (some finals as the CJK characters misaki chose for them) and its tone (1 to 5, 5 the neutral tone), the words of a
// segment joined by '/'. Numbers are first written in Chinese (as cn2an does), punctuation is the model's, and a stretch of Latin letters goes to `en` (English phonemes).
// A Traditional text (a call held for Taiwan) is read once converted to Simplified (opencc-js, MIT and Apache-2.0). Used by kokoro-worker.js. The test against misaki's own output is test/zh-g2p.test.js.
const UNK = '❓';
// ---- cn2an.transform(text, 'an2cn'), for what an agent writes: dates, fractions, percentages, °C, plain and decimal numbers
const D = '零一二三四五六七八九';
function int2cn(s) {
  s = s.replace(/^0+(?=\d)/, ''); if (/^0+$/.test(s)) return '零';
  const secs = []; for (let i = s.length; i > 0; i -= 4) secs.unshift(s.slice(Math.max(0, i - 4), i));
  const big = ['', '万', '亿', '万亿', '亿亿']; let out = '';
  secs.forEach((g, k) => {
    if (+g === 0) return; let part = '', zero = false; const p = g.padStart(4, '0');
    for (let j = 0; j < 4; j++) { const d = +p[j]; if (!d) { if (part || out) zero = true; continue; } if (zero) { part += '零'; zero = false; } part += D[d] + ['千', '百', '十', ''][j]; }
    out += part + big[secs.length - 1 - k];
  });
  return out.replace(/^一十/, '十');
}
const num2cn = (s) => { const neg = s.startsWith('-'); s = s.replace(/^-/, ''); const [a, b] = s.split('.'); return (neg ? '负' : '') + int2cn(a) + (b !== undefined ? '点' + [...b].map((d) => D[+d]).join('') : ''); };
function an2cn(t) {
  t = t.replace(/％/g, '%');
  t = t.replace(/(?:(\d{4}|\d{2})年)?(?:(0?[1-9]|1[0-2])月)?(?:([12]\d|3[01]|0?[1-9])日)?/g, (m, y, mo, d) => (!m || (!y && !mo && !d) ? m : (y ? [...y].map((x) => D[+x]).join('') + '年' : '') + (mo ? int2cn(mo) + '月' : '') + (d ? int2cn(d) + '日' : '')));
  t = t.replace(/(\d+)\/(\d+)/g, (m, a, b) => int2cn(b) + '分之' + int2cn(a));
  t = t.replace(/(-?\d+(?:\.\d+)?)%/g, (m, n) => '百分之' + num2cn(n));
  t = t.replace(/(\d+(?:\.\d+)?)℃/g, (m, n) => '摄氏' + num2cn(n) + '度');
  return t.replace(/-?\d+(?:\.\d+)?/g, (m) => num2cn(m));
}
const PUNCT = [['、', ', '], ['，', ', '], ['。', '. '], ['．', '. '], ['！', '! '], ['：', ': '], ['；', '; '], ['？', '? '], ['«', ' “'], ['»', '” '], ['《', ' “'], ['》', '” '], ['「', ' “'], ['」', '” '], ['【', ' “'], ['】', '” '], ['（', ' ('], ['）', ') ']];
const mapPunctuation = (t) => { for (const [a, b] of PUNCT) t = t.split(a).join(b); return t.trim(); };
// ---- pinyin, as pypinyin's strict INITIALS and FINALS_TONE3 (neutral tone 5) give it
const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's'];
const Y = { yi: 'i', ya: 'ia', ye: 'ie', yao: 'iao', you: 'iou', yan: 'ian', yin: 'in', yang: 'iang', ying: 'ing', yong: 'iong', yo: 'io', yu: 'v', yue: 've', yuan: 'van', yun: 'vn', wu: 'u', wa: 'ua', wo: 'uo', wai: 'uai', wei: 'uei', wan: 'uan', wen: 'uen', wang: 'uang', weng: 'ueng' };
function split(py) {   // 'zhuang4' → ['zh', 'uang4']; a character pinyin-pro left as it is → ['', the character]
  const m = /^([a-zü]+)([0-5])$/.exec(py.replace(/ü/g, 'v')); if (!m) return ['', py];
  let [, s, tone] = m; if (tone === '0') tone = '5';
  const ini = INITIALS.find((i) => s.startsWith(i) && s.length > i.length) || ''; let fin = s.slice(ini.length);
  if (!ini) fin = Y[s] || s;
  else { if ('jqx'.includes(ini)) fin = fin.replace(/^u/, 'v'); fin = fin === 'iu' ? 'iou' : fin === 'ui' ? 'uei' : fin === 'un' ? 'uen' : fin; }
  if (fin === 'i' && ['z', 'c', 's'].includes(ini)) fin = 'ii'; else if (fin === 'i' && ['zh', 'ch', 'sh', 'r'].includes(ini)) fin = 'iii';
  return [ini, fin + tone];
}
const ZH_MAP = { b: 'ㄅ', p: 'ㄆ', m: 'ㄇ', f: 'ㄈ', d: 'ㄉ', t: 'ㄊ', n: 'ㄋ', l: 'ㄌ', g: 'ㄍ', k: 'ㄎ', h: 'ㄏ', j: 'ㄐ', q: 'ㄑ', x: 'ㄒ', zh: 'ㄓ', ch: 'ㄔ', sh: 'ㄕ', r: 'ㄖ', z: 'ㄗ', c: 'ㄘ', s: 'ㄙ', a: 'ㄚ', o: 'ㄛ', e: 'ㄜ', ie: 'ㄝ', ai: 'ㄞ', ei: 'ㄟ', ao: 'ㄠ', ou: 'ㄡ', an: 'ㄢ', en: 'ㄣ', ang: 'ㄤ', eng: 'ㄥ', er: 'ㄦ', i: 'ㄧ', u: 'ㄨ', v: 'ㄩ', ii: 'ㄭ', iii: '十', ve: '月', ia: '压', ian: '言', iang: '阳', iao: '要', in: '阴', ing: '应', iong: '用', iou: '又', ong: '中', ua: '穵', uai: '外', uan: '万', uang: '王', uei: '为', uen: '文', ueng: '瓮', uo: '我', van: '元', vn: '云' };
for (const p of ';:,.!?/—…"()“” 12345R') ZH_MAP[p] = p;
// ---- tone sandhi (tone_sandhi.py)
const MUST_NEUTRAL = new Set('麻烦 麻利 鸳鸯 高粱 骨头 骆驼 马虎 首饰 馒头 馄饨 风筝 难为 队伍 阔气 闺女 门道 锄头 铺盖 铃铛 铁匠 钥匙 里脊 里头 部分 那么 道士 造化 迷糊 连累 这么 这个 运气 过去 软和 转悠 踏实 跳蚤 跟头 趔趄 财主 豆腐 讲究 记性 记号 认识 规矩 见识 裁缝 补丁 衣裳 衣服 衙门 街坊 行李 行当 蛤蟆 蘑菇 薄荷 葫芦 葡萄 萝卜 荸荠 苗条 苗头 苍蝇 芝麻 舒服 舒坦 舌头 自在 膏药 脾气 脑袋 脊梁 能耐 胳膊 胭脂 胡萝 胡琴 胡同 聪明 耽误 耽搁 耷拉 耳朵 老爷 老实 老婆 戏弄 将军 翻腾 罗嗦 罐头 编辑 结实 红火 累赘 糨糊 糊涂 精神 粮食 簸箕 篱笆 算计 算盘 答应 笤帚 笑语 笑话 窟窿 窝囊 窗户 稳当 稀罕 称呼 秧歌 秀气 秀才 福气 祖宗 砚台 码头 石榴 石头 石匠 知识 眼睛 眯缝 眨巴 眉毛 相声 盘算 白净 痢疾 痛快 疟疾 疙瘩 疏忽 畜生 生意 甘蔗 琵琶 琢磨 琉璃 玻璃 玫瑰 玄乎 狐狸 状元 特务 牲口 牙碜 牌楼 爽快 爱人 热闹 烧饼 烟筒 烂糊 点心 炊帚 灯笼 火候 漂亮 滑溜 溜达 温和 清楚 消息 浪头 活泼 比方 正经 欺负 模糊 槟榔 棺材 棒槌 棉花 核桃 栅栏 柴火 架势 枕头 枇杷 机灵 本事 木头 木匠 朋友 月饼 月亮 暖和 明白 时候 新鲜 故事 收拾 收成 提防 挖苦 挑剔 指甲 指头 拾掇 拳头 拨弄 招牌 招呼 抬举 护士 折腾 扫帚 打量 打算 打扮 打听 打发 扎实 扁担 戒指 懒得 意识 意思 悟性 怪物 思量 怎么 念头 念叨 别人 快活 忙活 志气 心思 得罪 张罗 弟兄 开通 应酬 庄稼 干事 帮手 帐篷 希罕 师父 师傅 巴结 巴掌 差事 工夫 岁数 屁股 尾巴 少爷 小气 小伙 将就 对头 对付 寡妇 家伙 客气 实在 官司 学问 字号 嫁妆 媳妇 媒人 婆家 娘家 委屈 姑娘 姐夫 妯娌 妥当 妖精 奴才 女婿 头发 太阳 大爷 大方 大意 大夫 多少 多么 外甥 壮实 地道 地方 在乎 困难 嘴巴 嘱咐 嘟囔 嘀咕 喜欢 喇嘛 喇叭 商量 唾沫 哑巴 哈欠 哆嗦 咳嗽 和尚 告诉 告示 含糊 吓唬 后头 名字 名堂 合同 吆喝 叫唤 口袋 厚道 厉害 千斤 包袱 包涵 匀称 勤快 动静 动弹 功夫 力气 前头 刺猬 刺激 别扭 利落 利索 利害 分析 出息 凑合 凉快 冷战 冤枉 冒失 养活 关系 先生 兄弟 便宜 使唤 佩服 作坊 体面 位置 似的 伙计 休息 什么 人家 亲戚 亲家 交情 云彩 事情 买卖 主意 丫头 丧气 两口 东西 东家 世故 不由 下水 下巴 上头 上司 丈夫 丈人 一辈 那个 菩萨 父亲 母亲 咕噜 邋遢 费用 冤家 甜头 介绍 荒唐 大人 泥鳅 幸福 熟悉 计划 扑腾 蜡烛 姥爷 照顾 喉咙 吉他 弄堂 蚂蚱 凤凰 拖沓 寒碜 糟蹋 倒腾 报复 逻辑 盘缠 喽啰 牢骚 咖喱 扫把 惦记'.split(' '));
const MUST_NOT_NEUTRAL = new Set('男子 女子 分子 原子 量子 莲子 石子 瓜子 电子 人人 虎虎 幺幺 干嘛 学子 哈哈 数数 袅袅 局地 以下 娃哈哈 花花草草 留得 耕地 想想 熙熙 攘攘 卵子 死死 冉冉 恳恳 佼佼 吵吵 打打 考考 整整 莘莘 落地 算子 家家户户 青青'.split(' '));
const SANDHI_PUNC = '、：，；。？！“”‘’\':,;.?!', X_ENG = new Set(['x', 'eng']);
const numeric = (c) => /\p{N}/u.test(c) || '零一二三四五六七八九十百千万亿两〇壹贰叁肆伍陆柒捌玖拾佰仟'.includes(c);   // Python's str.isnumeric() is true for the Chinese numerals too
const set5 = (f) => f.slice(0, -1) + '5', setT = (f, t) => f.slice(0, -1) + t, allThree = (fs) => fs.every((x) => x.endsWith('3'));
const MUST_ERHUA = new Set(['小院儿', '胡同儿', '范儿', '老汉儿', '撒欢儿', '寻老礼儿', '妥妥儿', '媳妇儿']);
const NOT_ERHUA = new Set('虐儿 为儿 护儿 瞒儿 救儿 替儿 有儿 一儿 我儿 俺儿 妻儿 拐儿 聋儿 乞儿 患儿 幼儿 孤儿 婴儿 婴幼儿 连体儿 脑瘫儿 流浪儿 体弱儿 混血儿 蜜雪儿 舫儿 祖儿 美儿 应采儿 可儿 侄儿 孙儿 侄孙儿 女儿 男儿 红孩儿 花儿 虫儿 马儿 鸟儿 猪儿 猫儿 狗儿 少儿'.split(' '));
const PHRASES = { 开户行: ['kai1', 'hu4', 'hang2'], 发卡行: ['fa4', 'ka3', 'hang2'], 放款行: ['fang4', 'kuan3', 'hang2'], 茧行: ['jian3', 'hang2'], 行号: ['hang2', 'hao4'], 各地: ['ge4', 'di4'], 借还款: ['jie4', 'huan2', 'kuan3'], 时间为: ['shi2', 'jian1', 'wei2'], 为准: ['wei2', 'zhun3'], 色差: ['se4', 'cha1'], 嗲: ['dia3'], 呗: ['bei5'], 不: ['bu4'], 咗: ['zuo5'], 嘞: ['lei5'], 掺和: ['chan1', 'huo5'] };   // misaki's own corrections to pypinyin

function make(pinyinPro, jieba, t2s, { CONTEXT = true, HMM = true } = {}) {   // t2s: Traditional → Simplified (opencc-js), the same sounds in the characters pinyin-pro and jieba know best (還 hai, 車 che, 麼 me)
  const PY = { toneType: 'num', type: 'array', toneSandhi: false, v: true }; let ctx = null;   // ctx: the pinyin of the whole stretch, read once with its context, which pinyin-pro needs to pick the reading of a character alone (了 le, 只 zhi3)
  const pys = (word, at) => {   // one pinyin per character, without pinyin-pro's own tone sandhi (applied below, as misaki does); '地' alone is de (load_single_dict)
    if (PHRASES[word]) return PHRASES[word].slice();
    const w = [...word], out = ctx && at != null && ctx.text.slice(at, at + w.length).join('') === word ? ctx.py.slice(at, at + w.length) : pinyinPro.pinyin(word, PY);
    return w.map((c, i) => (c === '嗯' ? 'n2' : word === '地' ? 'de5' : out[i] || c));
  };
  const finalsOf = (word, at) => pys(word, at).map((p) => split(p)[1]);
  const splitWord = (word) => {   // _split_word: the shortest search segment, and what is left of the word
    const list = jieba.cut_for_search(word, true).sort((a, b) => a.length - b.length), first = list[0];
    return word.indexOf(first) === 0 ? [first, word.slice(first.length)] : [word.slice(0, -first.length), first];
  };
  function neutral(word, pos, f) {
    if (MUST_NOT_NEUTRAL.has(word)) return f;
    const w = [...word];
    w.forEach((c, j) => { if (j >= 1 && c === w[j - 1] && 'nva'.includes(pos[0])) f[j] = set5(f[j]); });
    const ge = w.indexOf('个'), last = w[w.length - 1];
    if ('吧呢啊呐噻嘛吖嗨呐哦哒滴哩哟喽啰耶喔诶'.includes(last)) f[f.length - 1] = set5(f[f.length - 1]);
    else if ('的地得'.includes(last)) f[f.length - 1] = set5(f[f.length - 1]);
    else if (w.length === 1 && '了着过'.includes(word) && ['ul', 'uz', 'ug'].includes(pos)) f[f.length - 1] = set5(f[f.length - 1]);
    else if (w.length > 1 && '们子'.includes(last) && ['r', 'n'].includes(pos)) f[f.length - 1] = set5(f[f.length - 1]);
    else if (w.length > 1 && '上下'.includes(last) && ['s', 'l', 'f'].includes(pos)) f[f.length - 1] = set5(f[f.length - 1]);
    else if (w.length > 1 && '来去'.includes(last) && '上下进出回过起开'.includes(w[w.length - 2])) f[f.length - 1] = set5(f[f.length - 1]);
    else if ((ge >= 1 && (numeric(w[ge - 1]) || '几有两半多各整每做是'.includes(w[ge - 1]))) || word === '个') f[ge] = set5(f[ge]);
    else if (MUST_NEUTRAL.has(word) || MUST_NEUTRAL.has(w.slice(-2).join(''))) f[f.length - 1] = set5(f[f.length - 1]);
    const parts = splitWord(word), n0 = [...parts[0]].length, fl = [f.slice(0, n0), f.slice(n0)];
    parts.forEach((p, i) => { const pw = [...p]; if (fl[i].length && (MUST_NEUTRAL.has(p) || MUST_NEUTRAL.has(pw.slice(-2).join('')))) fl[i][fl[i].length - 1] = set5(fl[i][fl[i].length - 1]); });
    return fl[0].concat(fl[1]);
  }
  function bu(word, f) {
    const w = [...word];
    if (w.length === 3 && w[1] === '不') f[1] = set5(f[1]);
    else w.forEach((c, i) => { if (c === '不' && i + 1 < w.length && f[i + 1].endsWith('4')) f[i] = setT(f[i], '2'); });
    return f;
  }
  function yi(word, f) {
    const w = [...word];
    if (w.includes('一') && w.filter((c) => c !== '一').every(numeric)) return f;
    if (w.length === 3 && w[1] === '一' && w[0] === w[2]) f[1] = set5(f[1]);
    else if (word.startsWith('第一')) f[1] = setT(f[1], '1');
    else w.forEach((c, i) => { if (c === '一' && i + 1 < w.length) { if ('45'.includes(f[i + 1].slice(-1))) f[i] = setT(f[i], '2'); else if (!SANDHI_PUNC.includes(w[i + 1])) f[i] = setT(f[i], '4'); } });
    return f;
  }
  function three(word, f) {
    const n = [...word].length;
    if (n === 2 && allThree(f)) f[0] = setT(f[0], '2');
    else if (n === 3) {
      const parts = splitWord(word), n0 = [...parts[0]].length;
      if (allThree(f)) { if (n0 === 2) { f[0] = setT(f[0], '2'); f[1] = setT(f[1], '2'); } else if (n0 === 1) f[1] = setT(f[1], '2'); }
      else {
        const fl = [f.slice(0, n0), f.slice(n0)];
        fl.forEach((sub, i) => {
          if (allThree(sub) && sub.length === 2) sub[0] = setT(sub[0], '2');
          else if (i === 1 && !allThree(sub) && sub[0] && sub[0].endsWith('3') && fl[0].length && fl[0][fl[0].length - 1].endsWith('3')) fl[0][fl[0].length - 1] = setT(fl[0][fl[0].length - 1], '2');
        });
        f = fl[0].concat(fl[1]);
      }
    } else if (n === 4) { const fl = [f.slice(0, 2), f.slice(2)]; f = []; for (const sub of fl) { if (allThree(sub)) sub[0] = setT(sub[0], '2'); f.push(...sub); } }
    return f;
  }
  const modified = (word, pos, f) => three(word, neutral(word, pos, yi(word, bu(word, f))));
  // pre_merge_for_modify: words merged before the sandhi, so that it sees them whole
  function premerge(seg) {   // seg: [word, pos, offset of its first character]
    let s = [];
    seg.forEach(([w, p, at], i) => { if (!X_ENG.has(p) && i > 0 && seg[i - 1][0] === '不') { w = '不' + w; at = seg[i - 1][2]; } const np = i + 1 < seg.length ? seg[i + 1][1] : null; if (w !== '不' || np === null || X_ENG.has(np)) s.push([w, p, at]); });
    seg = s; s = []; let skip = false;
    seg.forEach(([w, p, at], i) => { if (skip) { skip = false; return; } if (i >= 1 && w === '一' && i + 1 < seg.length && seg[i - 1][0] === seg[i + 1][0] && seg[i - 1][1] === 'v' && !X_ENG.has(seg[i + 1][1])) { s[s.length - 1] = [s[s.length - 1][0] + '一' + seg[i + 1][0], s[s.length - 1][1], s[s.length - 1][2]]; skip = true; } else s.push([w, p, at]); });
    seg = s; s = [];
    seg.forEach(([w, p, at]) => { if (s.length && s[s.length - 1][0] === '一' && !X_ENG.has(p)) s[s.length - 1] = [s[s.length - 1][0] + w, s[s.length - 1][1], s[s.length - 1][2]]; else s.push([w, p, at]); });
    seg = s; s = [];
    seg.forEach(([w, p, at]) => { if (s.length && w === s[s.length - 1][0] && !X_ENG.has(p)) s[s.length - 1][0] += w; else s.push([w, p, at]); });
    const redup = (w) => [...w].length === 2 && [...w][0] === [...w][1];
    for (const rule of [(a, b) => allThree(a) && allThree(b), (a, b) => a[a.length - 1].endsWith('3') && b[0].endsWith('3')]) {
      seg = s; s = []; const fl = seg.map(([w, p, at]) => (X_ENG.has(p) ? ['0'] : finalsOf(w, at))), merged = seg.map(() => false);
      seg.forEach(([w, p, at], i) => {
        if (!X_ENG.has(p) && i >= 1 && rule(fl[i - 1], fl[i]) && !merged[i - 1] && !redup(seg[i - 1][0]) && [...seg[i - 1][0]].length + [...w].length <= 3) { s[s.length - 1][0] += w; merged[i] = true; }
        else s.push([w, p, at]);
      });
    }
    seg = s; s = [];
    seg.forEach(([w, p, at], i) => { if (i >= 1 && w === '儿' && !X_ENG.has(s[s.length - 1][1])) s[s.length - 1][0] += w; else s.push([w, p, at]); });
    return s;
  }
  function erhua(ini, fin, word, pos) {
    const w = [...word];
    fin.forEach((ph, i) => { if (i === fin.length - 1 && w[i] === '儿' && ph === 'er1') fin[i] = 'er2'; });
    if (!MUST_ERHUA.has(word) && (NOT_ERHUA.has(word) || ['a', 'j', 'nr'].includes(pos))) return [ini, fin];
    if (fin.length !== w.length) return [ini, fin];
    const ni = [], nf = [];
    fin.forEach((ph, i) => { if (i === fin.length - 1 && w[i] === '儿' && ['er2', 'er5'].includes(ph) && !NOT_ERHUA.has(w.slice(-2).join('')) && nf.length) nf[nf.length - 1] = nf[nf.length - 1].slice(0, -1) + 'R' + nf[nf.length - 1].slice(-1); else { ni.push(ini[i]); nf.push(ph); } });
    return [ni, nf];
  }
  const PUNC = new Set([...';:,.!?—…"()“”']);
  function frontend(text) {   // ZHFrontend.__call__
    const toks = [], tags = jieba.tag(text, HMM); let off = 0; const seg = tags.map((t) => { const at = off; off += [...t.word].length; return [t.word, t.tag, at]; });
    ctx = CONTEXT ? { text: [...text], py: pinyinPro.pinyin(text, PY) } : null;
    for (let [word, pos, at] of premerge(seg)) {
      const han = [...word].every((c) => c >= '一' && c <= '鿿');
      if (pos === 'x' && han) pos = 'X'; else if (pos !== 'x' && PUNC.has(word)) pos = 'x';
      const tk = { text: word, tag: pos, ws: '', ph: null };
      if (pos === 'x' || pos === 'eng') { if (word.trim()) { if (pos === 'x' && PUNC.has(word)) tk.ph = word; toks.push(tk); } else if (toks.length) toks[toks.length - 1].ws += word; continue; }
      else if (toks.length && !X_ENG.has(toks[toks.length - 1].tag) && !toks[toks.length - 1].ws) toks[toks.length - 1].ws = '/';
      const p = pys(word, at).map(split); let ini = p.map((x) => x[0]), fin = p.map((x) => x[1]);
      fin = modified(word, pos, fin); [ini, fin] = erhua(ini, fin, word, pos);
      const phones = []; ini.forEach((c, i) => { const v = fin[i]; if (c) phones.push(c); if (v && (!PUNC.has(v) || v !== c)) phones.push(v); });
      tk.ph = phones.join('_').replace(/_eR/g, '_er').replace(/R/g, '_R').replace(/(?=\d)/g, '_').split('_').map((x) => ZH_MAP[x] ?? UNK).join('');
      toks.push(tk);
    }
    return toks.map((t) => (t.ph === null ? UNK : t.ph) + t.ws).join('');
  }
  return async function g2p(text, en) {   // ZHG2P.__call__ (version 1.1); en: a stretch of Latin letters → its phonemes
    if (!text.trim()) return '';
    text = mapPunctuation(an2cn(t2s ? t2s(text) : text)); const out = [];
    for (const m of text.matchAll(/([A-Za-z '-]*[A-Za-z][A-Za-z '-]*)|([^A-Za-z]+)/g)) {
      const e = (m[1] || '').trim(), z = (m[2] || '').trim();
      if (z) out.push(frontend(z)); else if (e) out.push(en ? await en(e) : UNK);
    }
    return out.join(' ');
  };
}
module.exports = { make, an2cn, split, UNK };
