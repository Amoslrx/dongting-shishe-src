/* 下载字典数据源（一次性，用于离线生成子集）
   ------------------------------------------------------------------
   读音：mozillazg/pinyin-data（MIT）—— 一个字的**全部**读音
   释义：pwxcoo/chinese-xinhua（MIT，但内容源自新华字典，授权状态模糊）
         注意 word.json 有 26 MB，jsDelivr 拒收超过 20 MB 的文件，只能走 raw

   用法：node tools/fetch-dict.js
   产物：_build/dict/pinyin.txt、_build/dict/word.json
*/
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '_build', 'dict');

const SOURCES = [
  {
    name: 'pinyin.txt',
    urls: [
      'https://cdn.jsdelivr.net/gh/mozillazg/pinyin-data@master/pinyin.txt',
      'https://raw.githubusercontent.com/mozillazg/pinyin-data/master/pinyin.txt',
    ],
    expectKB: 900,
  },
  {
    name: 'word.json',
    urls: [
      // 26 MB，jsDelivr 拿不到（限 20 MB），只能用 raw
      'https://raw.githubusercontent.com/pwxcoo/chinese-xinhua/master/data/word.json',
      'https://raw.gitmirror.com/pwxcoo/chinese-xinhua/master/data/word.json',
    ],
    expectKB: 20000,
  },
];

const mb = b => (b / 1048576).toFixed(2) + ' MB';

async function grab(src) {
  const dest = path.join(OUT, src.name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > src.expectKB * 1024) {
    console.log(`✓ ${src.name} 已存在（${mb(fs.statSync(dest).size)}），跳过`);
    return true;
  }
  for (const url of src.urls) {
    for (let i = 1; i <= 3; i++) {
      try {
        process.stdout.write(`  下载 ${src.name} ← ${url.split('/')[2]} 第${i}次 … `);
        const r = await fetch(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < src.expectKB * 1024) throw new Error(`只有 ${mb(buf.length)}，疑似被截断`);
        fs.writeFileSync(dest, buf);
        console.log(`OK ${mb(buf.length)}`);
        return true;
      } catch (e) { console.log('失败: ' + e.message); }
    }
  }
  console.log(`✗ ${src.name} 全部失败`);
  return false;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const s of SOURCES) await grab(s);
  console.log('\n_build/dict 内容：');
  for (const f of fs.readdirSync(OUT)) {
    console.log(`  ${f.padEnd(16)} ${mb(fs.statSync(path.join(OUT, f)).size)}`);
  }
})();
