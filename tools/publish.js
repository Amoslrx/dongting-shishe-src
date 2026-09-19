/* 一次性提交式发布  ——  Git Data API
   ============================================================
   为什么需要它：
     逐个文件调 Contents API = 一次提交一个文件。GitHub Pages 是
     「一次提交 = 一次构建」，所以传 23 个文件会触发 23 次构建，
     其中若干次会 errored，要等好几分钟才生效。
     改用 Git Data API（blobs → tree → commit → update ref），
     把整批文件做成**一次提交**，只触发一次构建。

   用法：
     node tools/publish.js --repo <仓库名> --dir <目录> [选项]

     --repo      仓库名（必填）
     --dir       要发布的目录（必填，比如 dist / handover）
     --owner     仓库所有者，默认当前登录用户
     --message   提交信息
     --branch    分支，默认 main
     --create    仓库不存在就创建（公开）
     --private   --create 时建私有仓库
     --dry       只列会提交哪些文件，不实际提交

   前置：环境变量 GH_TOKEN（或 GITHUB_TOKEN）
     在 PowerShell 里这样传（Node 在这个沙箱里取不到 gh 的输出，
     因为它靠命名管道，所以必须由外面传进来）：
        $env:GH_TOKEN = (gh auth token); node tools/publish.js --repo xxx --dir dist

   会自动跳过：.git/  .secrets.json  _build/  *.zip
*/
const fs = require('fs');
const path = require('path');

const API = 'https://api.github.com';

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const arg = (name, def = null) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def;
};
const has = name => argv.includes('--' + name);

const REPO    = arg('repo');
const DIR     = arg('dir');
const OWNER   = arg('owner');
const BRANCH  = arg('branch', 'main');
const MESSAGE = arg('message') || `发布更新 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
const TOKEN   = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

if (!REPO || !DIR) {
  console.error('用法：node tools/publish.js --repo <仓库名> --dir <目录> [--owner x] [--message x] [--create] [--dry]');
  process.exit(1);
}
if (!TOKEN) {
  console.error('缺少 GH_TOKEN。PowerShell 里这样传：\n  $env:GH_TOKEN = (gh auth token); node tools/publish.js ...');
  process.exit(1);
}

/* 这些永远不提交 */
const SKIP = [
  /(^|\/)\.git\//,
  /(^|\/)\.secrets\.json$/,
  /(^|\/)\.env/,
  /(^|\/)_build\//,
  /\.zip$/,
  /(^|\/)_/ ,          // 下划线开头的临时文件
];

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (SKIP.some(re => re.test(rel))) continue;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

async function api(method, url, body) {
  const r = await fetch(API + url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dongting-publish',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 200) }; }
  if (!r.ok && r.status !== 404) {
    const msg = json && json.message ? json.message : text.slice(0, 200);
    throw new Error(`${method} ${url} → HTTP ${r.status} ${msg}`);
  }
  return { status: r.status, json };
}

/* 并发上传 blob，避免 75 个文件串行等半天 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }));
  return out;
}

(async () => {
  const dir = path.resolve(DIR);
  if (!fs.existsSync(dir)) { console.error('目录不存在：' + dir); process.exit(1); }

  /* 0. 确认所有者 */
  let owner = OWNER;
  if (!owner) {
    const me = await api('GET', '/user');
    owner = me.json.login;
  }
  console.log(`仓库：${owner}/${REPO}   分支：${BRANCH}`);

  /* 1. 仓库不存在就创建 */
  const check = await api('GET', `/repos/${owner}/${REPO}`);
  if (check.status === 404) {
    if (!has('create')) {
      console.error(`仓库不存在。加 --create 让脚本自动创建，或先手动建好。`);
      process.exit(1);
    }
    const isPrivate = has('private');
    const created = await api('POST', '/user/repos', {
      name: REPO,
      private: isPrivate,
      description: '东亭诗社相关仓库（由 tools/publish.js 创建）',
      auto_init: false,
    });
    console.log(`  已创建${isPrivate ? '私有' : '公开'}仓库：${created.json.html_url}`);
  } else {
    console.log(`  仓库已存在：${check.json.html_url}`);
  }

  /* 2. 列文件 */
  const files = walk(dir);
  if (!files.length) { console.error('目录里没有可提交的文件'); process.exit(1); }
  const totalMB = files.reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0) / 1048576;
  console.log(`\n待提交 ${files.length} 个文件，共 ${totalMB.toFixed(2)} MB`);
  files.slice(0, 8).forEach(f => console.log('  ' + f));
  if (files.length > 8) console.log(`  …另 ${files.length - 8} 个`);

  if (has('dry')) { console.log('\n--dry：只列出，不提交'); return; }

  /* 3. 当前分支的父提交（空仓库就是没有） */
  let parentSha = null;
  let baseTree = null;
  const ref = await api('GET', `/repos/${owner}/${REPO}/git/ref/heads/${BRANCH}`);
  if (ref.status === 200) {
    parentSha = ref.json.object.sha;
    const parent = await api('GET', `/repos/${owner}/${REPO}/git/commits/${parentSha}`);
    baseTree = parent.json.tree.sha;
    console.log(`\n基于现有提交 ${parentSha.slice(0, 7)}`);
  } else {
    console.log('\n空仓库，创建首个提交');
  }

  /* 4. 建 blob（并发） */
  console.log('上传文件…');
  const blobs = await mapLimit(files, 6, async (rel) => {
    const buf = fs.readFileSync(path.join(dir, rel));
    const res = await api('POST', `/repos/${owner}/${REPO}/git/blobs`, {
      content: buf.toString('base64'),
      encoding: 'base64',
    });
    return { path: rel, mode: '100644', type: 'blob', sha: res.json.sha };
  });
  console.log(`  ${blobs.length} 个 blob 建好`);

  /* 5. 建 tree（带上 base_tree 才能保留未列出的旧文件；不传则整棵树重建） */
  const tree = await api('POST', `/repos/${owner}/${REPO}/git/trees`, {
    tree: blobs,
    ...(baseTree ? { base_tree: baseTree } : {}),
  });
  console.log(`  tree ${tree.json.sha.slice(0, 7)}`);

  /* 6. 建 commit —— 关键：整批文件只产生一个提交 */
  const commit = await api('POST', `/repos/${owner}/${REPO}/git/commits`, {
    message: MESSAGE,
    tree: tree.json.sha,
    parents: parentSha ? [parentSha] : [],
  });
  console.log(`  commit ${commit.json.sha.slice(0, 7)}  ${MESSAGE.split('\n')[0]}`);

  /* 7. 更新分支引用 */
  if (parentSha) {
    await api('PATCH', `/repos/${owner}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.json.sha, force: false });
  } else {
    await api('POST', `/repos/${owner}/${REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: commit.json.sha });
  }

  console.log(`\n✓ 完成：https://github.com/${owner}/${REPO}/tree/${BRANCH}`);
  console.log(`  一次提交 = 一次构建（对比：逐文件上传会触发 ${files.length} 次）`);
})().catch(e => { console.error('失败：' + e.message); process.exit(1); });
