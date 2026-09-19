/* 发布包完整性校验：把 index.html 里引用的所有本地资源找出来，
   逐个核对 dist 里是否真的存在。防止「传了页面、漏了图」这种事。 */
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

const refs = new Set();
for (const m of html.matchAll(/url\(['"]?(images\/[^'")]+)['"]?\)/g)) refs.add(m[1]);
for (const m of html.matchAll(/["'](images\/[^"']+)["']/g)) refs.add(m[1]);
// JS 里按需加载的资源（如 dict.json）不会出现在 url() 或 src 属性里，
// 但漏传了功能就是坏的、而且表现为「静默失效」—— 单独捞一把
for (const m of html.matchAll(/["']([A-Za-z0-9_-]+\.json)["']/g)) refs.add(m[1]);

let bad = 0, total = 0, bytes = 0;
console.log('index.html 引用的本地资源：');
for (const rel of [...refs].sort()) {
  total++;
  const p = path.join(DIST, rel);
  if (fs.existsSync(p)) { const s = fs.statSync(p).size; bytes += s; console.log(`  OK    ${rel.padEnd(34)} ${(s/1024).toFixed(1)} KB`); }
  else { bad++; console.log(`  缺失  ${rel}`); }
}

console.log('\ndist 目录里存在、但页面没引用的文件：');
const walk = (d, base = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(d, e.name), base + e.name + '/') : [base + e.name]);
const all = walk(DIST);
const unused = all.filter(f => ![...refs].some(r => r.endsWith(f.replace(/^images\//, 'images/')))) ;
for (const f of all) if (!refs.has(f) && !/\.(md|txt)$/.test(f) && !f.endsWith('manifest.json')) console.log('  ' + f);

console.log(`\n引用 ${total} 项，缺失 ${bad} 项`);
console.log(`发布包共 ${all.length} 个文件，图片合计 ${(bytes/1024).toFixed(0)} KB`);
const sec = all.filter(f => /secret|\.env|key|token/i.test(f));
console.log(sec.length ? '⚠ 发现疑似密钥文件：' + sec.join(', ') : '✓ 无密钥类文件');
console.log(bad === 0 ? '\n✓ 发布包完整，可以上传' : '\n✗ 有缺失，不要上传');
