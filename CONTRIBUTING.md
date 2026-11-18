<!-- 职责：贡献者的环境准备、提交与分支规范、PR/Issue 流程、本地调试、npm 分发与发版；不写：使用教程、设计契约、验证命令细节。 -->

# 贡献指南

文档地图见 [AGENTS.md](AGENTS.md#文档地图)。

## 环境

- Node ≥ 24；TypeScript 源码由宿主直接加载，测试使用 Node 原生类型擦除，无运行时依赖。
- TUI 入口发布前需要 `npm run build:tui`（`prepack` 自动执行）；本地目录调试加载源码，不需要构建。
- `npm install --no-package-lock` 只用于安装 `typecheck` 与 TUI 构建需要的依赖，不是运行测试或本地加载的前置条件。
- 源码在 `plugin/opencode-team/`，模块划分与数据流见 [TUI Dashboard](docs/team-tui.md)；
  策略、存储、Agent 注册与迁移边界见[策略契约](docs/team-policy.md)与[团队 Agent](docs/team-agents.md)。

## 提交规范

- 提交信息用**简体中文**，首行是一句可读的结论，如 `feat: 禁止 QA/Reviewer 继续派生子代理`。
- 首行前缀表示变更性质：`feat`、`fix`、`docs`、`refactor`、`test`、`chore`、`perf`。
- 一次提交只做一件事；不把重构、格式化与行为改动塞进同一提交。
- 详细动机、约束和取舍写在正文或对应文档里，代码注释只保留不显然的原因。
- 不提交生成物、临时脚本、探针和本地调试配置。

## 分支与 PR

1. 从最新 `main` 切分支，命名体现目的，如 `fix/dashboard-keys`、`docs/contributing-split`。
2. 改完先在本地跑完 [验证要求](AGENTS.md#验证要求)，再提交。
3. PR 标题与提交信息风格一致；描述写清三件事：要解决的问题、改了什么、怎么验证的。
4. 行为变化必须同步归属文档，并在同一 PR 里更新 `CHANGELOG.md` 的 `[Unreleased]`。
5. CI 必须全绿；真实 TUI 冒烟与视觉检查由维护者或用户手动完成，PR 里如实说明未覆盖的部分。
6. 不使用 force push 改写已推送的共享分支；合并前保持提交历史可读。

## Issue

- **Bug**：OpenCode 版本、安装方式（npm / 本地目录）、复现步骤、期望与实际、相关日志或面板报错。
- **功能建议**：要解决的场景、现有做法的不足、可接受的权衡；涉及模型覆盖时说明目标 Agent。
- 报告前先查[疑难解答](README.md#疑难解答)，并确认没有同时启用旧包、npm 包和本地目录三份。
- 不粘贴 token、OTP、存储内容或其他敏感信息。

## 本地调试

宿主只加载当前配置指向的那一份插件，改了本仓库源码不代表宿主会看到：

- 全局 `plugins` 写 `"@justsilver/opencode-team"` 时，运行的是 npm 已发布版本，本地改动无效；
- 调试本仓库改动时，把该项换成插件目录的绝对路径，并移除 npm 同名项（同一插件 ID 不能并存）：

  ```json
  { "package": "D:\\Code\\Projects\\Agents\\opencode-subagent-model\\plugin\\opencode-team" }
  ```

- 改完配置与代码后完全退出并重新启动 OpenCode；TUI 入口只在启动时加载，不存在热更新；
- 要让用户拿到改动，只能按「npm 分发」升版本发布，不能在本地验证通过后假定已生效。

## 验证

自动验证命令与执行要求维护在 [AGENTS.md](AGENTS.md#验证要求)，不要在别处复制一份。
CI 与 Release 工作流执行同一组检查：版本一致性、类型检查、单测、双入口 esbuild、`npm pack --dry-run`。
真实 TUI 的键盘、尺寸与视觉由人工验收，不提交临时渲染测试、探针和截图。

## npm 分发

版本单一来源为 `package.json`；发布前同步 CHANGELOG 并完成上述验证。
`publishConfig.tag = next`，npm 包白名单为插件源码、预编译的 `dist/**/*.js` 与 CHANGELOG；
README、LICENSE 由 npm 自动收录。

TUI 必须发布预编译产物：npm 插件位于 `node_modules`，宿主不会转换该路径下的 `.tsx`
（anomalyco/opencode#39986），保留 JSX 会出现“首帧渲染后不重绘”或“找不到 `@opentui/solid`”。
`prepack` 会先校验角色提示词生成物（`npm run check:prompts`），再运行 `npm run build:tui`；
`exports["./tui"]` 指向 `dist/tui.js`，构建细节见 [TUI Dashboard](docs/team-tui.md#构建)。

`@opentui/core`、`@opentui/solid`、`solid-js` 声明为 **optional** peerDependencies
（`peerDependenciesMeta`）：编译产物用普通 import 引用它们，宿主的运行时改写会指向宿主实例，
npm 不应再装一份副本。发版后装到空目录，确认 `node_modules` 里只有 `@justsilver/opencode-team`，
并且 tarball 含 `dist/tui.js`。

发版规则：

- **版本号必须先向用户确认**，再改 `package.json` 与 `CHANGELOG.md`；两者顶部必须一致。
- 不复用已发布或已撤回的版本号；`0.0.0-stage` 这类占位版本不影响安装。
- 不要用 `npm publish --dry-run` 做预检，它会因版本已存在而失败；用 `npm pack --dry-run`。
- 正式版只能手动 dispatch，不能靠推正式 tag 发布。

流水线：`ci.yml` 在 push `main` / PR 上跑版本一致性 + 类型检查 + 单测 + 双入口构建 + 打包预检；
`release.yml` 用 npm Trusted Publishing（OIDC，无长期 token）发版：

| 触发 | 行为 |
|---|---|
| push 预发布 tag（如 `v0.2.2-beta.0`） | 校验版本一致 → `npm publish --tag next` → 建/更新 GitHub Release（标 prerelease） |
| push 正式 tag（如 `v0.2.2`） | **拦下并报错**，正式版只能手动发 |
| 手动 Run workflow（默认 `publish=false`） | 只做 `npm pack --dry-run` |
| 手动 Run workflow（`publish=true` [+ 正式版需 `stable=true`]） | 发布当前版本，并补建 tag 与 Release |

预发布版本号含 `-` 才会发到 `next`；`package.json` 版本与 tag 不一致会在校验步骤直接失败。

### 发版清单

1. 确定版本号（维护者决定）：beta 用 `X.Y.Z-beta.N`，正式版去掉后缀。
2. 改 `package.json` 与 `CHANGELOG.md` 顶部并保持一致；用户可见变化写进对应章节。
3. 本地跑完 [验证要求](AGENTS.md#验证要求)。`npm run build:tui` 必须通过，`dist/` 是生成物，不提交。
4. 提交并推 `main`，等 CI 全绿。
5. beta：推 `vX.Y.Z-beta.N` tag，自动发到 `next`；正式版：Actions → Release → Run workflow，
   勾 `publish` + `stable`，发到 `latest`。
6. 发布后核对 `npm view @justsilver/opencode-team dist-tags`、tarball 含 `dist/tui.js`、空目录安装后
   `node_modules` 里只有插件本体。
7. 安装验收通过后才发正式版。已发布版本不可覆盖，出问题就递增 beta 序号重发。
8. 本机插件缓存可能仍指向旧版本，必要时删除 `~/.cache/opencode/npm/@justsilver/opencode-team@next`
   再完全重启。

### 首次发布（人工一次）

新包名 `@justsilver/opencode-team` 是全新的 npm 包，OIDC 无法创建新包（`PUT` 报 404），
所以**第一个版本必须在交互终端手工发**：

```bash
npm login
npm whoami
node scripts/changelog.mjs check --tag v0.2.0
npm publish --tag next
npm view @justsilver/opencode-team dist-tags versions --json
```

首发后到 npm → 该包 → Settings → Trusted publishing 登记仓库、Workflow filename `release.yml`、
Environment 留空，并允许 `npm publish`；新配置须在 2 天内完成一次成功发布，否则过期。
GitHub 仓库已改名为 `Just-Silver/opencode-team`，`package.json` 的 homepage/repository/bugs
已同步；登记 trusted publisher 时使用该仓库名。

首发后必须核对实际 dist-tag，不能仅靠 `--tag next` 假定 `latest` 一定不存在。
发布后 npm 可能存在元数据与 tarball 的传播延迟；确认版本、标签和 tarball 都可取后再宣告可安装。

### 旧包弃用（已执行）

旧包 `@justsilver/opencode-subagent-model` 的全部版本已执行：

```bash
npm deprecate @justsilver/opencode-subagent-model "Renamed to @justsilver/opencode-team; see migration guide"
```

规则：

1. 旧包保留可安装，不撤包，避免已锁版本的用户无法重装；
2. 不再向旧包发布新版本，只通过 deprecate 提示迁移；
3. 需要改提示文案时重复执行 `npm deprecate`（可只针对单个版本范围），不要再发版本。
