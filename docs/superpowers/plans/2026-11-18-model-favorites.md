# 模型配置收藏（Ctrl+F）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `/team` 的内嵌模型配置中支持 `Ctrl+F` 收藏/取消收藏模型，收藏项置顶显示，全局共享。

**Architecture:** 收藏是纯界面偏好，存在 TUI 插件自己的 `ctx.storage.store("team-favorites")`，不进入 server 模型策略；列表分组、toggle 与存储规范化做成 `view/model.ts` 的纯函数并用 `node --test` 覆盖，JSX 只负责接线与键盘。

**Tech Stack:** OpenCode V2 TUI 插件（SolidJS + `@opentui/solid`）、Node ≥ 24 原生测试、esbuild。

**Spec:** 本次对话中已批准的设计（收藏全局共享、与 `/models` 独立、FAVORITES 置顶、行内标记、Ctrl+F 切换、不做收藏循环）。

## Global Constraints

- 全程简体中文；提交信息用中文；未经明确授权不提交、推送或发布。
- 不读写宿主 `state/model.json`；收藏只用公开的 `ctx.storage.store`。
- 不新增运行时依赖；相对导入带显式 `.ts` / `.tsx` 扩展名。
- 注释只解释不显然的约束，不写来源、迁移或任务背景。
- 测试只写业务行为；不为 JSX 渲染写临时探针，TUI 冒烟由用户执行。
- 收藏引用统一为基础引用（`providerID/modelID`），不含 Variant。
- 文档与 CHANGELOG 在同一次改动中更新。

## Review Focus

- 搜索命中收藏项时不得同时在 FAVORITES 与 Provider 分组重复出现；空分组不渲染。
- 收藏的模型不在当前目录时，界面不崩溃、不显示空行，存储值不得被清掉。
- 存储值损坏时按合法项工作并保留原值，不写回清空；非法项被忽略而不是让界面报错。
- `Ctrl+F` 在恢复确认条打开、保存进行中、搜索无结果或没有选中模型时不得写入。
- `Ctrl+F`、`Ctrl+R` 与常驻搜索框的输入互不干扰；窄终端下标记不挤压模型名。

---

### Task 1: 收藏纯函数与分组

**Files:**
- Modify: `plugin/opencode-team/view/model.ts`
- Test: `tests/team-view.test.ts`

**Interfaces:**
- Consumes: 现有 `ModelGroup`、`providerLabel`、`isChatModel`、`parseModelRef`、`modelRefOf`。
- Produces:
  - `export const FAVORITES_GROUP_ID = "__favorites__"`
  - `export function normalizeFavorites(value: unknown): string[]`
  - `export function toggleFavorite(favorites: readonly string[], ref: string): string[]`
  - `modelGroups(models, providers, query, favorites?: readonly string[]): ModelGroup[]`
  - `ModelGroup` 增加 `readonly favoriteGroup?: boolean`，收藏组 `providerName` 为 `"FAVORITES"`。

- [ ] **Step 1: 写失败测试**

在 `tests/team-view.test.ts` 的模型分组测试后加入：

```ts
test("收藏分组置顶，收藏模型不再在 Provider 分组重复", () => {
  const grouped = modelGroups([ALPHA, BETA], PROVIDERS, "", ["provider-b/beta"])
  assert.deepEqual(grouped.map((group) => group.providerName), ["FAVORITES", "Provider A"])
  assert.deepEqual(grouped[0]!.models.map((model) => model.id), ["beta"])
  assert.deepEqual(grouped[1]!.models.map((model) => model.id), ["alpha"])
})

test("收藏分组同样参与搜索过滤，空结果不产生空分组", () => {
  assert.deepEqual(
    modelGroups([ALPHA, BETA], PROVIDERS, "Alpha", ["provider-b/beta"]).map((group) => group.providerName),
    ["Provider A"],
  )
  assert.deepEqual(
    modelGroups([ALPHA, BETA], PROVIDERS, "Beta", ["provider-b/beta"])[0]!.models.map((model) => model.id),
    ["beta"],
  )
})

test("收藏引用不在当前目录时不出组、不报错", () => {
  assert.deepEqual(modelGroups([ALPHA], PROVIDERS, "", ["provider-b/gone"]), [
    { providerID: "provider-a", providerName: "Provider A", models: [ALPHA] },
  ])
})

test("收藏切换只增删基础引用，存储值规范化丢弃非法项", () => {
  assert.deepEqual(toggleFavorite([], "provider-a/alpha"), ["provider-a/alpha"])
  assert.deepEqual(toggleFavorite(["provider-a/alpha"], "provider-a/alpha"), [])
  assert.deepEqual(
    normalizeFavorites({ models: ["provider-a/alpha#high", "provider-a/alpha", "bad", 3] }),
    ["provider-a/alpha"],
  )
  assert.deepEqual(normalizeFavorites(undefined), [])
  assert.deepEqual(normalizeFavorites({ models: "x" }), [])
})
```

同时扩展 import：加入 `normalizeFavorites`、`toggleFavorite`。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --test-name-pattern="收藏"`
Expected: FAIL，报 `normalizeFavorites is not a function` 或分组数量不符。

- [ ] **Step 3: 实现纯函数**

在 `view/model.ts`：

```ts
export const FAVORITES_GROUP_ID = "__favorites__"

export function normalizeFavorites(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return []
  const models = (value as { models?: unknown }).models
  if (!Array.isArray(models)) return []
  const result: string[] = []
  for (const entry of models) {
    if (typeof entry !== "string") continue
    const parsed = parseModelRef(entry)
    if (parsed === undefined) continue
    const base = `${parsed.providerID}/${parsed.id}`
    if (!result.includes(base)) result.push(base)
  }
  return result
}

export function toggleFavorite(favorites: readonly string[], ref: string): string[] {
  return favorites.includes(ref)
    ? favorites.filter((favorite) => favorite !== ref)
    : [...favorites, ref]
}
```

`modelGroups` 增加第 4 参数 `favorites: readonly string[] = []`：
- 抽出内部匹配函数，按现有 `name/id/providerID/providerName/ref` 规则过滤。
- 收藏组：`favorites` 中能在 `models` 找到且通过搜索的模型，组对象为
  `{ providerID: FAVORITES_GROUP_ID, providerName: "FAVORITES", favoriteGroup: true, models }`，排在所有 Provider 组之前；空则不生成。
- Provider 分组继续排除所有收藏引用，不论该收藏项是否被搜索过滤。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test --test-name-pattern="收藏"`
Expected: PASS；再跑 `node --test` 全绿。

- [ ] **Step 5: 提交（需用户授权）**

```bash
git add plugin/opencode-team/view/model.ts tests/team-view.test.ts
git commit -m "feat: 模型分组支持收藏置顶"
```

---

### Task 2: TUI 存储与 Ctrl+F 接线

**Files:**
- Modify: `plugin/opencode-team/view/configure.tsx`
- Modify: `plugin/opencode-team/view/dashboard.tsx`
- Modify: `plugin/opencode-team/view/model-config.tsx`

**Interfaces:**
- Consumes: Task 1 的 `normalizeFavorites`、`toggleFavorite`、`FAVORITES_GROUP_ID`。
- Produces:
  - `TeamDashboardProps` 与 `ModelConfigProps` 各增加
    `readonly favorites: readonly string[]`
    与
    `readonly toggleFavorite: (ref: string) => Promise<{ readonly ok: boolean; readonly error?: string }>`。

- [ ] **Step 1: configure.tsx 初始化持久化收藏**

```ts
const [favorites, setFavorites] = ctx.storage.store("team-favorites", {
  initial: { models: [] as string[] },
})
```

渲染 `TeamDashboard` 时传入：

```tsx
favorites={normalizeFavorites(favorites)}
toggleFavorite={async (ref) => {
  try {
    await setFavorites((draft) => {
      draft.models = toggleFavorite(normalizeFavorites(draft), ref)
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}}
```

- [ ] **Step 2: dashboard.tsx 透传**

`TeamDashboardProps` 增加两个字段，原样传给 `ModelConfigView`。

- [ ] **Step 3: model-config.tsx 接入分组与快捷键**

- `ModelConfigProps` 增加 `favorites`、`toggleFavorite`。
- `groups()` 调用 `modelGroups(props.models, props.providers, query(), props.favorites)`。
- `ModelList` 增加 `favorites: readonly string[]`，收藏行在“当前”标记前渲染 `收藏`（`selectedRowAccent` 色）。
- 新增命令：

```ts
{
  id: "opencode-team.model.favorite",
  bind: "ctrl+f",
  enabled: () => !pendingRestore() && !saving(),
  run: toggleFavoriteCurrent,
}
```

`toggleFavoriteCurrent`：无 `selectedModel()` 时提示“请选择一个模型”；用局部 `toggling` 防并发；根据当前是否已收藏决定文案，成功 `success`「已收藏 / 已取消收藏」，失败 `error` 并带原因；组件销毁后不再写反馈。
- `Foot` 非 minimal 分支增加 `{ key: "Ctrl+F", label: "收藏" }`。

- [ ] **Step 4: 类型与构建验证**

Run: `npm run typecheck`
Expected: 0 错误。

Run: `npm run build:tui`
Expected: 构建成功，`dist/tui.js` 生成。

- [ ] **Step 5: 提交（需用户授权）**

```bash
git add plugin/opencode-team/view/configure.tsx plugin/opencode-team/view/dashboard.tsx plugin/opencode-team/view/model-config.tsx
git commit -m "feat: 模型配置支持 Ctrl+F 收藏"
```

---

### Task 3: 文档与 CHANGELOG

**Files:**
- Modify: `docs/team-tui.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 更新 `docs/team-tui.md`**

- 模型配置键盘表增加：`Ctrl+F` 切换当前模型的收藏状态；全局共享，与 `/models` 独立。
- 「内嵌模型配置」补充：有收藏时顶部显示 `FAVORITES` 分组，收藏模型不再出现在 Provider 分组；搜索同样过滤；无收藏时不显示空分组。
- 「数据来源」补充：收藏存于 TUI `ctx.storage.store("team-favorites", …)`，跨重启保留、跨 TUI 实例同步，不进入模型策略。

- [ ] **Step 2: 更新 `README.md`**

团队面板用法加一句：模型配置中按 `Ctrl+F` 收藏当前模型，收藏项置顶，且与 `/models` 的收藏互相独立。

- [ ] **Step 3: 更新 `CHANGELOG.md`**

在 `## [Unreleased]` 下新增：

```md
### Added

- `/team` 模型配置支持 `Ctrl+F` 收藏当前模型，收藏项置顶显示；收藏全局共享，
  存在 TUI 插件存储中，与 `/models` 的收藏互相独立。
```

- [ ] **Step 4: 提交（需用户授权）**

```bash
git add docs/team-tui.md README.md CHANGELOG.md
git commit -m "docs: 记录模型配置收藏"
```

---

### Task 4: 全量验证

- [ ] **Step 1: 运行项目验证命令**

```bash
npm run typecheck
npm run check:prompts
npm run build:tui
node --test
node scripts/changelog.mjs check
npm run bundle:check
npm pack --dry-run
git diff --check
```

Expected: 全部退出码 0；`node --test` 全绿。

- [ ] **Step 2: 交付说明与用户冒烟**

报告实际改动、验证输出与未验证项；真实 TUI 的 `Ctrl+F`、标记排版、窄终端与搜索组合由用户完全重启 OpenCode 后验收。
