/* AI 批量生成配图（LiblibAI 开放平台）
   ------------------------------------------------------------
   用法：
     node tools/gen-art.js --only guanhe --count 2 --debug   # 只跑一首，出 2 张，打全响应
     node tools/gen-art.js                                    # 跑全部 11 首
     node tools/gen-art.js --list                             # 只看会生成哪些

   产物：_build/art/<slug>.jpg
   之后跑 python tools/make-art-webp.py 压成两档 WebP 直接上线。

   ⚠️ 会消耗平台算力/余额。先加 --only 用一首试探，确认效果再跑全部。
*/
const fs = require('fs');
const path = require('path');
const { status, text2img } = require('./liblib');

const ROOT = path.join(__dirname, '..');
const OUT  = path.join(ROOT, '_build', 'art');

/* ============================================================
   ★ 生成参数（改这里）
   ============================================================ */
const MODEL = {
  // 真实的文生图模板 ID（取自 LiblibAI Go SDK 的可用示例）
  templateUuid: '6f7c4652458d4802969f8d089cf5b91f',
  // 底模 ID：可留空。留空时不传这个字段
  checkPointId: '',
  // 水墨 LoRA：⚠️ 这里要填的是「版本 ID」，不是模型 ID！
  //   模型页地址 .../modelinfo/<模型ID>?versionUuid=<版本ID>
  //   填错会报 AiModelVersion not found
  //   当前：F.1 国画|水墨山水（用户选定）
  lora: { modelId: '985d8c2647fd4d7fa675a1f53abc14e6', weight: 0.8 },
  width: 832,
  height: 1216,          // 竖幅，为竖排题款预留
  steps: 25,
  cfgScale: 6,           // 水墨别调高，高了发灰发僵
  seed: 20260919,        // ⚠️ 固定种子，保证一批风格一致（-1 是随机）
  sampler: 0,
  clipSkip: 2,
};

/* 「文字 / 印章」绝对不能漏 —— 否则 AI 会在角落画出鬼画符 */
const NEGATIVE = [
  '文字, 书法, 印章, 题款, 落款, 题跋, 签名, 水印',
  '彩色, 艳丽, 高饱和, 工笔重彩, 照片, 写实, 3D渲染',
  '现代元素, 边框, 画框, 装裱, 人物正面特写',
  'low quality, blurry, text, calligraphy, signature, seal, stamp, watermark, frame',
].join(', ');

/* 一首诗只挑 1~2 个核心意象，贪多必糊 */
const PROMPTS = {
  wangui:     '水墨山水小品，远山含暮色，一间柴门茅舍透出温暖灯火，元人写意，纸本淡彩，暮色苍茫炊烟起，笔简意远，左侧大面积留白，竖幅',
  yuye:       '水墨写意，秋风夜雨中的梧桐落叶，窗内一灯如豆，南宋院体，绢本水墨，夜色深沉墨气淋漓，右上大面积留白，竖幅',
  shanxing:   '水墨山水，蜿蜒石径没入云中，苍松数株挺立，元人写意，纸本水墨，云雾缭绕空灵，右侧大面积留白，竖幅',
  guanhe:     '水墨写意残荷，一枝枯蓬低垂，蜻蜓停于莲蓬之上，南宋院体，绢本水墨淡彩，萧疏清冷秋塘意，右侧大面积留白，竖幅',
  qiuxing:    '水墨山水，远山孤城，一行归雁南飞，元人写意，纸本水墨，霜意萧疏木叶尽脱，左侧大面积留白，竖幅',
  huanxisha:  '水墨淡彩，夏日绿荫浓密，一只蝉伏于枝干，明吴门画风，纸本设色，雨后清凉湿润，右上大面积留白，竖幅',
  yezuo:      '水墨，一轮明月当空，几点流萤明灭，空廊一角，南宋院体，绢本水墨，夜色清冷寂静，右侧大面积留白，竖幅',
  jiushu:     '文人画，案头摊开的旧书卷与笔墨砚台，元人写意，纸本水墨，静谧怀旧尘封感，左下大面积留白，竖幅',
  zengbie:    '水墨，长亭古道，垂柳依依拂水，明吴门画风，绢本水墨，离愁淡淡烟霭，上方大面积留白，竖幅',
  cunju:      '水墨山水，山脚茅屋数间，门前水田如镜映天光，元人写意，纸本淡彩，田园清幽春耕意，右侧大面积留白，竖幅',
  xijiangyue: '文人画，窗前夜读，一盏灯一卷书，窗外一轮月色，南宋院体，绢本水墨，清寂幽远，左侧大面积留白，竖幅',
};

/* ============================================================ */

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const has = name => argv.includes('--' + name);

const sleep = ms => new Promise(r => setTimeout(r, ms));

const MAX_TRY = 5;   // 每首最多尝试次数。实测平台失败率约 1/3，「[-1]执行异常」重试通常就过

async function submit(slug, prompt, count) {
  const gp = {
    prompt,
    negativePrompt: NEGATIVE,
    width: MODEL.width,
    height: MODEL.height,
    imgCount: count,
    cfgScale: MODEL.cfgScale,
    randnSource: 0,
    seed: MODEL.seed,
    clipSkip: MODEL.clipSkip,
    sampler: MODEL.sampler,
    steps: MODEL.steps,
    restoreFaces: 0,
  };
  if (MODEL.checkPointId) gp.checkPointId = MODEL.checkPointId;   // 留空就不传，避免无效 ID 报错
  if (MODEL.lora) gp.additionalNetwork = [{ modelId: MODEL.lora.modelId, weight: MODEL.lora.weight }];
  return text2img({ templateUuid: MODEL.templateUuid, generateParams: gp });
}

async function waitFor(uuid, debug, maxTry = 60) {
  for (let i = 1; i <= maxTry; i++) {
    await sleep(5000);
    const r = await status(uuid);
    const d = r.data || {};
    const st = d.generateStatus ?? d.status;
    if (debug) console.log(`    [轮询 ${i}] status=${st} ${d.generateMsg || ''} 图=${(d.images || []).length}`);

    // 状态：1 等待 / 2 生成中 / 3 成功 / 4 失败 / 5 审核 / 6 执行异常（实测「[-1]执行异常」就是 6）
    if (st === 3 || st === 5) return d;
    if (st === 4 || st === 6) {
      throw new Error(`生成失败 status=${st} msg=${d.generateMsg || '(无信息)'}`);
    }
  }
  throw new Error('轮询超时（任务可能还在排队）');
}

async function download(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('下载失败 HTTP ' + r.status);
  const b = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, b);
  return b.length;
}

(async () => {
  if (has('list')) {
    console.log('会生成以下配图：');
    for (const s of Object.keys(PROMPTS)) console.log('  ' + s.padEnd(11) + PROMPTS[s].slice(0, 34) + '…');
    return;
  }

  const only  = flag('only', null);
  const count = Number(flag('count', 1));
  const debug = has('debug');
  const skip  = has('skip-existing');        // 跳过已有图的作品，方便补跑失败的
  let slugs = only ? [only] : Object.keys(PROMPTS);
  fs.mkdirSync(OUT, { recursive: true });
  if (skip) slugs = slugs.filter(s => !fs.existsSync(path.join(OUT, s + '.png')) && !fs.existsSync(path.join(OUT, s + '.jpg')));
  const picks = {};

  console.log(`准备生成 ${slugs.length} 首 × ${count} 张   尺寸 ${MODEL.width}x${MODEL.height}  seed ${MODEL.seed}\n`);

  for (const slug of slugs) {
    const prompt = PROMPTS[slug];
    if (!prompt) { console.log(`✗ 没有 ${slug} 的提示词`); continue; }

    // 平台实测不稳定：同一套参数会无规律地返回 status=6「[-1]执行异常」，
    // 重试往往就过了。所以每首最多试 MAX_TRY 次。
    let done = null, lastErr = '';
    for (let attempt = 1; attempt <= MAX_TRY; attempt++) {
      process.stdout.write(`→ ${slug}${attempt > 1 ? ` 第${attempt}次` : ''}  提交…`);
      let sub;
      try { sub = await submit(slug, prompt, count); }
      catch (e) { lastErr = '请求异常 ' + e.message; console.log(' ' + lastErr); await sleep(4000); continue; }

      if (debug && attempt === 1) console.log('\n   提交响应: ' + JSON.stringify(sub).slice(0, 600));
      if (sub.code !== 0 || !sub.data) { lastErr = `code=${sub.code} ${sub.msg}`; console.log(' ' + lastErr); await sleep(4000); continue; }

      const uuid = sub.data.generateUuid || sub.data.uuid;
      console.log(` uuid=${String(uuid).slice(0, 8)}…`);
      try { done = await waitFor(uuid, debug); break; }
      catch (e) { lastErr = e.message; console.log(`   ${e.message}`); }
      await sleep(4000);
    }
    if (!done) { console.log(`   ✗ ${slug} 试了 ${MAX_TRY} 次仍未成功：${lastErr}`); continue; }

    const urls = (done.images || []).map(i => i.imageUrl).filter(Boolean);
    if (!urls.length) { console.log('   没拿到图片地址: ' + JSON.stringify(done).slice(0, 300)); continue; }

    for (let i = 0; i < urls.length; i++) {
      // 平台返回的是 .png，别硬写成 .jpg（扩展名和内容不符会让下游工具出错）
      const ext = (urls[i].match(/\.(png|jpe?g|webp)(\?|$)/i) || [, 'png'])[1].toLowerCase();
      const name = urls.length > 1 ? `${slug}-${i + 1}.${ext}` : `${slug}.${ext}`;
      try {
        const size = await download(urls[i], path.join(OUT, name));
        // 键必须用 slug（不带扩展名）：make-art-webp.py 用它当输出文件名
        picks[slug] = {
          file: name,
          ai: true,
          credit: 'AI 生成 · LiblibAI',
          prompt,
          at: new Date().toISOString().slice(0, 10),
        };
        console.log(`   ✓ ${name}  ${(size / 1024).toFixed(0)} KB`);
      } catch (e) { console.log(`   ✗ ${name} ${e.message}`); }
    }
  }

  /* 写 manifest，供 make-art-webp.py 压缩时读取（含 AI 生成标识，合规要求） */
  const mf = path.join(OUT, 'manifest.json');
  let old = {};
  if (fs.existsSync(mf)) { try { old = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch {} }
  const merged = { ...old, ...picks };
  fs.writeFileSync(mf, JSON.stringify(merged, null, 2));
  console.log(`\n已更新 _build/art/manifest.json（共 ${Object.keys(merged).length} 条，本次新增 ${Object.keys(picks).length} 条）`);
  console.log('下一步：python tools/make-art-webp.py');
})().catch(e => console.log('ERR ' + e.message));
