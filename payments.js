// Payment providers. Set PAY_MODE=live and fill the env vars below to enable.
//
// ============ 微信支付（Native V3） ============
// 需要的环境变量：
//   WECHAT_APPID              公众号 / 小程序 / 开放平台 AppID
//   WECHAT_MCH_ID             商户号
//   WECHAT_API_V3_KEY         APIv3 密钥（32 位）
//   WECHAT_MCH_SERIAL_NO      商户 API 证书序列号
//   WECHAT_MCH_PRIVATE_KEY    商户 API 证书私钥 PEM（支持 \n 转义）
//                             或：WECHAT_MCH_PRIVATE_KEY_FILE 指向 apiclient_key.pem 的绝对路径
//   WECHAT_PLATFORM_CERT      微信支付平台证书 PEM（支持 \n 转义）
//                             或：WECHAT_PLATFORM_CERT_FILE 绝对路径
//   (可选) WECHAT_PLATFORM_CERT_SERIAL  平台证书序列号；不填则默认信任任何 serial
//
// ============ 支付宝（当面付 / alipay.trade.precreate） ============
// 需要的环境变量：
//   ALIPAY_APP_ID
//   ALIPAY_APP_PRIVATE_KEY    应用私钥 PEM（支持 \n 转义）
//                             或：ALIPAY_APP_PRIVATE_KEY_FILE 绝对路径
//   ALIPAY_PUBLIC_KEY         支付宝公钥 PEM（支持 \n 转义）
//                             或：ALIPAY_PUBLIC_KEY_FILE 绝对路径
//   (可选) ALIPAY_GATEWAY     默认 https://openapi.alipay.com/gateway.do
//
// 申请凭证填完 .env 后，`PAY_MODE=live systemctl --user restart xiaofamoustalk` 即生效。

import crypto from 'node:crypto';
import fs from 'node:fs';

function loadPem(envInline, envFile) {
  const inline = process.env[envInline];
  if (inline) return inline.replace(/\\n/g, '\n');
  const file = process.env[envFile];
  if (file) return fs.readFileSync(file, 'utf8');
  return null;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`支付未配置：缺少环境变量 ${name}`);
  return v;
}

function rsaSign(data, privateKeyPem, algo = 'RSA-SHA256') {
  return crypto.createSign(algo).update(data).end().sign(privateKeyPem, 'base64');
}

function rsaVerify(data, signatureB64, publicKeyPem, algo = 'RSA-SHA256') {
  return crypto.createVerify(algo).update(data).end().verify(publicKeyPem, signatureB64, 'base64');
}

// ========================================================================
// 微信支付 Native V3
// ========================================================================

const WECHAT_BASE = 'https://api.mch.weixin.qq.com';

function wechatAuthHeader({ method, urlPath, body, mchId, serialNo, privateKey }) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = rsaSign(message, privateKey);
  return `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`;
}

async function createWeChatNativeOrder({ out_trade_no, amount, subject, notify_url }) {
  const appid = requireEnv('WECHAT_APPID');
  const mchid = requireEnv('WECHAT_MCH_ID');
  const serialNo = requireEnv('WECHAT_MCH_SERIAL_NO');
  const privateKey = loadPem('WECHAT_MCH_PRIVATE_KEY', 'WECHAT_MCH_PRIVATE_KEY_FILE');
  if (!privateKey) throw new Error('支付未配置：缺少商户私钥（WECHAT_MCH_PRIVATE_KEY 或 WECHAT_MCH_PRIVATE_KEY_FILE）');

  const urlPath = '/v3/pay/transactions/native';
  const payload = {
    appid,
    mchid,
    description: (subject || '商品').slice(0, 127),
    out_trade_no,
    notify_url,
    amount: { total: amount, currency: 'CNY' },
  };
  const body = JSON.stringify(payload);
  const authorization = wechatAuthHeader({
    method: 'POST',
    urlPath,
    body,
    mchId: mchid,
    serialNo,
    privateKey,
  });

  const res = await fetch(WECHAT_BASE + urlPath, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'xiaofamoustalk/1.0',
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`微信下单失败 ${res.status}: ${text}`);
  }
  const data = JSON.parse(text);
  if (!data.code_url) throw new Error('微信下单返回异常：无 code_url');
  return { code_url: data.code_url };
}

async function verifyWeChatNotify({ headers, rawBody }) {
  const platformCert = loadPem('WECHAT_PLATFORM_CERT', 'WECHAT_PLATFORM_CERT_FILE');
  const apiV3Key = process.env.WECHAT_API_V3_KEY;
  if (!platformCert || !apiV3Key) {
    return { ok: false, error: '平台证书或 APIv3 Key 未配置' };
  }

  const timestamp = headers['wechatpay-timestamp'];
  const nonce = headers['wechatpay-nonce'];
  const signature = headers['wechatpay-signature'];
  const serial = headers['wechatpay-serial'];
  if (!timestamp || !nonce || !signature) {
    return { ok: false, error: '缺少微信支付签名相关 header' };
  }
  const expectedSerial = process.env.WECHAT_PLATFORM_CERT_SERIAL;
  if (expectedSerial && serial && serial !== expectedSerial) {
    return { ok: false, error: `平台证书序列号不匹配: ${serial}` };
  }

  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const signed = `${timestamp}\n${nonce}\n${bodyStr}\n`;
  if (!rsaVerify(signed, signature, platformCert)) {
    return { ok: false, error: '微信平台签名验证失败' };
  }

  let envelope;
  try {
    envelope = JSON.parse(bodyStr);
  } catch {
    return { ok: false, error: '通知 body 不是合法 JSON' };
  }
  const resource = envelope.resource;
  if (!resource) return { ok: false, error: '通知缺少 resource 字段' };

  // AES-256-GCM 解密
  try {
    const ciphertext = Buffer.from(resource.ciphertext, 'base64');
    const authTag = ciphertext.subarray(ciphertext.length - 16);
    const data = ciphertext.subarray(0, ciphertext.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(resource.nonce, 'utf8'));
    decipher.setAuthTag(authTag);
    if (resource.associated_data) decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'));
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    const tx = JSON.parse(plaintext);
    return {
      ok: true,
      out_trade_no: tx.out_trade_no,
      transaction_id: tx.transaction_id,
      trade_state: tx.trade_state,
      raw: tx,
    };
  } catch (e) {
    return { ok: false, error: '解密失败：' + e.message };
  }
}

// ========================================================================
// 支付宝 当面付（alipay.trade.precreate）
// ========================================================================

const ALIPAY_GATEWAY_DEFAULT = 'https://openapi.alipay.com/gateway.do';

function alipaySortedQuery(params) {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '' && k !== 'sign')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

async function createAlipayOrder({ out_trade_no, amount, subject, notify_url }) {
  const appId = requireEnv('ALIPAY_APP_ID');
  const appPrivateKey = loadPem('ALIPAY_APP_PRIVATE_KEY', 'ALIPAY_APP_PRIVATE_KEY_FILE');
  if (!appPrivateKey) throw new Error('支付未配置：缺少应用私钥');

  const bizContent = {
    out_trade_no,
    total_amount: (amount / 100).toFixed(2),
    subject: (subject || '商品').slice(0, 255),
  };
  const params = {
    app_id: appId,
    method: 'alipay.trade.precreate',
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    version: '1.0',
    notify_url,
    biz_content: JSON.stringify(bizContent),
  };
  const signStr = alipaySortedQuery(params);
  params.sign = rsaSign(signStr, appPrivateKey);

  const gateway = process.env.ALIPAY_GATEWAY || ALIPAY_GATEWAY_DEFAULT;
  const body = new URLSearchParams(params).toString();
  const res = await fetch(gateway, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`支付宝下单失败 ${res.status}: ${text}`);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('支付宝返回非 JSON: ' + text); }
  const resp = data.alipay_trade_precreate_response;
  if (!resp) throw new Error('支付宝返回异常：' + text);
  if (resp.code !== '10000') {
    throw new Error(`支付宝下单失败 ${resp.code} ${resp.msg || ''} ${resp.sub_msg || ''}`);
  }
  if (!resp.qr_code) throw new Error('支付宝返回无 qr_code');
  return { code_url: resp.qr_code };
}

async function verifyAlipayNotify(body) {
  const publicKey = loadPem('ALIPAY_PUBLIC_KEY', 'ALIPAY_PUBLIC_KEY_FILE');
  if (!publicKey) return { ok: false, error: '支付宝公钥未配置' };

  const sign = body.sign;
  const signType = body.sign_type || 'RSA2';
  if (!sign) return { ok: false, error: '缺少 sign' };

  const filtered = { ...body };
  delete filtered.sign;
  delete filtered.sign_type;
  const signed = alipaySortedQuery(filtered);
  const algo = signType === 'RSA' ? 'RSA-SHA1' : 'RSA-SHA256';
  if (!rsaVerify(signed, sign, publicKey, algo)) {
    return { ok: false, error: '支付宝签名校验失败' };
  }

  return {
    ok: true,
    out_trade_no: body.out_trade_no,
    trade_no: body.trade_no,
    trade_status: body.trade_status,
    raw: body,
  };
}

// ========================================================================
// 对外入口
// ========================================================================

export async function createPayment(provider, opts) {
  if (provider === 'wechat') return createWeChatNativeOrder(opts);
  if (provider === 'alipay') return createAlipayOrder(opts);
  throw new Error('不支持的支付方式：' + provider);
}

export { verifyWeChatNotify, verifyAlipayNotify };
