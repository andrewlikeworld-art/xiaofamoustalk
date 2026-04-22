# 图片 / 视频存储迁移到阿里云 OSS · 评估与方案

> 最后更新：2026-04-22
> 状态：**评估中，未开工**。本文档只为决策服务，不包含任何已执行的动作。

---

## 1. 为什么要迁

| 现状 | 问题 |
|---|---|
| 所有图片 / 视频写 `/home/andrew/xiaofamoustalk/uploads/` 本地盘 | 请求要落地再由 Express 回吐，上传下载都占工作站带宽 |
| 公网通过 Cloudflare Tunnel 回源 | 上传约 170 KB/s，CF 免费套餐**单请求体 ≤100 MB**，长视频会 413 |
| 单点故障 | 本机盘坏 = uploads 全没（目前无异地备份） |
| uploads/ 和 DB（`/data/xiaofamous/`）分离不彻底 | uploads/ 在项目根，`git clean` 有灾难可能 |

## 2. 目标

- **读写都直连 OSS**：前端 PUT 直传 OSS，读 URL 直接走 OSS / CDN；工作站只做签名
- 现有 `/uploads/*` 能继续读，渐进迁移不停服
- 评论 / 产品两条上传通道都迁
- 保留随时切回本地存储的能力

## 3. 当前数据体量（2026-04-22 采样）

```
uploads/ 目录：32 MB，9 个文件
products 表：
  - 7 条 image 指向 /uploads/
  - 1 条 images（附图 JSON）指向 /uploads/
  - 0 条 video 指向 /uploads/
comments 表：
  - 0 条 image 指向 /uploads/
```

体量非常小，迁移本身是小时级动作。动脑主要花在架构稳健性上，不在数据量。

---

## 4. Bucket 设计

### 建议：单 bucket + 前缀分层

| 名称 | `xft-talk-uploads` |
|---|---|
| 区域 | **和 vlog-platform 的 `cfv-raw` 同区域**（复用 RAM 账号和 VPC / 减少跨区域费用）。如果 `cfv-raw` 在 `oss-cn-hangzhou`，这里也 `oss-cn-hangzhou` |
| 存储类型 | Standard（低频 / 归档都不合适，图片要高频读） |
| 读写权限 | **私有 bucket**；公开读通过 **Bucket Policy 针对 `public/` 前缀放行** 或前端带签名 URL（见 §7 讨论） |
| CORS | 允许 `PUT` 来自 `https://talk.xiaofamous.com`、`http://100.93.5.119:3000`、`http://workstation.tail9c7884.ts.net:3000`、`http://localhost:3000`；`GET` 允许 `*` |
| CDN | 可选。阿里云 CDN 绑 `cdn.xiaofamous.com` → OSS origin。一期可以不上 CDN，直连 OSS 外网域就够 |

### Key 结构

```
public/products/YYYY/MM/<uuid>.jpg          # 产品封面
public/products/YYYY/MM/<uuid>.jpg          # 附图
public/products/YYYY/MM/<uuid>.mp4          # 视频
public/comments/YYYY/MM/<uuid>.jpg          # 评论图片
```

按年月分文件夹便于将来按月做 lifecycle（如：3 年前的评论图转低频存储）。

### RAM 账号

新建 RAM 子账号 `xft-talk-backend`：

- 策略：仅允许对 `xft-talk-uploads` bucket 的 `PutObject` / `GetObject` / `DeleteObject` / `HeadObject`
- AccessKey 写进 `.env`（和现有 `ADMIN_PASSWORD` 一样处理）
- **不**直接下发给前端。前端只拿签名 URL（见 §6）

---

## 5. 上传方式：预签名 URL vs STS Token 对比

| | 预签名 URL（PUT） | STS 临时 Token |
|---|---|---|
| 实现复杂度 | 低。一行 `oss.signatureUrl` | 中。前端要引 `ali-oss` SDK |
| 前端依赖 | 零（原生 `fetch(PUT url, { body: file })`） | `ali-oss` 浏览器包 ~200KB |
| 大文件分片续传 | ❌ 不支持 | ✅ 支持 |
| Token 生效时长 | 5 分钟 | 15 分钟~1 小时 |
| 适合场景 | 压缩后图片（<500KB） | 视频（可能数十 MB） |

### 建议：**混合方案**

- **图片（封面 / 附图 / 评论）用预签名 PUT URL**：压缩后文件都 <1 MB，单请求搞定，前端零依赖
- **视频用 STS + `ali-oss` 分片上传**：视频 10-100MB 常见，分片可断点续传，也能避开 CF ~100MB 限制（OSS 单片 100KB~5GB 可调）

一期可以**只做图片预签名**，视频继续走旧路径（或借 P2 的 Tailscale 直连绕 CF）。这样 70% 的痛点能先解决。

---

## 6. 后端接口设计

### 6.1 签名路由

**`POST /api/admin/uploads/sign`**（管理员专用）

```json
// 请求
{
  "kind": "product-cover" | "product-extra" | "product-video",
  "filename": "cover.jpg",
  "mime": "image/jpeg",
  "size": 412033
}

// 响应（预签名 PUT）
{
  "method": "PUT",
  "url": "https://xft-talk-uploads.oss-cn-hangzhou.aliyuncs.com/public/products/2026/04/22/<uuid>.jpg?<signature>",
  "headers": { "Content-Type": "image/jpeg" },
  "publicUrl": "https://xft-talk-uploads.oss-cn-hangzhou.aliyuncs.com/public/products/2026/04/22/<uuid>.jpg",
  "objectKey": "public/products/2026/04/22/<uuid>.jpg",
  "expiresAt": 1776828901
}

// 响应（视频场景：STS）
{
  "method": "STS",
  "region": "oss-cn-hangzhou",
  "bucket": "xft-talk-uploads",
  "stsToken": {
    "AccessKeyId": "...",
    "AccessKeySecret": "...",
    "SecurityToken": "...",
    "Expiration": "2026-04-22T04:30:00Z"
  },
  "objectKey": "public/products/2026/04/22/<uuid>.mp4",
  "publicUrl": "https://.../public/products/2026/04/22/<uuid>.mp4"
}
```

**`POST /api/uploads/sign`**（评论上传，公开端）

同上结构，但 `kind` 只能是 `comment-image`，且要做**速率限制**（比如每 IP 每分钟 10 次）。

### 6.2 签名服务代码位置

新增 [`storage.js`](storage.js)（约 80-120 行）：

```js
// 核心导出
exports.signPutUrl({ kind, filename, mime }) -> { url, publicUrl, objectKey, expiresAt }
exports.signSts({ kind }) -> { stsToken, publicUrl, objectKey }
exports.headObject(key) -> exists 检查（可选，用于回调确认上传完成）
exports.deleteObject(key) -> 产品删除时清理
```

[server.js](server.js) 新增两条路由，调 `storage.js` 返回；**其他路由几乎不动**。

### 6.3 产品创建 / 更新的兼容处理

现有：`POST /api/admin/products` 接 multipart FormData，`multer` 写盘，DB 存 `/uploads/xxx.jpg`。

新方案：前端**先**调 sign → PUT OSS → 把 `publicUrl` 作为普通字段（和现有 `image_url` 一样）POST 到 `/api/admin/products`。

**后端改动最小**：
- `multer` middleware 保留不删（让 `image_url`/`video_url` 字段走老路径，OSS URL 也走 `image_url` 字段）
- 或者更干净：新字段 `image_key` / `video_key` / `image_keys[]`，后端拼成 `publicUrl` 写 DB；前端按 kind 上传后回传 key

推荐第一种（沿用 `image_url`），改动最小。

---

## 7. 公开读策略（重要决策点）

### 选项 A：Bucket Policy 让 `public/*` 前缀匿名可读

```json
{
  "Version": "1",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["oss:GetObject"],
    "Principal": ["*"],
    "Resource": ["acs:oss:*:*:xft-talk-uploads/public/*"]
  }]
}
```

读 URL 就是普通 `https://xft-talk-uploads.oss-cn-hangzhou.aliyuncs.com/public/...`，DB 直接存这个，前端 `<img src=...>` 直出。

**优点**：DB / 前端都是死 URL，和现在 `/uploads/xxx.jpg` 对称。
**缺点**：盗链 / 带宽滥用风险（其他站可以 hotlink，流量算你头上）。

### 选项 B：每次读都签名（15 分钟 TTL）

前端拿产品 API 时，后端给 URL 现场签名返回。
**优点**：带宽被严格控制（签名链接不能转发）。
**缺点**：API 响应要实时签名（轻量但还是 RTT 成本）；前端缓存的 URL 会过期要重签。

### 建议

一期走 **A（Bucket Policy public 读）**，上 CDN 后把 OSS 和 CDN 流量监控告警接上即可。盗链风险可以用 Referer 白名单降级处理（阿里云 OSS 原生支持）。

---

## 8. 前端改造

### 8.1 新增 [public/js/uploader.js](public/js/uploader.js)

```js
// 挂 window.xftUploader
window.xftUploader = {
  // 拿签名 → PUT → 返回 publicUrl
  async uploadImage(file, kind, { onProgress } = {}) { ... },
  // STS 分片上传视频
  async uploadVideo(file, { onProgress } = {}) { ... },
};
```

约 100-150 行，接 P1 的 `window.xftUpload` 产物（`compressImage` 返回的 File）。

### 8.2 admin.js 改动

当前 submit handler：

```js
fd.append('image', compressed.image);
fd.append('extra_images', ...);
// → POST /api/admin/products（multipart）
```

改为：

```js
const coverUrl = compressed.image
  ? await xftUploader.uploadImage(compressed.image, 'product-cover')
  : null;
const extraUrls = await Promise.all(
  compressed.extra_images.map((f) => xftUploader.uploadImage(f, 'product-extra'))
);
const videoUrl = compressed.video
  ? await xftUploader.uploadVideo(compressed.video)
  : null;
fd.append('image_url', coverUrl);  // 复用现有字段
// extra_urls 需要后端加解析（JSON 串或多次 append）
fd.append('video_url', videoUrl);
// → POST /api/admin/products（仍 multipart 兼容旧流程，但没 File 只有 URL）
```

### 8.3 app.js（评论）改动

同样用 `uploadImage(file, 'comment-image')` 替换 FormData 里的 `image` 字段。

### 8.4 进度条

预签名 PUT 不支持 XHR progress？其实支持，用 `XMLHttpRequest.upload.onprogress` 或 `fetch` + `ReadableStream`。在 admin 表单下方加一条进度条，视频上传尤其需要。

---

## 9. 现有数据迁移

### 9.1 数据规模

7 张产品封面 + 1 张附图 = 8 个文件，估算 <10MB（按小时计的压缩后尺寸）。

### 9.2 迁移脚本（[`scripts/migrate-uploads-to-oss.js`](scripts/migrate-uploads-to-oss.js)，约 80 行）

```
for each product p:
  if p.image starts with '/uploads/':
    oss_key = 'public/migrate/' + basename(p.image)
    upload ./uploads/<basename> → oss_key
    new_url = public URL
    UPDATE products SET image=new_url WHERE id=p.id
  同理处理 images (JSON 数组) 和 video

for each comment c:
  if c.image starts with '/uploads/':
    ...

最后打印 {migrated, skipped, failed}。
```

**安全性**：
- 先 dry-run 模式（只打印要改什么，不真 UPDATE）
- 跑前 `./scripts/backup-db.sh`
- 事务包整批 UPDATE，失败整体回滚

### 9.3 兼容共存

DB 里可以同时存在 `/uploads/xxx.jpg` 和 `https://.../xxx.jpg`。`app.use('/uploads', express.static(UPLOAD_DIR))` 继续保留，保证旧引用能读。迁移脚本可以分批跑，甚至产品一条条手工跑。

---

## 10. 回滚方案

### 10.1 软开关

[server.js](server.js) 加：

```js
const STORAGE_MODE = process.env.STORAGE_MODE || 'oss'; // 'oss' | 'local'
```

- `oss`：sign 路由返回 OSS 签名
- `local`：sign 路由直接返回 `{ method: 'PUT', url: '/api/local-upload/:key' }`，前端 PUT 到本机 Express，退化成本地盘

切换只需改 `.env` + `systemctl restart`。已写进 DB 的 OSS URL 仍从 OSS 读（OSS 还在就没事）。

### 10.2 硬回滚（OSS 账号吊销 / 欠费 / 不可达）

[`scripts/rollback-oss.sh`](scripts/rollback-oss.sh)：

```
1. 设 STORAGE_MODE=local 并重启
2. 跑一个反向迁移脚本：
   for each URL like 'https://xft-talk-uploads.oss...':
     oss_url → local wget → save to uploads/<same-name>
     UPDATE DB SET image='/uploads/...'
3. 完成后下架 OSS bucket policy
```

### 10.3 DB 永远保留原 URL 列

迁移脚本里把**改之前**的 URL 存一份到新列 `image_orig` / 备份表，实在出问题 `UPDATE ... SET image = image_orig` 即可。
成本：`ALTER TABLE products ADD COLUMN image_orig TEXT`（一行），用完保留不删。

---

## 11. 涉及文件清单

**新增**

| 路径 | 作用 |
|---|---|
| [storage.js](storage.js) | OSS 签名 + STS + HeadObject / DeleteObject 封装 |
| [public/js/uploader.js](public/js/uploader.js) | 前端签名 + PUT / STS 分片上传 |
| [scripts/migrate-uploads-to-oss.js](scripts/migrate-uploads-to-oss.js) | 一次性：现有 uploads/ → OSS |
| [scripts/rollback-oss.sh](scripts/rollback-oss.sh) | 应急：OSS → 本地 |
| [docs/OSS_MIGRATION_PLAN.md](docs/OSS_MIGRATION_PLAN.md) | 本文档 |

**修改**

| 路径 | 改动 |
|---|---|
| [server.js](server.js) | 加 `/api/admin/uploads/sign` 和 `/api/uploads/sign` 路由；产品 CRUD 里加 OSS 删除的 side-effect（可选） |
| [public/admin.js](public/admin.js) | submit 改走 uploader.js；删掉 multipart file append |
| [public/app.js](public/app.js) | 评论 submit 改走 uploader.js |
| [.env.example](.env.example) | 加 `OSS_REGION` / `OSS_BUCKET` / `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` / `STORAGE_MODE` |
| [HANDOFF.md](HANDOFF.md) | §5（数据位置）+ §6（部署）+ §13 新 log |
| [package.json](package.json) | 新增依赖 `ali-oss` |

**不改**

- [payments.js](payments.js) — 支付和上传无关
- [public/js/compress.js](public/js/compress.js) — 压缩照旧，只是产物的去向变了
- [public/style.css](public/style.css) — 除非加进度条 UI
- DB schema — 保持不变（URL 字段本来就允许任意 URL，包括外链 OSS）

---

## 12. 工作量预估

| 阶段 | 工时 |
|---|---|
| 阿里云控制台：建 bucket + RAM 账号 + Bucket Policy + CORS | 0.5 h |
| [storage.js](storage.js) + 签名路由 + 本地 curl 测 | 2-3 h |
| [public/js/uploader.js](public/js/uploader.js) 预签名 PUT 部分 + 进度条 | 2-3 h |
| admin.js / app.js 前端接线 + 回归测 | 2-3 h |
| 视频 STS + 分片（可选，也可以后期再上） | 3-4 h |
| 迁移脚本 dry-run + 真迁（8 个文件） | 1 h |
| 回滚脚本 + `STORAGE_MODE` 开关 + 验证切换 | 2 h |
| HANDOFF / `.env.example` 文档同步 | 1 h |

**合计：**
- **一期（仅图片，视频沿用旧流程）**：~10-12 小时 ≈ **1.5 人日**
- **完整（含视频 STS 分片）**：~14-16 小时 ≈ **2 人日**

前提：Andrew 熟 OSS SDK（vlog-platform 经验），且 tests 是手测（不建完整测试套件）。如果要加单元测试，翻倍。

---

## 13. 风险 / 待确认

| 风险 | 影响 | 缓解 |
|---|---|---|
| OSS 账单超预期 | 💰 | 开通阿里云消费告警；一期估算每月 <10 元（32MB 存储 + 低 PV） |
| RAM 泄漏 | 桶被恶意写满 | 最小权限策略；只授 PutObject 到特定前缀；不给 ListBucket |
| CORS 配错导致前端直传 403 | 上线当天卡住 | 上线前本地 `curl -X PUT` 预签名 URL 先跑一次，再动前端 |
| Bucket Policy 写成公开写 | 被外部灌数据 | ONLY `GetObject` 放开；`PutObject` 只走签名 |
| 迁移脚本误删 uploads/ 原文件 | 数据丢 | 迁移脚本**不**动本地文件，只写 DB 新 URL；本地文件人工确认 OSS 读 OK 后再删 |
| 网络抖动导致签名 URL 过期重试风暴 | UX 差 | uploader.js 加 401/403 重签一次的重试 |
| 管理员禁用 / 关停账号后 OSS 孤儿文件 | 存储费 | 产品 / 评论删除时调 `deleteObject`；定期跑一次对账脚本 |

**待 Andrew 确认**

1. `cfv-raw` / `cfv-output` 所在区域是？（决定新 bucket 区域）
2. vlog-platform 的 RAM 账号能复用，还是每个项目独立账号？
3. 是否需要绑 CDN 域名 `cdn.xiaofamous.com`，还是直连 OSS endpoint 即可？（一期建议直连）
4. 视频要不要一期一起做，还是图片先上、视频靠 P2 的 Tailscale 绕过 CF 就行？
5. **验收阈值**：一期只要图片上传不走 Tunnel 吗？还是必须同时解决视频大文件？

---

## 14. 决策建议

一期推荐：

> **做图片的预签名 PUT**，不做视频 STS。视频继续走 Tailscale 直连（P2 已经解决）。
> 约 1.5 人日，先解决 90% 的 UX 问题；
> 视频等真的有超大文件需求再上 STS。

反对意见（要是要完整一次到位）：
- 图片和视频迁移分两次改 admin.js，前端要测两次
- 约 0.5 人日额外成本，但少一次改 admin 逻辑的返工

Andrew 拍板。
