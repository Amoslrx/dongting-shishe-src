/* 从克利夫兰艺术博物馆 Open Access 拉取 CC0 中国古画当示例配图
   ------------------------------------------------------------------
   为什么要写成一脚本：以后你们换成社员自己的画，或者想换一批素材，
   改下面的 MAP 重跑即可，不用手工一张张下。

   授权说明：这些作品均为公有领域（作者逝世逾 50 年），
   馆方以 CC0 开放图片，可自由使用、修改、商用，无需授权。
   页面上仍会标注出处——这是规矩，也是品味。

   用法：node tools/fetch-art.js
   产物：_build/art/*.jpg（原图）+ _build/art/manifest.json（元数据）
   下一步：python tools/make-art-webp.py 压成网页用的 WebP
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_build', 'art');

/* 文件名 slug → 克利夫兰藏品编号 */
const MAP = {
  wangui:      '1955.302.4',      // 山水册页 → 晚归（山影溪声）
  yuye:        '1953.246',        // 风竹 → 雨夜（风来忽作千山响）
  shanxing:    '1955.302.2',      // 山水册页 → 山行（石径松风）
  guanhe:      '1979.27.1.6',     // 荷与石 → 观荷
  qiuxing:     '1955.302.7',      // 山水册页 → 秋兴（霜落孤城）
  huanxisha:   '1985.364',        // 草虫竹 → 浣溪沙（一蝉鸣）
  yezuo:       '1954.582',        // 月下诗人林逋 → 夜坐（萤月空廊）
  jiushu:      '1979.27.2.18',    // 茅屋读书 → 旧书
  zengbie:     '1982.53',         // 柳与鹊 → 赠别（柳色）
  cunju:       '1955.302.8',      // 山水册页 → 村居（结屋依山）
  xijiangyue:  '1978.49',         // 月下梅 → 西江月·夜读
};

const API = 'https://openaccess-api.clevelandart.org/api/artworks/';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = {};

  for (const [slug, acc] of Object.entries(MAP)) {
    try {
      const r = await fetch(`${API}?q=${encodeURIComponent(acc)}&cc0=1&has_image=1&limit=5`);
      const j = await r.json();
      const a = (j.data || []).find(x => x.accession_number === acc) || (j.data || [])[0];
      if (!a || !a.images || !a.images.web) { console.log(`✗ ${slug} (${acc}) 没找到可用图片`); continue; }

      const imgUrl = a.images.web.url.replace('http://', 'https://');
      const buf = Buffer.from(await (await fetch(imgUrl)).arrayBuffer());
      const file = `${slug}.jpg`;
      fs.writeFileSync(path.join(OUT, file), buf);

      manifest[slug] = {
        file,
        bytes: buf.length,
        w: a.images.web.width,
        h: a.images.web.height,
        title: a.title,
        date: a.creation_date || '',
        technique: a.technique || '',
        credit: a.creditline || 'Cleveland Museum of Art',
        page: a.url,
        accession: a.accession_number,
      };
      console.log(`✓ ${slug.padEnd(11)} ${(buf.length / 1024).toFixed(0).padStart(4)} KB  ${a.title}`);
    } catch (e) {
      console.log(`✗ ${slug} 出错: ${e.message}`);
    }
  }

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n共 ${Object.keys(manifest).length} 幅，清单写到 _build/art/manifest.json`);
})();
