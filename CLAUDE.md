# xiaofamoustalk 项目协作规则

## 项目简介
这是一个 Node.js + Express + SQLite 的后台管理系统,部署在 Ubuntu 工作站(Tailscale IP 100.93.5.119),对外域名 talk.xiaofamous.com。后台地址 /admin,访客端功能还在建设中。

## 协作模式

### 直接执行,不要问我
- 读文件、grep、ls、查看代码
- 写代码、改代码、创建文件
- git add / commit(commit message 自己写清楚)
- npm install / 跑测试 / 跑构建
- 运行脚本验证自己的改动
- 本地 curl 测试 API

### 必须停下来等我验收的检查点
完成以下任一事项后,主动打住并按下面格式汇报,等我回复再继续:

1. **肉眼验收**:前端 UI 改动、新页面/组件、视觉相关改动
2. **不可逆操作前**:改数据库结构、删文件、git push、改 .env
3. **阶段里程碑**:一个优先级完成、方案需要切换、出现决策分叉

### 必须问我的事
- 使用我的真实用户数据(线上 data.sqlite 里的记录)
- 调用任何花钱的外部 API(OpenAI、Claude API、DashScope、阿里云 OSS 付费接口、短信服务等)
- 部署到生产环境
- 删除任何 uploads/ 里的用户上传文件

### 检查点汇报格式
到达检查点时按这个格式输出:

✅ 已完成:[做了什么]
📝 关键变更:[改了哪些文件/加了哪些函数]
🔍 请你验收:[具体怎么验收,比如"打开 xxx 页面看 yyy 效果"]
⏭️ 下一步计划:[接下来要做什么]
[等我回复]

## 项目关键信息

### 重要文件
- `server.js`:主服务器,启动入口
- `payments.js`:支付相关,改动前务必小心
- `public/`:前端文件(admin 后台 + 访客页面)
- `scripts/backup-db.sh`:数据库备份脚本
- `HANDOFF.md`:项目状态交接文档,开始工作前先看一眼

### 数据存储(重要,别搞错)
- `/data/xiaofamous/data.sqlite`:**线上主数据库**,绝对不能动
- `/data/xiaofamous/data.sqlite-wal`:WAL 日志,连着主数据库
- `/data/xiaofamous/data.sqlite-shm`:WAL 共享内存
- `/data/xiaofamous/backups/`:自动备份位置
- `/home/andrew/xiaofamoustalk/uploads/`:用户上传图片/视频
- `~/xiaofamoustalk/data.sqlite*`:**迁移前的旧副本,不是现役 DB**,保留作回滚点

### 环境变量
- `.env` 存着密钥,绝对不要读、不要改、不要回显内容
- 需要新环境变量,告诉我名字和用途,我自己加

### 启动和调试
- 启动服务:`npm start` 或 `node server.js`
- 看日志:`tail -f server.log`
- 本地测试 API:`curl http://localhost:端口/api/...`
- 管理员上传建议走 Tailscale 直连以提高速度

## 每次开始工作前的三步
1. `git status` 看当前工作树状态
2. 如果有未 commit 的改动,先问我是否继续
3. 看 HANDOFF.md 的最近更新,了解项目近期状态
