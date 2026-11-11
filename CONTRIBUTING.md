<!-- 职责：贡献者的开发、验证与 npm 分发；不写：使用教程、重复策略契约。 -->

# 贡献指南

文档地图见 [AGENTS.md](AGENTS.md#文档地图)。

## 环境与结构

Node ≥ 24，TypeScript 源文件直接由宿主加载，测试使用 Node 原生类型擦除，无运行时依赖。
`npm install` 仅在需要宿主类型声明时使用，不是运行测试或本地目录加载的前置条件。

```text
plugin/opencode-subagent-model/
  index.ts                 server：注册策略和 RPC
  tui.ts                   TUI：全局命令
  rpc.ts                   get/set JSON Schema 契约
  subagent-model.ts        存储、校验、执行前覆盖和执行后告知
  view/subagent-model.ts   原生选择弹窗
tests/                     业务行为用例
```

server 不能运行时依赖宿主包；TUI 不写 JSX，以免 npm 安装引入另一套 Solid 运行时。
详细策略、存储和宿主依据只维护在[策略契约](docs/subagent-model-policy.md)。

## 本地调试

宿主只加载当前配置指向的那一份插件，改了本仓库源码不代表宿主会看到：

- 全局 `plugins` 写 `"@justsilver/opencode-subagent-model"` 时，运行的是 npm 已发布版本，本地改动无效；
- 调试本仓库改动时，把该项换成插件目录的绝对路径，并移除 npm 同名项（同一插件 ID 不能并存）：

  ```json
  { "package": "D:\\Code\\Projects\\Agents\\opencode-subagent-model\\plugin\\opencode-subagent-model" }
  ```

- 改完配置与代码后完全退出并重新启动 OpenCode；TUI 入口只在启动时加载，不存在热更新；
- 要让用户拿到改动，只能按「npm 分发」升版本发布，不能在本地验证通过后假定已生效。

## 验证

```bash
node --test
npx --yes esbuild plugin/opencode-subagent-model/index.ts --bundle --platform=node --format=esm --outfile=dist/subagent-model-server.js
npx --yes esbuild plugin/opencode-subagent-model/tui.ts --bundle --platform=node --format=esm --external:@opencode/plugin/tui --outfile=dist/subagent-model-tui.js
npm pack --dry-run
git diff --check
```

TUI 注入包必须标为 external。测试仅模拟宿主存储、钩子、模型目录和 UI 等外部边界；
不把假件测试称为真机交互验证，不为覆盖率新增类型/常量断言。

## npm 分发

版本单一来源为 `package.json`；发布前同步 CHANGELOG 并完成上述验证。
`publishConfig.tag = next`，npm 包白名单仅包含插件源码与 CHANGELOG；README、LICENSE 由 npm 自动收录。

流水线：`ci.yml` 在 push `main` / PR 上跑版本一致性 + 单测 + 打包预检；
`release.yml` 用 npm Trusted Publishing（OIDC，无长期 token）发版：

| 触发 | 行为 |
|---|---|
| push 预发布 tag（如 `v0.1.0-beta.0`） | 校验版本一致 → `npm publish --tag next` → 建/更新 GitHub Release（标 prerelease） |
| push 正式 tag（如 `v0.1.0`） | **拦下并报错**，正式版只能手动发 |
| 手动 Run workflow（默认 `publish=false`） | 只做 `npm pack --dry-run` |
| 手动 Run workflow（`publish=true` [+ 正式版需 `stable=true`]） | 发布当前版本，并补建 tag 与 Release |

### 首次发布（人工一次）

OIDC 无法创建新包（`PUT` 报 404），所以**第一个版本必须在交互终端手工发**：

```bash
npm login
npm whoami
node scripts/changelog.mjs check --tag v0.1.0-beta.0
npm publish --tag next
npm view @justsilver/opencode-subagent-model dist-tags versions --json
```

首发后到 npm → 该包 → Settings → Trusted publishing 登记仓库 `Just-Silver/opencode-subagent-model`、
Workflow filename `release.yml`、Environment 留空，并允许 `npm publish`；新配置须在 2 天内完成一次成功发布，
否则过期。之后打 tag 即由 CD 发到 `next`。

首发后必须核对实际 dist-tag，不能仅靠 `--tag next` 假定 `latest` 一定不存在。
正式版只走手动 dispatch；不要复用已经发布或撤回的版本号。

发布后 npm 可能存在元数据与 tarball 的传播延迟；确认版本、标签和 tarball 都可取后再宣告可安装。
不要用 `npm publish --dry-run` 替代打包预检。
