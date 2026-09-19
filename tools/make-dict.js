/* 生成字典子集：只含页面实际用到的字（读音 + 常用义项）
   ------------------------------------------------------------------
   为什么做子集：
     · 全量字典 26 MB，页面上出现过的字只有 585 个，用不到 1/20
     · 读音全量 962 KB，子集后几 KB
   数据来源：
     · 读音 mozillazg/pinyin-data（MIT）—— 一个字的**全部**读音，多音字靠它
     · 释义 pwxcoo/chinese-xinhua（MIT 声明，但内容源自新华字典，授权状态模糊）
   ⚠️ 加了新诗之后要重跑本脚本，否则新出现的字点开是空的（和字体子集同一个坑）

   用法：node tools/make-dict.js [--sample]
   产物：dict.json（放站点根目录，首次点字时按需加载）
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DICT = path.join(ROOT, '_build', 'dict');
const OUT  = path.join(ROOT, 'dict.json');

/* 与字体子集脚本同一套逻辑：剥掉注释后抽取汉字 */
function pageChars() {
  let t = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  t = t.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  return new Set(t.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []);
}

/* 「pinyin.txt」格式：U+3007: líng,yuán,xīng  # 〇 */
function loadReadings(want) {
  const map = new Map();
  for (const line of fs.readFileSync(path.join(DICT, 'pinyin.txt'), 'utf8').split('\n')) {
    const m = line.match(/^U\+([0-9A-Fa-f]+):\s*([^#]+)/);
    if (!m) continue;
    const ch = String.fromCodePoint(parseInt(m[1], 16));
    if (!want.has(ch)) continue;
    const list = m[2].split(',').map(s => s.trim()).filter(Boolean);
    map.set(ch, [...new Set(list)]);      // 原数据里有重复（如「〇」的两个 líng）
  }
  return map;
}

/* 按读音分块解析 more 字段，每块取各自常用的义。
   ------------------------------------------------------------
   more 的真实结构（按行，不是按竖线——这个坑见文件末尾注释）：

     长1          ← 块头：「字」或「字+序号」
     (1)
     閘            ← 繁体/异体字
     cháng        ← ★ 这一块的读音（块内第一段纯拼音行）
     (2)
     (象形。…本义两点距离大)          ← 字源 + 本义
     (3)
     同本义。与短”相对 [be long in space]   ← 带 [英文] 标签的义项
     巽为长,为高。--《易·说卦》            ← 古文例句，丢掉
     …
     长2          ← 下一块（另一个读音）

   多音字要「分读音各自注义」，所以不能像以前那样全字取一条，
   必须按块取，每块配自己的读音。 */
const PY_RE = /^(?=.*[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü])[^0-9\u4e00-\u9fff]{1,14}$/;

function parseByReading(w) {
  const lines = String(w.more || '').split('\n').map(s => s.trim()).filter(Boolean);
  const head = new RegExp('^' + w.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\d*$');

  // 切块：遇到「字」或「字N」就开新块
  const blocks = [];
  let cur = null;
  for (const l of lines) {
    if (head.test(l)) { cur = []; blocks.push(cur); continue; }
    if (cur) cur.push(l);
  }

  const byPy = new Map();     // 读音 → 义（同一读音可能有多块，取第一条非空）
  for (const blk of blocks) {
    const pyLine = blk.find(l => PY_RE.test(l));
    if (!pyLine) continue;
    const py = pyLine.toLowerCase();

    // 本义：这一块自己的字源行
    const benyi = (blk.join('\n').match(/本义[:：]?\s*([^)）\n]+)/) || [])[1];

    // 义项：块内第一条带 [英文] 标签的（那是词典的正式义项，例句行没有标签）
    const sense = blk.find(l => /\[[A-Za-z][^\]]*\]\s*$/.test(l) && !PY_RE.test(l));
    let def = '';
    if (sense) {
      def = sense.replace(/\s*\[[^\]]*\]\s*$/, '')
                 .replace(/^\[[^\]]*\]\s*[:：∶]?\s*/, '')
                 .replace(/^同本义[。，、]?/, '')
                 .split(/--|—{2}/)[0]
                 .replace(/^[\u4e00-\u9fff][，,]\s*/, '')
                 .replace(/[。；]\s*$/, '')
                 .trim();
    }
    if (!def || def.length < 2 || /^.{0,4}也$/.test(def)) def = benyi || '';
    if (benyi && def && !def.includes(benyi) && /^同本义/.test(sense || '')) def = `${benyi}；${def}`;
    if (!byPy.has(py) || (!byPy.get(py) && def)) byPy.set(py, def);
  }
  return byPy;
}

/* 组装输出：读音用 pinyin-data（权威、全），义按读音配。
   pinyin-data 给的读音可能比字典覆盖的多（如「能」有 5 个），
   多出来的只列读音、不配义，前端会单独一行提示。 */
function buildEntry(w, readings) {
  const byPy = w ? parseByReading(w) : new Map();
  const defs = [];
  for (const py of readings) {
    const hit = byPy.get(py.toLowerCase()) || byPy.get(py.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()) || '';
    if (hit) defs.push({ py, def: hit });
  }
  // 字典里出现了、但 pinyin-data 没给的读音，也补进去（宁多勿漏）
  for (const [py, def] of byPy) {
    if (def && !defs.some(d => d.py.toLowerCase() === py)) defs.push({ py, def });
  }
  return { py: readings, defs };
}

(function main() {
  const chars = pageChars();
  const readings = loadReadings(chars);
  const words = JSON.parse(fs.readFileSync(path.join(DICT, 'word.json'), 'utf8'));
  const byWord = new Map(words.map(w => [w.word, w]));

  const out = {};
  let noReading = [], noDef = [], empty = [], multi = 0, withDefs = 0;
  for (const c of [...chars].sort()) {
    const py = readings.get(c) || [];
    const w = byWord.get(c);
    const entry = buildEntry(w, py);
    if (!py.length) noReading.push(c);
    if (!w) noDef.push(c);
    if (!entry.py.length && !entry.defs.length) { empty.push(c); continue; }
    if (entry.defs.length > 1) multi++;
    if (entry.defs.length) withDefs++;
    out[c] = entry;
  }

  const json = JSON.stringify(out);
  fs.writeFileSync(OUT, json);
  const kb = (json.length / 1024).toFixed(1);

  console.log(`页面用字 ${chars.size} 个`);
  console.log(`  有读音 ${chars.size - noReading.length} 个${noReading.length ? '，无读音：' + noReading.join('') : ''}`);
  console.log(`  有释义 ${withDefs} 个，其中**多音字 ${multi} 个**（已按读音分别注义）`);
  if (noDef.length) console.log(`  字典里没有：${noDef.slice(0, 30).join('')}`);
  console.log(`  完全没资料跳过 ${empty.length} 个`);
  console.log(`\n已写出 dict.json：${kb} KB 字符（磁盘约 ${(json.length * 1.5 / 1024).toFixed(0)} KB，gzip 后约 ${(json.length / 1024 / 3).toFixed(0)} KB）`);

  const fmt = e => (e.defs && e.defs.length)
    ? e.defs.map(d => `${d.py}：${d.def}`).join('　｜　')
    : '（仅读音）';

  if (process.argv.includes('--sample')) {
    console.log('\n===== 抽查 16 条 =====');
    const keys = [...chars].filter(c => out[c]).slice(0, 400);
    const step = Math.max(1, Math.floor(keys.length / 16));
    for (let i = 0; i < keys.length && i / step < 16; i += step) {
      console.log(`  ${keys[i]}  ${fmt(out[keys[i]])}`);
    }
  }
  if (process.argv.includes('--check')) {
    console.log('\n===== 重点核对：多音字是否分读音注义 =====');
    for (const c of ['长', '载', '还', '能', '绿', '发', '重', '行', '不', '为', '与', '观']) {
      if (out[c]) console.log(`  ${c}  ${fmt(out[c])}`);
    }
  }
})();
