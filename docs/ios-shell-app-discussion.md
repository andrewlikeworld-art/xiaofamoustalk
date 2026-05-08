# iOS 套壳 App · 讨论文档

> 起始日期：2026-05-07
> 最后更新：2026-05-08
> 目标:把 `https://www.xiaofamous.com/` 访客端套成一个 iOS 原生壳 App
> 当前状态:Apple Developer 账号注册卡住,**已先做 PWA 完整版作为过渡**(2026-05-08 上线),iOS 套壳路线在账号到位后恢复

---

## 背景速览

- **要套的网站**：访客端 `https://www.xiaofamous.com/`(公网通,Cloudflare 前置,Express 后端)
- **当前前端**：纯原生 JS + ESM,挂载点 `<main id="app">`,无构建,见 `public/app.js`
- **后端 API**:`/api/products`、`/api/comments`、`/api/upload` 等已就绪(REST + JSON)
- **用户上传**:目前 web 端是 `<input type="file" accept="image/*">`,WKWebView 默认就会调起 iOS 原生相机/相册 picker——这个功能**可能零成本就能拿到**,需要在 Phase 1 验证
- **用户硬件/账号**:有 Mac,Apple Developer 账号 $99/年(每账号无限 App)
- **2026-05-08 新增**:PWA 完整版已上线(manifest + Service Worker + offline 兜底 + iOS A2HS 引导),作为 iOS 套壳前的过渡方案;裸域 `xiaofamous.com` → `www` 的 Cloudflare 边缘 301 已配置

---

## 已讨论话题

- [目标受众与发布渠道](#已定决策)
- [套壳目标(访客端 vs admin)](#已定决策)
- [需要的原生功能](#已定决策)
- [技术方案选型](#已定决策)
- [App 显示名称](#已定决策)
- [User-Agent 标识策略](#已定决策)
- [仓库结构](#已定决策)
- [Apple Developer 账号](#未决问题)
- [图标设计与 Bundle ID 终稿](#未决问题)
- [离线缓存策略深度](#已定决策)
- [跨设备协作流程](#已定决策)
- [PWA 过渡方案(2026-05-08)](#已定决策)
- [裸域 → www 重定向(2026-05-08)](#已定决策)

---

## 已定决策

### 2026-05-07 · 受众与发布渠道
**先 TestFlight 内测,后面再考虑上架 App Store**
- 理由:先快速做出能装的版本验证体验,等功能丰富了再走正式审核
- 放弃的选项:① 一开始就上架(纯壳大概率被拒,4.2 最低功能性);② 完全自用不上架(以后想给陌生人用要重做)
- 影响:Phase 1 不用对着 4.2/4.3 死磕,但要把"以后能过审"的口子留好(原生功能至少 1-2 个真实交互)

### 2026-05-07 · 套壳目标
**只套访客端 `www.xiaofamous.com`,admin 不做**
- 理由:admin 是内网用,工作站直接浏览器就行;访客端才是流量入口和价值所在
- 放弃的选项:同时套两端(工作量翻倍且 admin 暴露公网有安全成本)
- 影响:WebView 只加载白名单域名(`www.xiaofamous.com` + 可能的 `xiaofamous.com`),其他链接走 Safari 打开

### 2026-05-07 · 原生功能清单
**最小必备:① 相机/相册上传(可能 WebView 自动支持) ② 离线缓存 ③ 启动闪屏**
**显式不做:推送通知、原生分享、原生账号体系**
- 理由:相机相册是评论上传必用;离线缓存让断网时不至于白屏;启动闪屏是"看起来像 App"的最低门槛;推送以后再说,不为内测做
- 放弃的选项:推送通知(需要 APNs 证书 + 后端发推接口,中等工作量,内测阶段没必要)
- 影响:不需要后端改造,iOS 端工作量集中在 WebView 配置和缓存策略

### 2026-05-07 · 技术方案
**纯 Swift + WKWebView,不用 Capacitor / React Native**
- 理由:① 站点是 vanilla JS,引 Capacitor 是杀鸡用牛刀,体积膨胀到 20-30MB;② 纯 Swift 包 5-10MB,启动快;③ 相机相册靠 WebView 内置支持 + 必要时 PHPicker 桥接;④ 离线缓存用 `WKWebViewConfiguration` + `URLCache`,iOS 标配
- 放弃的选项:Capacitor(过重)、React Native WebView(完全不必要)、PWA / WebClip(用户已选 TestFlight 路线,不是单纯加到主屏)
- 影响:Xcode 项目独立,放在仓库 `ios/` 目录或单独仓库(待定);构建产物不进 web 仓库 git

### 2026-05-07 · App 显示名称
**`Xiaofamous`(纯英文)**
- 理由:用户已选,品牌一致
- 放弃的选项:`小飞马`、`小飞马 Talk`
- 影响:Bundle ID 拟用 `com.xiaofamous.app`(待 Q2 终稿确认);LaunchScreen 文字部分跟 web header 风格保持一致

### 2026-05-07 · UA 标识策略
**不加自定义 User-Agent 后缀,与 Safari 完全一致**
- 理由:用户决定保持简单,后端无需为 App 做特殊逻辑
- 放弃的选项:` XiaofamousApp/1.0` 后缀
- 影响:服务端日志里 App 流量与 Safari 流量混在一起,后续若需要分流再加;不阻塞当前进度

### 2026-05-07 · 仓库结构
**独立仓库 `xiaofamoustalk-ios`**
- 理由:用户决定职责清晰,iOS 端跟 web 端更新节奏不一致,分仓避免互相打扰
- 放弃的选项:在 `xiaofamoustalk/ios/` 子目录
- 影响:① 需要在 GitHub 新建 repo;② Claude(Linux 工作站)和 Xcode(Mac)之间要约定协作流程,见下条

### 2026-05-07 · 跨设备协作流程
**用户在 GitHub 建空仓库 → 给 Claude URL → Claude 在 Linux clone + 写脚手架 + push → 用户在 Mac clone 用 Xcode 打开**
- 理由:Linux 已配好 SSH(用户 `andrewlikeworld-art`,`ssh -T git@github.com` 通过),Claude 直接产出可用工程,Mac 端零配置
- 放弃的选项:rsync/scp 手动同步、Mac 先建工程再 push
- 影响:Phase 1 启动条件 = 用户先去 GitHub 建空 repo `xiaofamoustalk-ios`(初始化时**不要**勾 README/`.gitignore`/license,Claude 会写),并给 Claude URL

### 2026-05-07 · Bundle ID
**`com.xiaofamous.app`**
- 理由:简洁,不绑死 talk 子产品名,以后多个 App 可以走 `com.xiaofamous.*` 同一体系
- 放弃的选项:`com.xiaofamous.talk`(过窄)、`com.xiaofamous.xiaofamous`(重复难看)
- 影响:Xcode 工程 PRODUCT_BUNDLE_IDENTIFIER 设为这个;App Store Connect 注册同一标识

### 2026-05-07 · 离线缓存策略
**iOS `URLCache` + 原生断网兜底页(方案 a + c)**
- 理由:Phase 1 简单可靠,断网时不白屏;Service Worker 等以后真有需求再做
- 放弃的选项:Service Worker 方案 b(WKWebView SW 支持有坑,不为内测多花成本)
- 影响:`AppDelegate` / `SceneDelegate` 配 `URLCache.shared` 默认 50-100MB;原生 `UIView` 监听 `Reachability`,断网时盖在 WebView 上方
- 2026-05-08 备注:Web 端为 PWA 写了 Service Worker(`public/service-worker.js`),iOS 套壳启动后这两套缓存独立,SW 是浏览器/PWA 模式生效,iOS 壳里走 `URLCache`,互不干扰

### 2026-05-08 · 改走 PWA 完整版作为过渡
**因 Apple Developer 账号注册卡点,先做 PWA 完整版抢一天上线;iOS 套壳路线保留,账号下来后恢复**
- 理由:① 苹果账号实名审核延迟,等不起;② PWA 用现有 Web 栈零成本扩展,iOS Safari 添加到主屏后视觉接近 App;③ Service Worker 缓存策略对将来 iOS 壳可双向参考
- 放弃的选项:① Android APK 套壳(主要受众在 iOS);② iOS 免费签 7 天版(只能自用,无意义)
- 落地内容:
  - `public/manifest.webmanifest`(name/icons/standalone/theme-color `#c94a3d`)
  - `public/service-worker.js`(app shell stale-while-revalidate;`/uploads/*` cache-first 上限 200 条;`/api/*` 和 `/admin*` 直通不缓存;断网 → `/offline.html`)
  - `public/offline.html`、`public/js/pwa.js`(SW 注册 + iOS Safari A2HS 引导卡片,localStorage 14 天不再提)
  - `public/icons/`(SVG + 192/512/180/32 PNG,赤红底 "x·t" 占位,Phase 2 换正式图标)
  - `server.js` 加中间件:SW 不缓存、manifest `max-age=300`、`/icons/*` 30 天 immutable、加 `Service-Worker-Allowed: /` 头
- 影响:① iOS 套壳的图标占位(原 Q3)直接用 PWA 这套 SVG/PNG,继续往后用;② 上线后所有改 SW 的事都要 bump `CACHE_VERSION` 让客户端拉新

### 2026-05-08 · 裸域 `xiaofamous.com` → `www` 重定向
**Cloudflare 边缘 Redirect Rule + Dynamic 表达式,不走 tunnel,不改代码**
- 理由:边缘 301 不消耗 tunnel 流量,无需 server.js 处理;DNS 用 CNAME flattening 把 apex 指向 www
- 放弃的选项:① Static + Preserve URL path(**Single Redirects 的 Static 模式根本没这选项**,那是 Bulk Redirects 的参数);② tunnel ingress 加 apex + server.js 加 301(多走一跳网络,无收益)
- **Cloudflare Dashboard 操作清单(踩过坑后的最终版)**:
  1. **DNS** → Add record:Type `CNAME`,Name `@`,Target `www.xiaofamous.com`,Proxy 🟠 **Proxied**(必须开,否则 Redirect Rule 不生效)
  2. **Rules → Redirect Rules → Create rule**:
     - Rule name: `Apex to WWW`
     - When: Custom filter expression `(http.host eq "xiaofamous.com")`
     - Then: **Type = Dynamic**(不是 Static!),Expression = `concat("https://www.xiaofamous.com", http.request.uri.path)`,Status `301`,勾 Preserve query string,Place at = Last
- 影响:以后再加这种 apex 类重定向,默认走 Dynamic + concat;Static 模式只在"整域跳到一个固定 URL,不需要保留路径"时才用

### Q1 · Apple Developer 账号 ⚠️ 关键路径
- 用户申请遇到卡点(具体卡在哪步用户尚未细说,可能是实名材料 / 付款 / 审核)
- **2026-05-08 应对**:已先做 PWA 完整版上线,iOS 套壳整体推迟到账号问题解决后恢复
- 不申请也能在 Mac 模拟器跑;真机调试要免费 Apple ID 签证书(7 天过期);**TestFlight 必须付费账号**
- 行动:用户继续推进申请,过程中如需协助(申请页面术语、材料要求等)随时问 Claude
- 卡在:用户操作 + Apple 审核

### Q2 · GitHub 空仓库
- 用户去 https://github.com/new 创建空仓库 `xiaofamoustalk-ios`
  - **不要**勾选初始化 README / .gitignore / license(留空,Claude 会写)
  - Visibility 建议 Private(以后想公开再改)
- 创建完把 SSH URL `git@github.com:andrewlikeworld-art/xiaofamoustalk-ios.git` 给 Claude
- 卡在:用户操作

### Q3 · 图标占位
- web 端只有 emoji 🦄 + 紫色 logo-dot,没有现成 1024×1024 PNG
- Phase 1 用占位:纯色背景(取 web 主色 `--primary`)+ 中央白色 "X" 字 / `🦄` emoji 渲染
- 正式图标 Phase 2 再做(可以请人画或用 Midjourney / Sora 生成)
- 卡在:可推迟,Claude Phase 1 直接生成纯色 + 字符占位

---

## 下一步

### 当前阶段(2026-05-08 · PWA 上线日)

**用户在做**:
1. iPhone Safari 验收 PWA(打开 https://www.xiaofamous.com → 看 A2HS 卡片 → 添加到主屏 → 全屏体验 → 飞行模式断网测试 → 评论上传相机)
2. 验证 apex 重定向(`curl -I https://xiaofamous.com` 应该 301 到 www)
3. 继续推进 Apple Developer 账号申请

**Claude 等待**:
- 用户验收 PWA 通过后,把今天的改动分 3 个 commit:
  1. PWA 核心资源(manifest / SW / offline / icons)
  2. index.html 集成 + js/pwa.js(SW 注册 + iOS A2HS 引导)
  3. server.js Cache-Control 中间件 + 本讨论文档更新
- 苹果账号下来 + GitHub 空 repo 建好后,恢复下面的 iOS Phase 1 计划

### iOS Phase 1 计划(账号到位后激活)

启动条件:① Apple Developer 账号通过审核 ② 用户在 https://github.com/new 建空 repo `xiaofamoustalk-ios`(不要初始化 README / .gitignore / license,Claude 会写),把 SSH URL 给 Claude

Claude 收到 URL 后:
1. clone 空仓库到 `/home/andrew/xiaofamoustalk-ios/`
2. 用文本方式生成 Xcode 工程(`.xcodeproj` + `project.pbxproj` + Swift 源码 + Info.plist + Assets.xcassets + LaunchScreen.storyboard)
3. 工程内容:
   - SwiftUI App 入口 + 一个 `WebView` 包装 `WKWebView`
   - 加载 `https://www.xiaofamous.com/`,白名单跳转规则(同域内跳转留 WebView,外链走 Safari)
   - `URLCache` 配 50MB 内存 + 200MB 磁盘
   - 原生断网兜底页(`Reachability` 检测 + 全屏占位)
   - LaunchScreen + 占位图标(直接复用 PWA 那套 SVG/PNG)
4. 写 README:Mac 上 clone 后怎么打开 + 调试 + 打包
5. push 到 GitHub
6. 通知用户去 Mac 上 clone

Phase 1 末尾(用户在 Mac 上):
1. `git clone git@github.com:andrewlikeworld-art/xiaofamoustalk-ios.git`
2. 双击 `.xcodeproj` 打开 Xcode
3. 选 iPhone 模拟器,Cmd+R 运行,验证基本 WebView 加载
4. 真机调试(等开发者账号下来):验证相机相册上传是否 work
5. Archive 上传 TestFlight,邀自己装

预计工作量:Phase 1 总共 1-2 个工作日,Claude 端脚手架 ~半天,Mac 端验证 + TestFlight 上传 ~半天(账号到位前提下)。

---

## 历史归档

(讨论稳定后,Phase 1 完成时把已定决策提炼成正式 spec,本文件归档到 `docs/history/`)
