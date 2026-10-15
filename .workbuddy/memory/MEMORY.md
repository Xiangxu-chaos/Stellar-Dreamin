# 项目长期记忆：六级单词 · 兴趣化记忆卡片

纯前端 ES Module + 命令式 DOM（`h()` from `src/core/dom.js`），**无构建链**。
所有 `tools/*.mjs` 跑在 Node（自建 DOM/BOM shim），不需要浏览器。

---

## 一、架构铁律（违反会导致数据损坏）

1. **分层边界**：`components/` 与 `pages/` 禁止出现 `localStorage.` / `fetch(` / 词库 JSON 路径
   （`tools/verifyIncrement.mjs` 第 10 项静态断言）。
2. **读取函数绝不写盘**（血的教训）：`dataService.js` 所有「读」函数不得含任何写入调用。
   曾因在 `readFavoriteList()` 加「自愈回写」，一次普通读取就把收藏写成 `{}`。
   任何迁移/修脏数据逻辑只能放在**写路径**（用户主动操作）并走 `updateRaw()`；读路径只返回归一化视图。
3. **所有存储写操作走 `updateRaw(key, mutator)`**，禁止业务代码直接 `writeRaw`/`setItem`（并发点击会互相覆盖）。
4. **唯一接触后端的模块 = `src/core/authService.js`**；`index.html` 不引入任何第三方 SDK。

## 二、数据语义

- **收藏全局唯一**：`getFavorites()` 跨领域返回全部、无写入副作用；存储 `{ [domainId::word]: {...} }`；
  顶部数字 = `getFavorites().length`。
- **「单词 × 领域」模型**：同一个词可在多个领域各有独立材料与收藏记录。
- 数量类断言一律「与配置长度对比」，**不写死数字**。

## 三、领域体系（12 个领域 / 四板块）

`category` 只能是 `DOMAIN_CATEGORY.GAME='游戏' / FILM='影视' / SPORTS='体育' / OTHER='其他'`；
`DOMAIN_CATEGORY_ORDER = ['游戏','影视','体育','其他']` 即界面展示顺序。
`getDomains()` 透传 `category`（缺省 `'其他'`）+ `titleQuoted`；
`domainPicker.groupByCategory()` 分组，**未识别/缺失的 category 一律归「其他」**（卡片不能凭空消失）。
DOM 结构：`.dp-groups > section.dp-group[data-category] > (.dp-group__head + .dp-grid)`。

分布：游戏 7（原四领域 + 杀戮尖塔2 / 明日方舟 / 原神）、影视 3（绝命毒师 / 神探夏洛克 / 经典电影）、
体育 2（篮球 / 羽毛球）、其他 0。主题色由 `makeDomainTheme({...})` 工厂推导 —— **不要手写 theme**，
漏配 token 会悄悄回退成默认蓝。

**新增领域三步**（不要手写 JSON）：
① `tools/genDomainMaterials.mjs` 的 `DOMAINS` 加数据块（`file` 字段决定文件名），
   跑 `--domain=<key>`（`--dry` 只校验）；
② `interestsConfig.js` 加领域常量（`category` + `theme` + `domainTerms` + `domainVocabulary`
   + `excludedTerms` + `generationPrompt`）并登记 `INTEREST_DOMAINS` / `DOMAIN_ORDER`；
③ `wordBankService.MATERIAL_FILES` 加映射。

⚠️ **孤儿材料铁律**：材料词必须**同时**① 存在于 `src/data/cet6Core.json`（5942 词）
② 落在该领域的**召回集合**内（`studyService.buildRelatedWords()` 为准，由 `domainTerms`/`domainVocabulary`
驱动）。缺任一条 → 材料永远筛不进领域、界面永不出现。`excludedTerms` 会**整词剔除**。
已知坑：`cooper`(库珀) 会误伤 `cooperation/cooperate`，必须放进 `excludedTerms`。

## 四、卡片渲染铁律

- **图片功能已彻底移除**（2026-10-14 定稿）：无 `<img>`、无外部图链接、无随机图库（**严禁**再接）。
  `imageUrl` 字段保留为空串占位（`normalizeMaterial()` 兜底 `''`）；清空脚本 `tools/clearImageUrls.mjs`。
  `domainMaterialService` 的 `resolveImage/pickImage/...` 保留但恒返回 `''`。
- **无材料时不再显示任何兜底废话**（2026-10-15 定稿，不可回退）：
  `localDomainHint()`（wordCard / flipCard）与 `hint()`（detailModal）**已彻底删除**。
  背面只渲染真实存在的 material 字段：`domainMeaning` / `story` / `example` 缺哪块就**整块隐藏**，
  不显示「暂无例句」「该词与当前领域暂无直接对应关系」等任何占位。
  detailModal 无材料时 `metaSection()` 也返回 null。
- **占位块布局**：`.wordcard__figure` / `.detail__figure` 用 `aspect-ratio:16/9 + max-height + overflow:hidden`，
  **禁止改回固定 `height`**；灰底 `rgba(128,132,148,0.10)`。
- **卡片正面布局**：`.wordcard` 只用 `min-height`（336px / 300px），**禁止写死 `height`**。
  `.wordcard__face` flex column；`__figure` = `flex:0 1 auto; min-height:0`；
  `__badges` = `flex:none`；`__wordwrap` = `flex:1 1 auto; min-height:0; overflow:hidden`（必须 overflow，
  否则单词会向上溢出盖住标签）；`__word` = **`flex-shrink:0`**（曾出现 chamber→cnamber）；`__foot` = `flex:none`。
  长领域标签换行靠 `.chip--domain { white-space: normal }`。**禁止** `position:absolute` 摆标签/单词。
- **正面只允许 3 类标签（顺序固定）**：① 领域名（**文本就是 `domain.name`**，不拼译名、不显示角色）；
  ② 认证 `chip--term`「官方认证」（仅 `relevance.level === 'exact'`）；③ 词性「核心词 / 派生词」。
  **正面严禁** source / 「译名待确认」徽标 —— 来源徽标只能在背面。

## 五、`.dp-card` 视觉三态（勿回退）

由 `components.css` 第 22 节锁死：未选中 `saturate(0.25)+opacity 0.68`；悬停 `translateY(-3px)+border-strong`
（触摸设备在 `@media (hover:none)` 关掉）；选中 = `color-mix(... var(--domain-primary))` 渐变背景
+ `1px border + 2px 同色外环`（**不引起栅格重排，别改成真 2px border**）+ 实心主题色圆底白勾。
命名映射：组件传 `--dp-primary`，CSS 内一律用 `--domain-primary`。过渡统一 **0.2s**（不得残留 0.22s）。
勾选图标 `iconPath('check')` 尺寸 14 + `cls:'dp-card__tick'`；卡片带 `aria-pressed` / `aria-label`。

## 六、领域名称书名号（2026-10-15 定稿）

**作品（游戏/影视）加《》，体育项目等非作品不加** —— 篮球 / 羽毛球是纯文字。
唯一判定处：`src/core/domainLabel.js`（`isTitleQuoted()` / `domainLabel()`）；
优先级 `domain.titleQuoted` → `category==='体育'` → 按 id 回查配置 → 兜底按作品处理。
`BASKETBALL`/`BADMINTON` 显式 `titleQuoted:false`；`getDomains()` 已透传。
**禁止**再硬编码 `` `《${domain.name}》` ``；已接入 5 处：wordCard / flipCard / detailModal / homePage / aiService。
⚠️ `getDomains()` 是**白名单式拷贝**，新增字段必须手动加，否则下游拿不到。

## 七、后端（自建免备案 API：Cloudflare Worker + D1）

Supabase / 腾讯云 CloudBase 方案**已全部废弃并删除**（含 `supabaseClient.js`、`cloudbaseClient.js`、`sql/`）。
Base = `https://api.stellar-dreamin.site`，全部 POST + JSON：
`/api/register`、`/api/login` → `{success:true, userId}`；`/api/record` `{userId,type,word,domainId}`。
CORS `*`；错误体字段是 **`error`** 不是 `message`（401 用户名或密码错误 / 400 用户名已存在）。
⚠️ 后端对**缺 password** 的注册请求不校验会直接建号，客户端自行拦截空密码。

`authService.js` 导出：`API_BASE` / `SESSION_KEY='wb:cet6:auth'` / `RECORD_TYPES` / `loadSession` /
`saveSession` / `clearSession` / `getUserId` / `isSignedIn` / `register` / `login` /
`registerAndSignIn` / `loginAndSignIn` / `logout` / `reportRecord` / `translateAuthError`。
`loadSession()` 兼容「纯 userId 字符串」与 `{userId,username}`；损坏按未登录处理。
`postJSON` 带 `AbortController` 12s 超时，错误带 `code`（input|timeout|network|http|bad-json|api）。

路由：`main.js` 读会话 → 有则 `createHomePage({userId,username,onSignOut})`，无则 `createLoginView({onSuccess})`；
**不整页 reload**。退出走 `confirmDialog`。顶栏 `.topbar__user`；**未注入 userId 时不渲染**（保持 Node 测试的旧 DOM）。
上报（fire-and-forget，失败静默）：收藏 → `handleToggleFavorite`；熟词 → `handleToggleMastered` /
`handleMoveToMastered`；答错 → **`quizService.submitQuizAnswer` 单点上报**（保证一次作答只报一次）。
⚠️ 本阶段**不做数据隔离**：收藏/错题/熟词仍全走 localStorage，`/api/record` 只上报不回写。

## 八、性能铁律（改动前先读）

- **启动非阻塞**：`#boot-splash` 内联骨架屏（0 依赖 0 网络），文案「加载中…」，
  **不得写回 `Loading Word Bank`**；内联兜底脚本 3.5s 后显示 `#boot-retry`。
- `main.js`：`BOOT_TIMEOUT=3000` + `withTimeout()`（**超时不 reject**，返回 `{timedOut,ok,value,error}`）；
  词库加载与登录验证**并行**、各带 3s 超时；词库不阻塞路由决策；挂载后立刻 `removeSplash()`。
- `homePage`：`BANK_TIMEOUT=3000` 软超时 → `renderBankTimeout()`，词库晚到自愈。
  **任何路径都不允许无限停留骨架屏。**
- **懒渲染**：`PAGE_SIZE=30`、`MAX_RENDER_CARDS=50`；首屏只渲 `slice(0, visibleCount)`；
  「加载更多」走 `extendGrid()/extendList()` **增量追加**（禁止整表重渲染，会丢翻面状态 + 卡顿）。
  `selectDomain` / `refreshVisibleCards` / `switchTab` 都要重置分页。
- **竞态守卫** `loadSeq`（回来时 `seq !== loadSeq` 丢弃）；`syncUserStateDebounced` 200ms 防抖。
- **内存缓存**：`wordBankService.domainWordsCache`（键 `domainId|词库集合`，命中返回**同一数组本体**）；
  `domainMaterialService.ensure()` 命中 `materialCache` 同步返回（导出 `isLoaded/peekMaterials/peekMaterial/clearCache`）。

## 九、其它功能约定

- **复习模式「移入熟词库」**：`quizView.choose()` 答案展开后按钮 → `onMoveToMastered(word, domainId, true)`，
  成功后固定为「已在熟词库」并 disabled，再滚动到「下一题」；`isMastered()` 为真时初始禁用。
  接线：`homePage.handleMoveToMastered` → `startReview/startQuiz/startWrongReview` →
  `createReviewGroupView` → `createQuizView`。
- **`exampleSource`**（例句出处，与 `source` 译名来源是两个维度，**别合并**）：
  取值 `Fandom Wiki` / `AI重写` / `游戏内文本` / `AI 生成`；`normalizeMaterial` 已兜底。
  维护脚本 `tools/addExampleSource.mjs`（幂等，**带 main() 守卫**，别删）；导出 `HK_PROPER_NOUNS` / `REWRITES` 供测试复用。
  展示：`.mat__example-src`（wordCard 背面）/ `.detail__example-src`（detailModal），文案「例句来源：xxx」。

---

## 十、材料质量红线（硬性拦截，不可放宽）

`tools/genDomainMaterials.mjs` 的 `validate()` 是**唯一**写盘前置闸门：
- story ∈ **[15, 60] 字**；禁用 `VAGUE_PHRASES`（常见 / 可用以 / 可联想 / 可以建立 / 与之相关 /
  众所周知 / 可与游戏场景建立联想 …）；
- example 非空且**必须含该单词**：`exampleHasWord(word, example)` = `bare` 包含 或
  去尾 e 的 `stem`(≥5) 包含（容忍 -ing/-ed/-s；**注意 y→ies / 不规则过去式不算**）。
- **两段式写盘**：先把选中的领域**全部**校验完，任一不合格 → `exit(1)`，**一个字节都不写**。
- `export { STORY_MIN, STORY_MAX, VAGUE_PHRASES, storyLength, validate, checkMaterial, exampleHasWord, DOMAINS }`。
  `checkMaterial(key,w,m)` 是**单条红线的唯一实现**，生成器与修复工具共用。
- 生成器与已落盘 JSON **严格幂等**（`--all` 重跑 diff 为 SAME）→ 修数据正确姿势是
  「改生成器 → 重新生成」，**不要手改 JSON**。
- ⚠️ 生成器有 **merge-preserve**：`--all` 会保留磁盘上、源码里没有的条目（`--reset` 关闭），
  防止 AI 补充的材料被覆盖。

**修复 / 补齐工具链**
- `tools/fixDefectiveMaterials.mjs`：精准修复坏字段。`--patch=<file>` 用显式补丁、
  默认调 DeepSeek、`--mock` 离线自检、`--dry` 只扫描、`--gap` 补缺口。
  **字段级合并**：story 坏只改 story，example 坏只改 example+exampleZh，其余字段一字节不动。
  写盘前二次把关且**只校验本次实际修改的字段**（老库缺 `exampleSource` 不该阻止 story 修复）。
- `tools/autoFixGap.mjs`（**本轮核心**）：补齐「领域词没有材料」的缺口。
  自带 `for` 循环：按 `--batch`（默认 30）逐批处理，**每批立刻写盘**并打进度日志；
  不合格的词**二分递归重拆小批**、最后单条重试；网络错误指数退避（`--retries`，默认 4）。
  断点续跑安全（已补齐的词自动跳过）。`--dry` 计划预览 / `--mock` 离线自检 / `--tips=<json>` 注入逐词陷阱提示。
  `--noun-fix` 另一模式：只重写「例句看不出领域」的条目（仅换 example/exampleZh），
  强制含 `tools/patches/nounLists.json` 里的领域专有名词。
  ⚠️ **Node fetch shim 只许拦 `file://`**，其余 URL 必须透传原生 fetch，
  否则 DeepSeek 的 HTTPS 请求会被当成本地路径解析、得到 404 空响应（已踩坑）。
- `tools/genGapReport.mjs` → `缺口补齐报告.html`；`tools/genFixReport.mjs` → `坏词条修复对比.html`。
- `tools/genLegacyBaseline.mjs` → `tools/baselines/legacy-baseline.json`：原始四领域**原有条目**的内容指纹
  （`source` 不含「AI 补充」的条目，按 key 排序后 sha256）。补缺口会合法地增加条数，
  所以「原有条目没被改」只能靠指纹证明。**不要手改基线文件**，重冻结要重跑脚本并说明原因。
- AI 补充的条目统一 `unverified: true` + `source: '《领域》官方中文（AI 补充，待复核）'`；
  断言接受「待确认 / 待复核」两种措辞。

**测试**：`tools/verify*.mjs` + `smokeDom.mjs` 共 **22 个脚本 / 0 失败期望**。
改动前全跑、提交前全跑。按改动面选最小集合：
卡片布局 → `verifyCardLayout`+`verifyImageStandard`+`smokeDom`；
认证/路由 → `verifyAuth`+`verifyWiring`+`smokeDom`；
启动/切换/渲染量 → `verifyPerformance`+`smokeDom`；
勾选视觉 → `verifyPickerFeedback`+`smokeDom`；
材料 JSON → `verifyExampleSource`+`verifyExampleCoverage`+`verifyExampleRender`+
`verifyMaterialQuality`+`verifyDomainExpansion`；
领域配置/板块/新增领域 → `verifyDomainExpansion`+`verifyIncrement`+`verifyTasksII_III`+`smokeDom`。
⚠️ 原始四领域老数据有历史瑕疵（缺 `exampleSource`），按「旧数据保持不动」只做轻量校验，
但 **story 字数 / 空泛话术 / 例句含词** 已通过 `verifyMaterialQuality` A6~A9 **全库 12 文件统一纳入**。

### ⚠️ 易踩的坑

1. 断言若直接匹配**文件原文**，注释里的字样会污染结果（已有两次教训）。
   凡「不得出现某字符串」的断言，**一律先剥注释再匹配**。
2. shim 的 `querySelector` **只搜后代、不搜自身**，也不支持后代组合器（`.a b` 会被当成一个类名）。
3. shim 的 `style` 必须是带 `setProperty` 的对象；`window` 还必须提供 **`setTimeout`/`clearTimeout`**
   （`themeManager.applyTheme` 会调）。只切一次领域不触发，**连切两次才暴露**。
4. Node 下 `studyService`/`wordBankService` 靠 `fetch` 读本地 JSON，原生 fetch 不支持 `file://`
   （`not implemented... yet...`）→ 测试脚本必须自建 fetch shim，且**只拦 `file://`**。

**本地预览**：`启动本地预览.bat`（端口 8099）。
沙箱**有外网**，但走 `https_proxy` 网关，**访问本地 8099 必须加 `--noproxy '*'`**，否则 502。
