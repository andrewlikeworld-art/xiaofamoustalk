# Xiaofamous Talk · 交接文档

> 最后更新：2026-04-20
> 仓库：`/home/andrew/xiaofamoustalk`
> 技术栈：Node.js (Express) + better-sqlite3 + 原生 JS 前端（无构建）

---

## 1. 已完成的功能

### 公开端（面向访客）
- 产品列表页（首页），响应式网格布局
- 产品详情页（图片 / 名称 / 描述）
- 评论系统：发评论、上传图片、点赞、按"热度/最新"切换
- 评论回复（单层嵌套，回复的回复挂到根评论下）
- 删除自己的评论（基于 `uid` cookie 身份识别）
- 评论数 / 排序 / 时间相对化显示
- "关于" 占位页（`#/about`）

### 管理后台（/admin）
- 密码登录（HttpOnly cookie + DB session，7 天过期）
- 产品的增 / 改 / 删（单个）
- 图片既支持上传也支持填 URL
- **CSV 批量导入**（upsert by name）：上传 CSV → 同名更新、新名字新增、返回 `created / updated / failed / errors`
- CSV 模板下载（/api/admin/products/template.csv，带 UTF-8 BOM 便于 Excel 打开）
- 编辑 / 删除时自动清理旧上传图片文件

### 基础设施
- `systemd --user` 服务跑应用，已 `enable --now`，linger 已开，重启后自动起
- 密码 / 端口通过 `.env` 注入，已从源码剥离

---

## 2. 还没完成 / 未做的功能

- ~~**公网访问**：已通过 Cloudflare Tunnel 启用，地址 `https://admin.xiaofamous.com`~~
- 管理员账户体系：只有单一共享密码，没有多员工账户、没有操作日志
- 产品列表没有分页（产品多时会一次性全返回）
- 评论也没有分页 / 懒加载
- 没有搜索、没有产品分类 / 标签
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
| `/home/andrew/xiaofamoustalk/data.sqlite` | 主数据库 |
| `/home/andrew/xiaofamoustalk/data.sqlite-shm` | SQLite WAL shared memory |
| `/home/andrew/xiaofamoustalk/data.sqlite-wal` | SQLite WAL（含未合并的写入，不能漏） |
| `/home/andrew/xiaofamoustalk/uploads/` | 用户 / 员工上传的所有图片 |

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

### 最简备份脚本

```bash
# 放到 crontab：每天凌晨 3 点备份到 ~/backups
cd /home/andrew/xiaofamoustalk
mkdir -p ~/backups/xft
TS=$(date +%Y%m%d-%H%M%S)
sqlite3 data.sqlite ".backup ~/backups/xft/data-$TS.sqlite"
tar czf ~/backups/xft/uploads-$TS.tar.gz uploads/
# 保留最近 30 份
ls -t ~/backups/xft/data-*.sqlite  | tail -n +31 | xargs -r rm
ls -t ~/backups/xft/uploads-*.tar.gz | tail -n +31 | xargs -r rm
```

---

## 6. 部署现状

| 项 | 状态 |
|---|---|
| 服务形态 | `systemctl --user` 服务 `xiaofamoustalk.service`（已 enable + active） |
| 绑定地址 | `0.0.0.0:3000`（实际仅本机可达，因为机器在 NAT 后） |
| 反向代理 | Cloudflare Tunnel（`cloudflared` systemd 服务） |
| 公网可访问 | **✅ 是** — `https://admin.xiaofamous.com` |
| 本机 IP | `192.168.31.65`（内网）|
| Tailscale | 已装，IP `100.93.5.119`，DNS `workstation.tail9c7884.ts.net`，tailnet 内已可访问 `http://workstation.tail9c7884.ts.net:3000` |
| cloudflared | ✅ 已配置，Tunnel ID `23ab4493-4b88-43bd-acbc-56442e39dc55`，域名 `admin.xiaofamous.com` |
| 机器开机自启 | ✅（linger 已开）|

### 公网访问（已启用）

**方案：Cloudflare Tunnel**（2026-04-20 启用）

- 公网地址：`https://admin.xiaofamous.com`
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

1. ~~**选定公网访问方案**并启用~~ — ✅ 已完成（Cloudflare Tunnel，`https://admin.xiaofamous.com`）
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
- **上传没有 virus scan / 内容审核**：只限制了 mime 白名单（png/jpg/gif/webp）和 5MB 大小
- **CSV 导入不是事务+全有或全无**：现在是单事务内逐行，但一行语法错会中断整批（SQLite 层面 rollback）。当前观测：字段缺失的行被跳过不抛，只有底层 DB 错误才会 rollback 整个事务

### 待确认

- ~~公网访问方案~~ — ✅ 已选定 Cloudflare Tunnel，域名 `admin.xiaofamous.com`
- 备份目标位置：本机 `~/backups` 还是另一台机？长期仅本机备份等于没备份（盘坏就全没）
- 产品的 `image` 字段既可能是 `/uploads/xxx.jpg` 也可能是 `https://...`，前端不区分；迁移机器时外链不迁，本地上传需随 uploads/ 一起拷

### 已知小 bug

- 删除评论时若同一产品下有很多回复，前端用 `confirm()` 弹窗，没做成美观的模态框
- CSV 导入时如果 description 字段里有真实的回车（非被 `"` 包起来的），解析会失败——这是 CSV 规范要求，不算 bug，但员工可能踩，需要在 UI 里更明显地提示
- 前端 `admin.js` 里 `openForm` 填 `image_url` 时用 `product.image.startsWith('/uploads/')` 判断是不是上传来的；如果将来允许相对路径但不在 /uploads 下，判断会错

---

**联系 / 接手**：此项目由 Andrew（`andrewlikeworld@gmail.com`）维护。
