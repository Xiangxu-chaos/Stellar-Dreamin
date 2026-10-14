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

12. **后端最终方案：自建免备案 API（Cloudflare Worker + D1）**。
    Supabase（国内被墙 + 代理域名始终 NXDOMAIN）与腾讯云 CloudBase 两套方案
    **已全部废弃并彻底移除**。
    ⚠️ 已删除：`src/core/supabaseClient.js`、`src/core/cloudbaseClient.js`、
    `sql/01_init_schema.sql`。`index.html` **不再引入任何第三方 SDK**
    （唯一外链只剩 Google Fonts），注册/登录/上报全部走原生 `fetch`。

    **接口（全部 POST + JSON，Base = `https://api.stellar-dreamin.site`）**
    - `POST /api/register` `{username, password}` → `{success:true, userId}`
    - `POST /api/login`    `{username, password}` → `{success:true, userId}`
    - `POST /api/record`   `{userId, type, word, domainId}` → `{success:true}`
    （2026-10-14 实测：CORS `Access-Control-Allow-Origin: *`，允许 POST/OPTIONS，
    `Content-Type` 可带；错误体字段是 **`error`** 不是 `message`：
    登录失败 `401 {"error":"用户名或密码错误"}`，重名注册 `400 {"error":"用户名已存在"}`。
    ⚠️ 后端对**缺 password** 的注册请求不校验，会直接建号，客户端已自行拦截空密码。）

    ✅ **唯一接触后端的模块 = `src/core/authService.js`**（唯一出现 `fetch` 的
    认证/上报代码）。导出：`API_BASE` / `SESSION_KEY='wb:cet6:auth'` /
    `RECORD_TYPES{favorite,wrong,mastered}` / `loadSession` / `saveSession` /
    `clearSession` / `getUserId` / `isSignedIn` / `register` / `login` /
    `registerAndSignIn` / `loginAndSignIn` / `logout` / `reportRecord` /
    `translateAuthError`。
    `loadSession()` 兼容两种历史形态：纯 userId 字符串、`{userId,username}` JSON；
    存储访问全部 try/catch，损坏时按未登录处理。
    `postJSON` 带 `AbortController` 超时（12s），错误带 `code`
    （`input|timeout|network|http|bad-json|api`）再交给 `translateAuthError` 出中文。

    **路由（`src/main.js`）**：读 `authService.loadSession()` ——
    有会话 → `createHomePage({userId, username, onSignOut})`；
    无会话 → `createLoginView({onSuccess})`。
    `onSuccess` 里 `saveSession` 已由 `loginAndSignIn`/`registerAndSignIn` 完成，
    main 只负责切视图（**没有用整页 reload**，效果等价且不闪屏）。
    退出登录走 `confirmDialog`（`components/modal.js`）确认 → `authService.logout()`
    → 回登录页。`currentView` 状态位（'app'|'login'）防重复挂载。
    `homePage` 只经 props 收 `{userId, username, onSignOut}`，顶栏为
    `.topbar__user` = `当前用户：{userId}` + `.topbar__user-out` 退出按钮；
    **未注入 userId 时不渲染**（保持 Node 测试的旧 DOM 结构）。

    **行为上报（旁路统计，失败静默、绝不影响本地功能）**
    - 收藏 → `homePage.handleToggleFavorite` 里 `if (actual) report(FAVORITE,...)`
    - 标记熟词 → `handleToggleMastered` / `handleMoveToMastered` → `report(MASTERED,...)`
    - 答错 → **`quizService.submitQuizAnswer`** 内 `if (!correct) reportRecord(WRONG)`
      （单点触发：所有做题入口都经过它，保证「一次作答只上报一次」且不会漏）
    `reportRecord` 是 fire-and-forget，未登录直接 `Promise.resolve(null)`，
    内部 `.catch` 吞错。

    ⚠️ **本阶段不做数据隔离**：收藏/错题/熟词仍全部走本地 localStorage，
    `/api/record` 只上报、不回写、不参与渲染。数据迁移是下一阶段任务。
    四张表的字段设计仍沿用：`favorites` / `wrong_words` / `mastered_words` /
    `user_domains`（`user_domains` 是领域订阅，**天然没有 word 字段**）。

13. **性能铁律（2026-10-14 定稿，改动前务必先读）**
    - **启动非阻塞**：`index.html` 的 `#boot-splash` 是**启动骨架屏**
      （内联 HTML/CSS + 3 个 `.sk-card`，0 依赖 0 网络 → 解析完即可见），
      文案是「加载中…」，**不得再写回 `Loading Word Bank`**。
      另有内联兜底脚本：3.5s 后仍存在则显示 `#boot-retry` 重试按钮。
    - `main.js` 有 `export const BOOT_TIMEOUT = 3000` + `withTimeout(promise, ms, fallback)`
      （**超时不 reject**，返回 `{timedOut, ok, value, error}`）。
      词库 `ensureLoaded()` 与 `resolveSession()` **各带 3s 超时**，
      且词库加载**不阻塞**路由决策（先拿 `bankTask` 再判会话）。
      会话超时 → 视为未登录 + 「登录验证超时，请重试」。挂载视图后立刻
      `removeSplash()`（不等词库），并清 `window.__bootSplashTimer`。
    - `homePage` 有 `BANK_TIMEOUT = 3000` 软超时守卫：超时 → `renderBankTimeout()`
      （「词库加载超时 + 重新载入」），词库晚到则正常渲染（自愈）。
      **任何路径都不允许无限停留在骨架屏。**
    - **懒渲染铁律**：`PAGE_SIZE = 30`、`MAX_RENDER_CARDS = 50`、
      `renderStep() = Math.min(PAGE_SIZE, MAX_RENDER_CARDS)`。
      首屏只渲染 `state.words.slice(0, state.visibleCount)`；
      「加载更多」必须走 `extendGrid()` / `extendList()` **增量追加**
      （禁止整表重渲染，否则丢失翻面状态 + 卡顿），单批增量恒 ≤ 30 ≤ 50。
      收藏夹用 `state.favVisible` 分页（重渲染式）。
      `selectDomain` / `refreshVisibleCards` / `switchTab('favorites')` 都要重置分页。
    - **领域切换有竞态守卫** `loadSeq`（`const seq = ++loadSeq`，回来时
      `seq !== loadSeq` 丢弃）——快速连点领域不会被慢请求覆盖。
      另外 `syncUserStateDebounced = debounce(…, 200)` 在 `selectDomain` 末尾调用，
      为将来「向后端拉用户状态」预留 200ms 防抖（当前 `authService.fetchUserState`
      未导出 → 空操作，**没有新增任何后端请求**）。
    - **内存缓存（第二次切回同领域秒开的来源）**：
      · `wordBankService.domainWordsCache`（键 `domainId|词库集合`）缓存
        `computeDomainWords()` 的全量匹配+排序结果；命中直接返回**同一数组本体**，
        `limit`/`minScore` 只在缓存上切片/过滤。切词库/注册自定义词库会失效缓存。
      · `domainMaterialService.ensure()` 命中 `materialCache` 直接同步返回；
        导出 `isLoaded` / `peekMaterials` / `peekMaterial` / `clearCache`。
    - 卡片 DOM 只在 `homePage.buildGrid/buildList` 生成，**新增渲染入口必须同样分页**。

14. **启动骨架屏 / 分页器样式落点**（`components.css` 第 20 节）：
    `.loading-head` / `.skeleton-grid` / `.skeleton-card`(+`__figure`/`__bar`) /
    `@keyframes skeleton-shimmer` / `.card-flow` / `.card-pager` / `.card-pager__btn` /
    `.card-pager__hint`；`responsive.css` 小屏 `.skeleton-grid` 两列 + 分页按钮占满宽。


（历史）8. 合法图源白名单（仅在对未来恢复配图时有参考价值）：
   `steamcdn-a.akamaihd.net`、`media.valorant-api.com`、`game.gtimg.cn`。
   加新图前**必须**用 `tools/validateImageUrls.mjs` 实测
   `200 + image/* + 实际字节 >1KB`，不通过就留空。
   ⚠️ 不用 Fandom（`static.wikia.nocookie.net` 实测 404 + referer 校验）。

## 测试

`tools/` 下全部为 Node 环境（自建 DOM/BOM shim），无需浏览器。
改动前全跑、提交前全跑（**17 个脚本** / 0 失败期望）：
`verifyIncrement` / `verifyFeatures4` / `verifyImageStandard` / `verifyCardLayout` /
`verifyWiring` / `verifyAuth` / `smokeDom` / `verifyFavorites` / `verifyNoWriteOnRead` /
`verifyFix3FavoriteConsistency` / `verifyTasksII_III` / `verifyWordCase` /
`verifyExampleCoverage` / `verifyExampleRender` / `verifyFillLogic` /
`verifyMaterialResilience` / **`verifyPerformance`**。

改卡片布局相关代码后**至少要跑** `verifyCardLayout` + `verifyImageStandard` + `smokeDom`。
改认证 / 路由相关代码后**至少要跑** `verifyAuth` + `smokeDom` + `verifyWiring`。
改启动流程 / 领域切换 / 渲染量相关代码后**至少要跑** `verifyPerformance` + `smokeDom`。

`verifyPerformance.mjs`（89 断言）锁死性能契约：index.html 启动骨架屏与内联兜底脚本
（且不得出现 `Loading Word Bank`）、main.js 的 `BOOT_TIMEOUT=3000`/`withTimeout`/
两个 3s 超时/骨架屏移除时机、homePage 的 `PAGE_SIZE=30`/`MAX_RENDER_CARDS=50`/
`renderStep`/增量追加/`loadSeq`/200ms 防抖/`BANK_TIMEOUT`、
两个 service 的缓存 API 与缓存键、CSS 骨架屏与分页器；
动态部分验证「第二次调用返回同一数组且零新增请求」「材料二次读取零新增 fetch」
「首屏 30 张、加载更多 +30、切换领域回 30、列表 ≤50 行」「无未捕获 rejection」。
`verifyImageStandard.mjs` 现验证「图片功能已下线」：imageUrl 全空、无 `<img>` 逻辑、
无 FileReader、16/9 + overflow:hidden + 灰底、无随机图库、分层边界（47 断言）。
`verifyCardLayout.mjs`（66 断言）锁死：卡片只用 min-height、单词 `flex-shrink: 0`、
正面徽标 ≤3 个且只能是「领域名 / 官方认证 / 核心词|派生词」、正面无 source/warn 徽标、
背面保留来源徽标与例句区。
`verifyAuth.mjs`（152 断言）锁死：authService 的三个接口路径 / POST+JSON / 超时 /
会话键 `wb:cet6:auth` / 上报体严格等于 `{userId,type,word,domainId}` /
fire-and-forget / 未登录不上报 / 中文错误文案（含 401、409、超时、非 JSON、
`{success:false}`）；index.html 不再有第三方 SDK；main.js 路由守卫与退出登录；
homePage 顶栏「当前用户：{userId}」+ 三处上报 + 分层边界（不碰 localStorage/fetch）；
quizService 答错单点上报；loginView 双标签/输入框/成功回调/失败提示 + 分层边界；
CSS 的 `.auth*` 与 `.topbar__user*`；旧方案文件已删。
动态部分用**假 fetch** 跑通注册/登录/超时/网络失败/409/401/非 JSON/缺 userId
共 9 条错误路径 + 上报 payload + 未登录跳过，再渲染 loginView（登录态/注册态/
成功/失败）与 homePage 顶栏，**全程不联网**。

⚠️ 易踩的坑：
1. 断言若直接匹配**文件原文**，注释里的字样会污染结果。
   已有两次教训（旧域名留在注释里导致「假通过」；注释写「不 import xxx」导致假失败）。
   凡涉及「不得出现某字符串」的断言，一律先剥注释再匹配。
2. shim 的 `querySelector` **只搜后代、不搜自身**，也不支持后代组合器
   （`.a b` 会被当成一个类名）。根节点要用 `_cls.has()` 判断。
3. shim 的 `style` 必须是带 `setProperty` 的对象（`themeManager` 会调它）；
   shim 的 `window` 还必须提供 **`setTimeout` / `clearTimeout`**
   （`themeManager.applyTheme` 换肤动画会调 `window.setTimeout`）。
   ⚠️ 只切一次领域不会触发它（`currentThemeId` 首轮为空），**连切两次才暴露** —— 
   写涉及「多次切换领域」的测试时务必先补上。

本地预览：`启动本地预览.bat`（端口 8099）。
沙箱**有外网**（baidu / cloudflare / github / `api.stellar-dreamin.site` 实测均通），
但走的是 `https_proxy` 网关，**访问本地 8099 要加 `--noproxy '*'`**，否则会得到 502。
自建后端已实测可用，**登录闭环可在浏览器里真正跑通**（不再有「只能在浏览器确认」的悬案）。
