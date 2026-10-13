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

## 测试

`tools/` 下全部为 Node 环境（自建 DOM/BOM shim），无需浏览器：
`verifyFavorites` / `verifyIncrement` / `verifyTasksII_III` / `smokeDom` /
`verifyFix3FavoriteConsistency` / `verifyNoWriteOnRead`。改收藏 / 存储相关代码后必须全跑。
