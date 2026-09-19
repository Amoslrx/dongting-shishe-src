/* LiblibAI 开放平台调用封装
   ------------------------------------------------------------
   凭据从 .secrets.json 读（本地文件，不参与发布、已被 .gitignore 排除）
   签名规则：base64url( HMAC-SHA1(secretKey, 路径&毫秒时间戳&随机串) )，去掉 = 填充
*/
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HOST = 'https://openapi.liblibai.cloud';
const SECRETS = path.join(__dirname, '..', '.secrets.json');

function creds() {
  if (!fs.existsSync(SECRETS)) throw new Error('缺少 .secrets.json（放着 AccessKey / SecretKey）');
  // 去掉 BOM：Windows 上用 PowerShell 写 UTF-8 常常带上，会让 JSON.parse 直接报错
  const raw = fs.readFileSync(SECRETS, 'utf8').replace(/^\uFEFF/, '');
  const c = JSON.parse(raw).liblib;
  if (!c || !c.accessKey || !c.secretKey) throw new Error('.secrets.json 里的 liblib 字段不完整');
  return c;
}

/* 每次请求都要重新签（时间戳必须新鲜） */
function signedUrl(uri) {
  const c = creds();
  const ts = Date.now().toString();
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const sig = crypto.createHmac('sha1', c.secretKey)
    .update(`${uri}&${ts}&${nonce}`)
    .digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${HOST}${uri}?AccessKey=${c.accessKey}&Signature=${sig}&Timestamp=${ts}&SignatureNonce=${nonce}`;
}

async function api(uri, body) {
  const r = await fetch(signedUrl(uri), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { http: r.status, ...json };
}

/* 查询任务：提交后拿 generateUuid 轮询这个 */
const status = (uuid) => api('/api/generate/webui/status', { generateUuid: uuid });

/* 提交文生图任务 */
const text2img = (params) => api('/api/generate/webui/text2img', {
  templateUuid: params.templateUuid,
  generateParams: params.generateParams,
});

module.exports = { api, status, text2img, signedUrl, creds };

/* 直接 node tools/liblib.js 时做一次凭据自检 */
if (require.main === module) {
  (async () => {
    const c = creds();
    console.log('凭据读取 OK  accessKey 长度=' + c.accessKey.length + '  secretKey 长度=' + c.secretKey.length);
    console.log('\n--- 用无效 UUID 查任务，只为验证签名（不消耗算力）---');
    const r = await status('00000000-0000-0000-0000-000000000000');
    console.log(JSON.stringify(r, null, 2).slice(0, 700));
  })().catch(e => console.log('ERR ' + e.message));
}
