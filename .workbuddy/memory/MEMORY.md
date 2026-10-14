# 项目长期记忆：六级单词 · 兴趣化记忆卡片

## 架构铁律（违反会导致数据损坏）

1. **分层边界**：`components/` 与 `pages/` 禁止出现 `localStorage.` / `fetch(` / 词库 JSON 路径。
   已由 `tools/verifyIncrement.mjs` 第 10 项自动断言。

2. **读取函数绝不写盘**（血的教训）。
   `dataService.js` 中所有「读」函数（`readFavoriteList` / `getFavorites` /
   `getFavoriteKeys` / `getAllFavoriteWords` / `isFavorite`）**不得包含任何写入调用**。
   - 曾因在 `readFavoriteList()` 里加「自愈回写」，导致一次普通读取就把
     localStorage 的收藏写成 `{}`（表现为「进收藏夹数字清零、刷新也空」）。
   - 任何「顺手修数据 / 迁移脏数据」的逻辑必须放在**写路径**（用户主动操作），
     并走 `updateRaw()` 串行队列；读路径只能返回归一化视图，脏数据一律忽略。
   - 已由 `tools/verifyIncrement.mjs` 第 11 项自动断言（静态解析函数体）。

3. **所有存储写操作走 `updateRaw(key, mutator)`**，禁止在业务代码里直接 `writeRaw`/`setItem`，
   否则并发点击会相互覆盖。

## 数据语义

- **收藏全局唯一**：`getFavorites()` 返回全部（跨领域），不做领域过滤、无写入副作用。
  存储为 `{ [domainId::word]: {word, domainId, favoritedAt} }` 扁平表。
- **计数口径**：顶部导航数字 = `getFavorites().length`（= 归一化后仍有效的记录条数）。
- **「单词 × 领域」模型**：同一个词可在多个领域各有独立材料与收藏记录。
- 新增兴趣领域：只改 `src/config/interestsConfig.js` + 加一份
  `src/data/domainMaterials/<id>.json` + 在 `wordBankService.MATERIAL_FILES` 加映射，
  运行时永不调 AI。

## 图片功能：已彻底移除（2026-10-14 定稿，当前状态）

4. **卡片不再显示任何图片**。用户决定暂时放弃自动配图，保留纯文字卡片。
   模板层已**删除全部** `<img>` 创建、外部图链接加载、`picsum` 等随机图库、
   图片 URL 编辑与本地上传逻辑。
   - `wordCard.buildFigure()` 恒渲染占位块；detailModal 的图片编辑区已整块删除。
   - `homePage` 去掉 `onSaveImage/onUploadImage/onClearUpload` 与 `refreshCardImage`。
   - `settingsModal` 去掉「清除配图覆盖」按钮。
   - 废弃并删除：`tools/validateImageUrls.mjs`、`tools/applyValidatedImages.mjs`、
     `tools/_imgsrc/`。
   - **严禁**再接入任何随机图库 / 图片生成服务。

5. **`imageUrl` 字段保留为空串占位**：四个领域 JSON（共 1340 条）的 `imageUrl`
   一律为 `""`，字段本身保留（`normalizeMaterial()` 兜底 `''`）。
   以后要恢复配图，只需往 JSON 填链接，无需改结构。
   - 批量清空脚本：`tools/clearImageUrls.mjs`（幂等）。
   - 规范原文仍在 `src/config/interestsConfig.js`：
     「所有领域材料必须支持 imageUrl 字段，用于卡片配图」。

6. **`domainMaterialService` 的图片解析工具保留但恒返回空串**：
   `resolveImage()` / `pickImage()` / `getMaterialWithImage()` /
   `attachMaterials()` 仍在（历史兼容），因数据层无图，解析结果恒为 `''`。
   `dataService` 的 `userImages`（上传图 Base64）与 `images`（URL 覆盖）两张表
   及 API **仍在**，仅组件层不再调用。读取函数零写入铁律不变。

7. **占位块布局铁律（不可回退）**：`.wordcard__figure` / `.detail__figure` 用
   `aspect-ratio: 16/9 + max-height + overflow: hidden`，**禁止改回固定 `height`**；
   背景统一灰色 `rgba(128,132,148,0.10)`；
   占位块 `.wordcard__ph-figure` / `.detail__figure-empty` 铺满容器、内容居中、
   `overflow: hidden`，保证卡片高度分毫不差、绝不撑破。

9. **卡片正面布局铁律（标签精简后定稿）**：
   `.wordcard` / `.wordcard--compact` **只用 `min-height`（336px / 300px），
   禁止写死 `height`** —— 标签换行时卡片必须能被自然撑高；
   `.wordcard__face` 为 `flex column`；子元素弹性分配：
   - `.wordcard__figure` = `flex: 0 1 auto; min-height: 0`（可收缩，给长标签让位）；
   - `.wordcard__badges` = `flex: none`（不被压缩，永远完整）；
   - `.wordcard__wordwrap` = `flex: 1 1 auto; min-height: 0; overflow: hidden`
     （**必须 overflow:hidden**，否则内容超出时垂直居中的单词会向上溢出盖住标签）；
   - `.wordcard__word` = **`flex-shrink: 0`**（单词绝不压缩变形，曾出现 chamber→cnamber）；
   - `.wordcard__foot` = `flex: none`。
   长领域标签换行靠 `.wordcard__badges .chip--domain { white-space: normal }`。
   **禁止**用 `position: absolute` 摆放标签 / 单词。
   已由 `tools/verifyCardLayout.mjs`（66 断言）静态 + 动态锁死。

10. **卡片正面标签铁律（只允许 3 类，顺序固定）**：
    ① 领域名 —— `buildDomainBadges()` 只返回 `chip--domain`，**文本就是 `domain.name`**，
       不得拼接 `· 官方译名`、不得显示角色/分支、不得用 `chip--domain-exact`；
    ② 认证 —— `chip--term`，文案固定 **「官方认证」**，仅 `relevance.level === 'exact'`
       时出现；普通词不加；
    ③ 词性 —— `chip--core` / `chip--derived` = 「核心词」/「派生词」。
    **正面严禁** `buildSourceChip()`（`chip--source` 显示 source 全文、`chip--warn`
    「译名待确认」）—— 来源徽标只允许出现在**背面**。
    已由 `tools/verifyCardLayout.mjs` 动态断言锁死。

11. **复习模式「移入熟词库」流转**：
    `quizView.choose()` 答案展开后，按钮组含「移入熟词库」→ 调
    `props.onMoveToMastered(word, domainId, true)`，成功后按钮固定为「已在熟词库」
    并 disabled，再 `scrollIntoView` 到「下一题」。`props.isMastered(word, domainId)`
    为真时按钮初始即禁用。
    接线链：`homePage.handleMoveToMastered` → `startReview` / `startQuiz` /
    `startWrongReview` → `createReviewGroupView({ onMoveToMastered, isMastered })`
    → `createQuizView`。
    `handleMoveToMastered` 内部：`studyService.setMastered(dId, w, true)` +
    `dataService.setFavorite(dId, w, false)`，再同步 `state.masteredKeys` /
    `state.favoriteKeys` / `state.words` / 已挂载卡片 / 顶部数字 / `reloadMastered()`。

12. **后端方案最终定为腾讯云 CloudBase**（Supabase 方案已废弃并完全移除）。
    ⚠️ 已删除：`src/core/supabaseClient.js`、`src/views/loginView.js`、
    `sql/01_init_schema.sql`（Supabase 专用）。`src/views/` 目录已不存在。
    ✅ 唯一接触 CloudBase 的地方是 `src/core/cloudbaseClient.js`。
    环境 ID：`stellar-dreamin-d2f2vgn912ba7454`（**不是密钥，可公开**）。

    **SDK 引入方式**：`index.html` 里用**传统 `<script defer>`** 引入 UMD 全量包
    `https://static.cloudbase.net/cloudbase-js-sdk/latest/cloudbase.full.js`
    （官方静态 CDN，实测 200 / 970KB；⚠️ 用户最初给的
    `imgcache.qq.com/qcloud/cloudbase-js-sdk/latest/...` 实测 **404**，不可用）。
    它把 SDK 挂到 `window.cloudbase`，client 从全局取用，**不做 import**
    （defer 脚本按文档顺序先于 module 执行，时序确定；也不再依赖 esm.sh）。
    `waitForSdk(timeout)` 轮询兜底并导出（测试传极小超时）。

    **认证方式：匿名登录**（无登录页，打开即用）。
    `ensureSignedIn()`：先 `auth.getLoginState()` 复用本地登录态（避免刷新时
    重复创建匿名用户），否则 `auth.signInAnonymously()`；`auth({persistence:'local'})`
    保证刷新免登录；`signInPromise` 缓存保证幂等，失败后清空以允许重试。
    `translateAuthError()` 覆盖 PROVIDER_NOT_ENABLED（未开匿名登录 → 提示去
    控制台「登录授权」开启）、网络失败、配额、环境无效等。

    **路由**：`src/main.js` 无登录页。启动 → 匿名登录 → 渲染 homePage。
    ⚠️ **认证失败降级不阻断**：当前学习数据仍全在本地，云同步是下一阶段；
    失败时照常渲染主界面 + 顶栏显示「离线」（`.topbar__user--offline` 警示色）
    + `showToast` + console.error，保证故障可见而非静默。
    `homePage` 只经 props 收 `{ user, authError }`，**绝不 import cloudbaseClient**；
    顶栏为「游客」（title 带匿名 uid）/「离线」，**已无退出登录按钮**（`onSignOut` 已移除）。

    **CloudBase 控制台待确认项**（2026-10-14 实测）：
    - 环境 ID 真实存在（`{env}.api.tcloudbasegateway.com` 解析并返回 401，
      `{env}.service.tcloudbase.com` 返回 404，均非 DNS 失败）。
    - 但其网关对无凭据请求返回 `MISSING_CREDENTIALS`（裸 curl 带 Origin 也一样），
      **匿名登录是否真的可用、Web 安全域名是否配置，只能在真实浏览器里最终确认**。
    - 待办：控制台 → 环境 → 登录授权 开启「匿名登录」；
      安全配置 → WEB 安全域名 加入线上域名（localhost 可能不被允许，需实测）。
    - ⚠️ 数据迁移（localStorage → CloudBase）**尚未做**，是下一阶段任务。
      四张表/集合设计沿用：`favorites` / `wrong_words` / `mastered_words` /
      `user_domains`（`user_domains` 是领域订阅，**天然没有 word 字段**）。


（历史）8. 合法图源白名单（仅在对未来恢复配图时有参考价值）：
   `steamcdn-a.akamaihd.net`、`media.valorant-api.com`、`game.gtimg.cn`。
   加新图前**必须**用 `tools/validateImageUrls.mjs` 实测
   `200 + image/* + 实际字节 >1KB`，不通过就留空。
   ⚠️ 不用 Fandom（`static.wikia.nocookie.net` 实测 404 + referer 校验）。

## 测试

`tools/` 下全部为 Node 环境（自建 DOM/BOM shim），无需浏览器。
改动前全跑、提交前全跑（16 个脚本 / 0 失败期望）：
`verifyIncrement` / `verifyFeatures4` / `verifyImageStandard` / `verifyCardLayout` /
`verifyWiring` / `verifyAuth` / `smokeDom` / `verifyFavorites` / `verifyNoWriteOnRead` /
`verifyFix3FavoriteConsistency` / `verifyTasksII_III` / `verifyWordCase` /
`verifyExampleCoverage` / `verifyExampleRender` / `verifyFillLogic` / `verifyMaterialResilience`。

改卡片布局相关代码后**至少要跑** `verifyCardLayout` + `verifyImageStandard` + `smokeDom`。
改认证 / 路由相关代码后**至少要跑** `verifyAuth` + `smokeDom` + `verifyWiring`。
`verifyImageStandard.mjs` 现验证「图片功能已下线」：imageUrl 全空、无 `<img>` 逻辑、
无 FileReader、16/9 + overflow:hidden + 灰底、无随机图库、分层边界（47 断言）。
`verifyCardLayout.mjs`（66 断言）锁死：卡片只用 min-height、单词 `flex-shrink: 0`、
正面徽标 ≤3 个且只能是「领域名 / 官方认证 / 核心词|派生词」、正面无 source/warn 徽标、
背面保留来源徽标与例句区。
`verifyAuth.mjs`（88 断言）锁死：CloudBase 环境 ID 与 SDK 取用方式
（window.cloudbase 全局 + static.cloudbase.net + defer）、init/auth 参数、
匿名登录调用与幂等、中文错误文案（含 PROVIDER_NOT_ENABLED）、本阶段不碰
`.collection()`、main.js 无登录页且降级不白屏、homePage 三态顶栏
（不注入→无用户区 / user→「游客」无按钮 / authError→「离线」，`.navtab` 恒为 4）、
Supabase 残留归零（文件已删 + src/ 全文无 supabase）。
动态部分用**假 window.cloudbase** 跑通 5 条认证路径 + SDK 未加载路径，不联网。

⚠️ 易踩的坑：断言若直接匹配**文件原文**，注释里的字样会污染结果。
已有两次教训（旧域名留在注释里导致「假通过」；注释写「不 import xxx」导致假失败）。
凡涉及「不得出现某字符串」的断言，一律先剥注释再匹配。

本地预览：`启动本地预览.bat`（端口 8099）。
沙箱**有外网**（baidu / esm.sh / cloudflare / github / static.cloudbase.net 实测均通），
但走的是 `https_proxy` 网关，**访问本地 8099 要加 `--noproxy '*'`**，否则会得到 502。
CloudBase 匿名登录能否跑通仍**只能在真实浏览器里**最终确认。
