# Xiaofamous Talk · 交接文档

> 最后更新：2026-04-21
> 仓库：`/home/andrew/xiaofamoustalk`
> 技术栈：Node.js (Express) + better-sqlite3 + 原生 JS 前端（无构建）

---

> ⚠️ **接手 AI 必读** — 数据库已从项目目录**搬到** `/data/xiaofamous/data.sqlite`。切勿在代码里写回 `./data.sqlite`。项目根下那个 `data.sqlite*` 是迁移前的旧副本，保留作回滚点，**不是**线上库。详情见 §13。

## 1. 已完成的功能

### 公开端（面向访客）
- 产品列表页（首页），响应式网格布局（移动端强制两列）
- **首页分类筛选条**（按产品 `category` 分组，会话级记住选中，见 §14）
- 卡片 meta 显示 💬 评论数 / ❤️ 点赞总数
- 产品详情页：封面图 + **最多 4 张附图（点图 lightbox）** + **视频播放器**
- **可销售商品显示价格 + 微信/支付宝支付按钮**（见 §11）
- 评论系统：发评论、上传图片、点赞、按"热度/最新"切换
- 评论回复（单层嵌套，回复的回复挂到根评论下）
- 删除自己的评论（基于 `uid` cookie 身份识别）
- 评论数 / 排序 / 时间相对化显示

### 管理后台（/admin）
- 密码登录（HttpOnly cookie + DB session，7 天过期）
- 产品的增 / 改 / 删（单个）
- **分类（带 datalist 建议）、封面图、附图（最多 4 张）、视频**均可上传或填 URL
- **每个产品可选「开放销售」+ 价格**（见 §11 支付）
- **CSV 批量导入**（upsert by name）：上传 CSV → 同名更新、新名字新增，可选 `category` 列；返回 `created / updated / failed / errors`
- CSV 模板下载（/api/admin/products/template.csv，带 UTF-8 BOM 便于 Excel 打开）
- 编辑 / 删除时自动清理旧上传文件（封面 + 附图 + 视频）
- 订单列表 API：`GET /api/admin/orders`（目前还没做前端页面，直接 curl 查）
- **上传无尺寸限制**（2026-04-22 起，应用层 multer 不拦），真正上限看反向代理（Cloudflare Tunnel ~100MB）

### 基础设施
- `systemd --user` 服务跑应用，已 `enable --now`，linger 已开，重启后自动起
- 密码 / 端口通过 `.env` 注入，已从源码剥离
- **DB 已独立于项目目录**，在 `/data/xiaofamous/data.sqlite`（见 §13）
- 备份脚本：[scripts/backup-db.sh](scripts/backup-db.sh)，手动执行即可
- 可选 **READ_ONLY 模式**：`READ_ONLY=true` 环境变量拉起时，SQLite 直接拒绝所有写

---

## 2. 还没完成 / 未做的功能

- ~~**公网访问**：已通过 Cloudflare Tunnel 启用，地址 `https://talk.xiaofamous.com`~~
- 管理员账户体系：只有单一共享密码，没有多员工账户、没有操作日志
- 产品列表没有分页（产品多时会一次性全返回）
- 评论也没有分页 / 懒加载
- 没有搜索；~~产品分类 / 标签~~ 已做基础版（单个 category，首页筛选）；标签 / 多分类 / 子分类未做
- 附图没有单张删除 / 排序，只有"替换整组"或"清空"两种操作
- 视频没做服务端转码 / 缩略图，播放完全依赖浏览器能力
- 评论没有"举报 / 隐藏 / 管理员删除"
- 没有备份任务（SQLite 和 uploads 需人工备份，见 §5）
- 前端没有单元测试；后端没有自动化测试，只有手动 curl 烟测
- 没有 rate-limiting，评论 / 登录接口都可以被暴力刷

---

## 3. 如何启动

正常情况：服务由 systemd 管理，不需要手启。

```bash
# 查看状态
systemctl --user status xiaofamoustalk.service

# 启动 / 停止 / 重启
systemctl --user start   xiaofamoustalk.service
systemctl --user stop    xiaofamoustalk.service
systemctl --user restart xiaofamoustalk.service

# 看日志
tail -f /home/andrew/xiaofamoustalk/server.log
# 或
journalctl --user -u xiaofamoustalk -f
```

手动启动（调试用）：

```bash
cd /home/andrew/xiaofamoustalk
# 方式 A：带 env file
set -a && source .env && set +a && node server.js

# 方式 B：watch 模式
npm run dev
```

依赖已安装（`node_modules/` 存在）。如果是新环境：

```bash
cd /home/andrew/xiaofamoustalk
npm install
```

---

## 4. 管理后台

- **入口 URL**：`http://localhost:3000/admin`
- **账号机制**：单一共享密码，无用户名
- **密码来源**：环境变量 `ADMIN_PASSWORD`，从 [.env](.env) 读取
- **当前密码**：见 [.env](.env)（不提交到 git）
- **Session**：登录后后端生成随机 token 写入 `admin_sessions` 表，返回 `admin_session` HttpOnly cookie，7 天过期，过期自动清除
- **修改密码**：编辑 `.env` 里的 `ADMIN_PASSWORD`，然后 `systemctl --user restart xiaofamoustalk.service`。已登录的 session 不会失效（只有新登录走新密码）；若要强制所有 session 失效，见 §10

### 环境变量（.env）

| 变量名 | 必填 | 说明 |
|---|---|---|
| `ADMIN_PASSWORD` | 是 | 管理后台登录密码，**上线前务必改成强随机字符串** |
| `PORT` | 否 | HTTP 监听端口，默认 3000 |

模板在 [.env.example](.env.example)。

---

## 5. 数据位置 & 备份

### 应用数据（必须备份）

| 路径 | 说明 |
|---|---|
| `/data/xiaofamous/data.sqlite` | **主数据库（线上生效的那个）** |
| `/data/xiaofamous/data.sqlite-shm` | SQLite WAL shared memory |
| `/data/xiaofamous/data.sqlite-wal` | SQLite WAL（含未合并的写入，不能漏） |
| `/data/xiaofamous/backups/` | `scripts/backup-db.sh` 的输出位置 |
| `/home/andrew/xiaofamoustalk/uploads/` | 用户 / 员工上传的所有图片 |
| ~~`/home/andrew/xiaofamoustalk/data.sqlite*`~~ | **迁移前旧副本**，保留作回滚点，**不是**现役 DB |

**备份 3 个 sqlite 文件要一起备份**，或用 `sqlite3 data.sqlite ".backup /path/to/backup.sqlite"` 原子备份成单文件。

### 配置（需要备份）

| 路径 | 说明 |
|---|---|
| `/home/andrew/xiaofamoustalk/.env` | 含 ADMIN_PASSWORD |
| `/home/andrew/.config/systemd/user/xiaofamoustalk.service` | systemd 配置 |

### 不需要备份

- `node_modules/` — `npm install` 可以重建
- `package-lock.json` — 在 git 里有
- `server.log` — 可重建
- `data.sqlite-shm` 严格说可省略（但最好一起带上）

### 手动备份（已做）

```bash
cd /home/andrew/xiaofamoustalk
./scripts/backup-db.sh
# 输出 /data/xiaofamous/backups/data-YYYYMMDD-HHMMSS.sqlite
# 自动 integrity_check、保留最近 30 份；底层用 sqlite3 .backup（服务在跑也安全）
```

要改保留份数或输出目录：`KEEP=60 BACKUP_DIR=/path ./scripts/backup-db.sh`

### 推荐加 cron（还没加）

```bash
# crontab -e，每天凌晨 3 点
0 3 * * * /home/andrew/xiaofamoustalk/scripts/backup-db.sh >> /home/andrew/xiaofamoustalk/server.log 2>&1
# uploads/ 也要备（脚本没覆盖，单独做）
15 3 * * * tar czf /data/xiaofamous/backups/uploads-$(date +\%Y\%m\%d).tar.gz -C /home/andrew/xiaofamoustalk uploads/
```

**长期：只本机备份等于没备份**——盘坏就全没。务必 rsync 到另一台机 / S3。

---

## 6. 部署现状

| 项 | 状态 |
|---|---|
| 服务形态 | `systemctl --user` 服务 `xiaofamoustalk.service`（已 enable + active） |
| 绑定地址 | `0.0.0.0:3000`（实际仅本机可达，因为机器在 NAT 后） |
| 反向代理 | Cloudflare Tunnel（`cloudflared` systemd 服务） |
| 公网可访问 | **✅ 是** — `https://talk.xiaofamous.com` |
| 本机 IP | `192.168.31.65`（内网）|
| Tailscale | 已装，IP `100.93.5.119`，DNS `workstation.tail9c7884.ts.net`，tailnet 内已可访问 `http://workstation.tail9c7884.ts.net:3000` |
| cloudflared | ✅ 已配置，Tunnel ID `23ab4493-4b88-43bd-acbc-56442e39dc55`，域名 `talk.xiaofamous.com` |
| 机器开机自启 | ✅（linger 已开）|

### 公网访问（已启用）

**方案：Cloudflare Tunnel**（2026-04-20 启用）

- 公网地址：`https://talk.xiaofamous.com`
- Tunnel ID：`23ab4493-4b88-43bd-acbc-56442e39dc55`
- 配置文件：`/home/andrew/.cloudflared/config.yml`
- 凭证文件：`/home/andrew/.cloudflared/23ab4493-4b88-43bd-acbc-56442e39dc55.json`
- 证书文件：`/home/andrew/.cloudflared/cert.pem`
- systemd 服务：`cloudflared.service`（系统级，非 user 级）

```bash
# 管理 tunnel 服务
sudo systemctl status cloudflared
sudo systemctl restart cloudflared
sudo journalctl -u cloudflared -f
```

备选方案（未启用）：Tailscale Funnel / Tailscale Serve，如需切换见旧版文档。

---

## 7. 下一步最推荐的任务列表

优先级按上→下递减：

1. ~~**选定公网访问方案**并启用~~ — ✅ 已完成（Cloudflare Tunnel，`https://talk.xiaofamous.com`）
2. 自动备份：加上 §5 的 cron 脚本，定期 rsync 到另一台机
3. Admin 审计日志：记录谁（哪个 session）在什么时间新增/改/删/导入了什么产品
4. Admin 多账户：把单一 `ADMIN_PASSWORD` 升级成员工级账号表（username + bcrypt hash）
5. 评论/登录接口加 rate-limiting（比如 `express-rate-limit`）
6. 产品和评论分页
7. 图片压缩（前端 canvas resize 或后端 sharp），目前直存原图
8. CSV 导出当前产品表（"反向"配合导入）
9. 产品分类 / 标签，搜索
10. 面向公网的评论防刷策略（hCaptcha / Turnstile）

---

## 8. 新接手的 AI 应该先看哪些文件

按阅读顺序：

1. [HANDOFF.md](HANDOFF.md) ← 你在看的这份
2. [NEXT_PROMPT.md](NEXT_PROMPT.md) — 给 AI 直接复用的上下文提示词
3. [package.json](package.json) — 依赖 + scripts
4. [server.js](server.js) — 所有后端路由和 DB schema 都在这一个文件
5. [public/index.html](public/index.html) + [public/app.js](public/app.js) — 公开端 SPA
6. [public/admin.html](public/admin.html) + [public/admin.js](public/admin.js) — 管理后台
7. [public/style.css](public/style.css) — 所有样式
8. [.env.example](.env.example) — 环境变量说明
9. [.config/systemd/user/xiaofamoustalk.service](../../.config/systemd/user/xiaofamoustalk.service) — systemd 配置（不在仓库里）

快速验证流程：
```bash
systemctl --user status xiaofamoustalk.service       # 服务活着？
curl http://localhost:3000/api/products                # 公共接口？
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"password":"<see .env>"}'                       # 管理员密码对不对？
```

---

## 9. 新增的重要文件

与初始上传 `e348ab8 initial website upload` 相比，之后新增 / 修改的：

- [server.js](server.js) — 扩增：评论回复 / 删除 / 排序、管理员会话、产品 CRUD、CSV 导入与模板、/admin 路由
- [public/admin.html](public/admin.html)（新增）
- [public/admin.js](public/admin.js)（新增）
- [public/style.css](public/style.css) — 底部追加了管理后台和 CSV 导入样式
- [public/index.html](public/index.html) — 评论模板加了回复 / 删除按钮、回复表单模板
- [public/app.js](public/app.js) — 回复 / 删除 / 排序逻辑
- [.env.example](.env.example)（新增）
- [.env](.env)（新增，不在 git 里）
- [.gitignore](.gitignore) — 已排除 data.sqlite* / uploads / .env / *.log
- `/home/andrew/.config/systemd/user/xiaofamoustalk.service`（新增，在 home 下，不在仓库里）
- `server.log`（运行时生成，不在 git 里）
- [HANDOFF.md](HANDOFF.md)（本文档）
- [NEXT_PROMPT.md](NEXT_PROMPT.md)

---

## 10. 已知问题 / 风险 / 待确认

### 风险

- **改 `ADMIN_PASSWORD` 不会使已登录 session 失效**：老 cookie 仍有效到过期。若要强制下线所有已登录：
  ```bash
  cd /home/andrew/xiaofamoustalk
  node -e "require('better-sqlite3')('data.sqlite').exec('DELETE FROM admin_sessions')"
  ```
- **没有 rate-limiting**：登录接口可被暴力。上线前建议加一层
- **评论接口匿名**：任何访客可发，靠 `uid` cookie 区分"自己"。恶意访客可清 cookie 绕过"只能删自己"——但这只能删他自己那条匿名评论，不是管理员权限，影响有限
- **上传没有 virus scan / 内容审核**：只限制了 mime 白名单（图片 png/jpg/gif/webp、视频 mp4/webm/mov）
- **上传无尺寸上限（2026-04-22 起）**：应用层 `multer` 已经不再限 fileSize。实际的硬上限由反向代理决定：**Cloudflare Tunnel 免费计划单请求体最大约 100MB**，超过会在 CF 层直接 413，应用这边看不到。员工若要上传大视频，要么压缩到 100MB 内，要么绕过 Cloudflare（走 Tailscale 直连 `workstation.tail9c7884.ts.net:3000`）
- **磁盘没限额**：uploads/ 写 `/home/andrew/xiaofamoustalk/uploads/`，没做 quota。长期视频多了要盯一下盘
- **CSV 导入不是事务+全有或全无**：现在是单事务内逐行，但一行语法错会中断整批（SQLite 层面 rollback）。当前观测：字段缺失的行被跳过不抛，只有底层 DB 错误才会 rollback 整个事务

### 待确认

- ~~公网访问方案~~ — ✅ 已选定 Cloudflare Tunnel，域名 `talk.xiaofamous.com`
- 备份目标位置：本机 `~/backups` 还是另一台机？长期仅本机备份等于没备份（盘坏就全没）
- 产品的 `image` 字段既可能是 `/uploads/xxx.jpg` 也可能是 `https://...`，前端不区分；迁移机器时外链不迁，本地上传需随 uploads/ 一起拷

### 已知小 bug

- 删除评论时若同一产品下有很多回复，前端用 `confirm()` 弹窗，没做成美观的模态框
- CSV 导入时如果 description 字段里有真实的回车（非被 `"` 包起来的），解析会失败——这是 CSV 规范要求，不算 bug，但员工可能踩，需要在 UI 里更明显地提示
- 前端 `admin.js` 里 `openForm` 填 `image_url` 时用 `product.image.startsWith('/uploads/')` 判断是不是上传来的；如果将来允许相对路径但不在 /uploads 下，判断会错

---

---

## 11. 支付（微信 / 支付宝）

> 2026-04-20 加入。当前默认 `PAY_MODE=mock`，用占位二维码走通前端。凭证就位后切 `live` 即可。

### 数据模型

- `products` 表新增：
  - `sellable INTEGER NOT NULL DEFAULT 0`
  - `price INTEGER`（存 **分**，例如 `2980` = ¥29.80；统一避免浮点误差）
- 新增 `orders` 表：`out_trade_no`（我方订单号）、`product_id`、`user_id`（来自 uid cookie）、`amount`（分）、`provider`（`wechat`/`alipay`）、`status`（`pending`/`paid`/`failed`/`canceled`）、`provider_trade_no`、`created_at`、`paid_at`

### 接入逻辑（`server.js` + `payments.js`）

- `POST /api/products/:id/pay` body `{ provider: 'wechat' | 'alipay' }` → 建订单，返回 `{ out_trade_no, amount, qr_data_url, code_url?, mode }`
- `GET /api/orders/:out_trade_no` → 返回状态（前端每 2 秒轮询）
- `POST /api/pay/wechat/notify` → 微信 V3 回调（验签 + AES-256-GCM 解密 + 标记 paid）
- `POST /api/pay/alipay/notify` → 支付宝回调（RSA2 验签 + 标记 paid）
- mock 模式：`GET /mock-pay/:out_trade_no` 渲染一个"点一下就付"的网页；`POST /api/orders/:out_trade_no/mock-pay` 把订单标成 paid
- 管理端：`GET /api/admin/orders` 列出近 200 单

微信 Native V3 和支付宝当面付两种**都是扫码支付**，对 PC / 手机浏览器通用。如果以后要上 JSAPI / H5 / 小程序支付，在 `payments.js` 里加对应方法即可。

### 切到 live 模式的步骤

1. 申请通过后拿到这些材料：
   - 微信：AppID、商户号、APIv3 密钥、商户 API 证书（`apiclient_cert.pem` + `apiclient_key.pem`）、商户证书序列号、平台证书（商户平台可下载）
   - 支付宝：AppID、应用私钥、支付宝公钥
2. 把证书文件放到 `/home/andrew/xiaofamoustalk/secrets/`（已 gitignore uploads/.env，建议把这个路径也 gitignore 掉）
3. 填 [.env](.env)，把 `PAY_MODE=live`，填所有 `WECHAT_*` / `ALIPAY_*`（模板见 [.env.example](.env.example)）
4. `systemctl --user restart xiaofamoustalk.service`
5. 到微信商户平台 / 支付宝开放平台**配置回调 URL**：
   - 微信：`https://talk.xiaofamous.com/api/pay/wechat/notify`
   - 支付宝：`https://talk.xiaofamous.com/api/pay/alipay/notify`
6. 小金额真机测一笔

### 已知风险 / 待做

- **没做订单超时自动取消**：pending 订单会一直留着；长期建议加 cron 把 30 分钟前仍 pending 的订单关掉（微信侧 V3 有 `close` 接口）
- **退款接口没做**：`payments.js` 只覆盖了下单和回调
- **管理后台订单列表 UI 没做**：现在只能 curl `/api/admin/orders`
- **没做幂等防重**：`markOrderPaid` 用 `status = 'pending'` 做 WHERE 条件已能防重复支付回调多次执行业务；但金额一致性没有二次校验，上线前建议加："回调里解密出来的 amount 必须 === DB 里订单的 amount"
- **mock 模式一定不能出现在生产**：`/api/orders/:n/mock-pay` 会直接标 paid。`live` 模式下这条路由会 403，但 `PAY_MODE` 记得真的改成 `live`

---

## 12. 数据库迁出项目目录（2026-04-21）

### 动机
- 防止 `git clean` / 误 `rm -rf` / 部署脚本意外覆盖生产数据
- 让 DB 和代码的生命周期彻底解耦：代码可随意 reset，数据不受影响
- 未来可挂独立盘 / 独立快照到 `/data/xiaofamous/`

### 新路径
```
/data/xiaofamous/
├── data.sqlite           ← 主库（现役）
├── data.sqlite-shm       ← WAL shared memory
├── data.sqlite-wal       ← WAL（未合并的写入都在这儿，备份时必须一起带）
└── backups/
    └── data-YYYYMMDD-HHMMSS.sqlite   ← scripts/backup-db.sh 的输出
```

目录所有者：`andrew:andrew`，权限 `755`。`/data` 本身由 root 拥有，迁移时靠 `sudo mkdir` + `sudo chown` 建起来。

### server.js 的关键改动（[server.js:15](server.js#L15) 起）
```js
const DB_PATH = process.env.DB_PATH || '/data/xiaofamous/data.sqlite';
const READ_ONLY = process.env.READ_ONLY === 'true';

if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ 数据库文件不存在: ${DB_PATH}`);
  console.error('   拒绝启动，以免创建空库覆盖生产数据。');
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: READ_ONLY });
```

三个保护：
1. **默认绝对路径**，绕开 `WorkingDirectory`，部署脚本/git 操作无法碰到
2. **DB 文件不在就 exit(1)**——不会偷偷建个空库覆盖线上
3. **READ_ONLY 模式**：`READ_ONLY=true` 拉起时，`CREATE TABLE IF NOT EXISTS` / seed / `ALTER` 全跳过，DB 以 `{readonly: true}` 打开，写请求被 SQLite 硬拒

**没有改任何 API、没有新增 ALTER、没有 DROP。**`CREATE TABLE IF NOT EXISTS` 和 `ALTER ADD COLUMN`（受 `PRAGMA table_info` 检查保护）都是既有代码，对已有生产库均为 no-op。

### 迁移步骤（已完成，留档以便复盘）
```bash
# 1. 建目录（需要 root）
sudo mkdir -p /data/xiaofamous/backups
sudo chown -R andrew:andrew /data/xiaofamous

# 2. 停服（防止写入期间快照不一致）
systemctl --user stop xiaofamoustalk.service

# 3. 原子快照（sqlite3 .backup 会把 WAL 里未合并的写入一起带过去）
sqlite3 /home/andrew/xiaofamoustalk/data.sqlite \
  ".backup '/data/xiaofamous/data.sqlite'"

# 4. 校验
sqlite3 /data/xiaofamous/data.sqlite "PRAGMA integrity_check;"   # → ok
# 各表行数对比：products=3, comments=1, likes=0, admin_sessions=7, orders=5（迁移前后一致）

# 5. 重启
systemctl --user start xiaofamoustalk.service
curl -s http://localhost:3000/api/products | jq 'length'   # → 3
```

⚠️ **不要用 `cp data.sqlite /data/xiaofamous/`**——WAL 里 600KB 未合并写入会丢。

### 旧 DB 文件
`/home/andrew/xiaofamoustalk/data.sqlite*` **原地保留**作为回滚点，未删除。确认新路径稳定运行一段时间（比如一周）后可人工删除：
```bash
rm /home/andrew/xiaofamoustalk/data.sqlite{,-shm,-wal}
```

### 回滚预案
- **代码回滚**：`git checkout pre-db-migration`（这个 tag 是 `1cd142a`，DB 搬家前的最后一版，已 push 到 GitHub）
- **数据回滚**：停服 → `sqlite3 /data/xiaofamous/data.sqlite ".backup '/some/safe/path.sqlite'"` 先备当前 → 再把想要的备份 `cp` 回 `/data/xiaofamous/data.sqlite`（务必连 `-shm` `-wal` 一起换，或 `rm` 掉 `-shm` `-wal` 让 SQLite 重建）→ 起服

### 备份脚本
[scripts/backup-db.sh](scripts/backup-db.sh)：`sqlite3 .backup` + `integrity_check` + 保留最近 30 份。执行即用，已在 §5 给出 cron 范例（cron 还没接，**下一个接手建议先接上**）。

### 仍未做（建议下一个接手优先处理）
1. 接 cron：自动每日备份 + uploads/ 一起打包
2. 异地备份：rsync 到另一台机或 S3，否则盘坏就全没
3. 删项目根下的旧 `data.sqlite*`（至少观察一周后）

---

## 13. 版本日志

### 2026-04-22 · 分类 / 多图 / 视频 + 去掉上传尺寸限制

**新增**
- 产品表加三列（均为 `ALTER ADD COLUMN`，幂等）：
  - `category TEXT`（+ `idx_products_category` 索引）
  - `images TEXT`（JSON 数组，存除封面外的附图 URL，最多 4 张；DB 存字符串，API 出参已 hydrate 成数组）
  - `video TEXT`（视频 URL，可上传或填外链）
- 新路由：`GET /api/categories` → `[{name, count}]`；`GET /api/products?category=X` 按分类过滤
- 首页
  - 标题改 `小飞马🦄 · Talk`；下掉 `#/about` 路由和"关于"入口
  - 加分类筛选条（pills，会话内用 `sessionStorage` 记当前选中）
  - 卡片 meta 从"N 条评论 · 查看 →"改成 `💬N / ❤️N`（后端查询顺便带 `like_count`）
  - 移动端强制两列 `@media (max-width: 720px)`
- 详情页
  - 附图四宫格（点图进 lightbox），`.product-media` 做纵向容器
  - 原生 `<video controls playsinline>` 播放器，`max-height: 60vh`
  - 标题后追加 category 胶囊
- 管理后台
  - 表单新增字段：分类（带 datalist 建议）、封面图、附图（最多 4 张，单次提交整组替换）、视频文件、视频 URL、两个"移除附图 / 移除视频"复选框
  - 编辑时预览区展示当前封面 / 当前附图 / 当前视频
  - CSV 模板 + 导入兼容 `category`（没带该列也能导入，向后兼容）
- 上传尺寸限制**全部去掉**（评论图 5MB / 产品媒体 50MB / CSV 2MB 全部删）——应用层 multer 已不限制，真正的上限由 Cloudflare Tunnel（~100MB / 请求体）决定；管理端走 Tailscale 直连可绕过

**没做**
- 附图没有排序 / 单张删除 UI：当前"替换整组"或"一键清空"两种操作，加单张删除要多带一个保留列表字段
- 视频没做服务端转码 / 缩略图，播放全看浏览器能力
- 没做 uploads/ 磁盘配额告警
- §7 里备份 cron、rate-limiting 等老项目依旧待做

**风险 / 注意**
- **CF 免费计划单请求体 ~100MB 硬上限**：员工上传大视频会在 CF 层 413，应用这边看不到日志。绕过方式：Tailscale 直连 `workstation.tail9c7884.ts.net:3000`
- 删除产品时会清理封面 + 附图 + 视频的本地文件（外链不碰）；编辑时若替换附图整组，旧附图本地文件也会清掉
- `images` / `video` 两列是新加的，重启服务时 `ALTER ADD COLUMN` 会自动补；老进程若没重启，前端调 `/api/categories` 会 404，页面会降级不显示分类条

### 2026-04-21 · DB 搬家 + 备份脚本

**新增**
- DB 文件从项目根搬到 `/data/xiaofamous/data.sqlite`（详情见 §13）
- [server.js](server.js) `DB_PATH` 可由环境变量注入，默认绝对路径；DB 不存在即拒启动
- `READ_ONLY=true` 环境开关（只读副本场景，SQLite 层硬拒所有写）
- 新增 [scripts/backup-db.sh](scripts/backup-db.sh)：手动一致快照 + 保留最近 30 份
- [.env.example](.env.example) 增加 `DB_PATH` / `READ_ONLY` 段落
- GitHub 上打了 tag **`pre-db-migration`** → `1cd142a`（搬家前的最后一版，回滚用）

**没做**
- 没改任何 API；没加 `ALTER`；没加 `DROP`；没重建 schema；不会覆盖已有数据
- cron 自动备份没接（脚本是手动）
- uploads/ 的周期备份没做

**风险 / 注意**
- `/data` 目录所有者是 root，**重做机器时**记得先 `sudo mkdir /data && sudo chown andrew /data/xiaofamous`
- 项目根下仍有旧 `data.sqlite*`，是**旧副本**不是线上库，不要被它迷惑

### 2026-04-20 · 支付骨架（mock 可跑通）

**新增**
- 产品可标记为「开放销售」并填写价格（元 → 分存储）
- 公开端产品详情页显示价格 + 微信 / 支付宝两颗支付按钮 + 二维码弹窗 + 2 秒轮询订单状态
- 首页卡片上显示价格
- 新 `orders` 表 + `POST /api/products/:id/pay`、`GET /api/orders/:out_trade_no`
- `POST /api/pay/{wechat,alipay}/notify` 回调入口（含验签 + 解密代码，等凭证即可生效）
- `GET /api/admin/orders`（只有接口，没做管理端 UI）
- mock 模式：`PAY_MODE=mock` 下返回模拟二维码，扫码打开 `/mock-pay/:out_trade_no`，点一下标成功
- [payments.js](payments.js)：微信 Native V3 + 支付宝当面付两家的下单 / 验签实现
- 新增依赖：`qrcode`
- `.env` / `.env.example` 加 `PAY_MODE`、`PUBLIC_BASE_URL`、两家支付商的凭证占位
- `.gitignore` 加 `backups/`、`secrets/`

**风险 / 注意**
- 真实支付代码**未经过 live 回归**，等凭证到位时需小额真机联测
- 没做订单超时自动取消（pending 订单会一直留着）
- 没做退款接口
- 回调里没做金额一致性二次校验（回调解密出的 amount 应与 DB 订单 amount 比对）
- mock 模式**不能误上生产**：live 模式下 mock-pay 路由会返回 403，但 `PAY_MODE` 本身记得真的改成 `live`
- 管理端订单列表 UI 还没做

**下一步建议（按优先级）**
1. 拿到微信 / 支付宝凭证后切 `PAY_MODE=live`，配回调 URL，走一笔真实小额
2. 管理端做订单列表页（列表 / 退款按钮 / 状态筛选）
3. 订单超时自动关闭（cron）
4. 回调里加金额一致性校验
5. §7 里前面列的备份脚本、rate-limiting、评论分页等依旧待做

---

**联系 / 接手**：此项目由 Andrew（`andrewlikeworld@gmail.com`）维护。
