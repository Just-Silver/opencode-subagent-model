<!-- 职责：agent 的项目约束、验证命令与文档地图；不写：使用教程、完整设计、发版操作步骤。 -->

# 项目定位

`opencode-subagent-model` 是独立的 OpenCode V2 插件：为所有 `subagent` 调用强制指定一个全局模型，
并在成功的工具返回末尾告知主代理。npm 包名 `@justsilver/opencode-subagent-model`。

# 硬约束

- 全程简体中文，提交信息用中文；未经明确授权不提交、推送、发布或修改用户配置。
- 只做子代理模型策略；不包含供应商注册表、HUD、凭据管理，不依赖 opencode-providers。
- 同目录双入口：`plugin/opencode-subagent-model/index.ts` 为 server，`tui.ts` 为 TUI。
- server 不运行时导入任何 `@opencode/*`；RPC 使用普通 JSON Schema 对象。
- TUI 只用宿主原生 dialog/toast，命令图层为 `mode: "global"`，不写 JSX，不引入 Solid/OpenTUI 运行时。
- 相对导入带 `.ts`；Node ≥ 24 原生擦除类型测试，不引入运行时依赖。
- 源码不放 `.opencode/plugins/`，避免本地自动发现与 npm 安装产生同 ID 重复插件。
- 策略每次执行前从宿主 storage 读取，不缓存，不直接读写 SQLite，不自动迁移旧插件命名空间。
- 只在工具成功返回末尾增加模型标记；不注入系统上下文，不额外添加用户侧卡片/通知。
- 测试只测本次业务行为，外部边界才用假件；纯迁移复用已有用例，不为类型结构、默认值或框架行为补测试。
- 注释只解释不显然的约束；迁移、来源、版本和审查记录写进文档。
- npm 包与本地目录两种加载方式不可同时启用；TUI 代码更新后须完全重启客户端。

# 验证命令

```text
node --test
node scripts/changelog.mjs check
npx --yes esbuild plugin/opencode-subagent-model/index.ts --bundle --platform=node --format=esm --outfile=dist/subagent-model-server.js
npx --yes esbuild plugin/opencode-subagent-model/tui.ts --bundle --platform=node --format=esm --external:@opencode/plugin/tui --outfile=dist/subagent-model-tui.js
npm pack --dry-run
git diff --check
```

# 文档地图

| 文档 | 负责 | 不写 |
|---|---|---|
| `README.md` | 使用者：安装、命令、迁移、疑难解答 | 实现细节、发版流程 |
| `CONTRIBUTING.md` | 贡献者：开发、验证、npm 分发 | 使用教程、重复设计契约 |
| `AGENTS.md` | agent：硬约束、命令、本表 | 完整教程 |
| `docs/subagent-model-policy.md` | 开发者：策略、存储、执行与告知契约 | 安装步骤、发布历史 |
| `docs/extraction-plan.md` | 实现者：跨仓迁移任务、验收记录 | 当前使用教程、重复策略契约 |
| `CHANGELOG.md` | 用户：版本变更历史 | 完整设计与流程 |

# 发版

- 版本单一来源 `package.json`；`node scripts/changelog.mjs check` 保证 `package.json` 与 CHANGELOG 顶部一致，
  CI 与 Release 都跑它。
- `.github/workflows/ci.yml`：版本一致 + 单测 + `npm pack --dry-run`。
- `.github/workflows/release.yml`：push 预发布 tag → OIDC 发 `next`；**正式版只能手动 dispatch**（`publish`+`stable`）；
  默认手动运行只做打包预检。
- **首个版本必须人工在交互终端发**（OIDC 建不了新包），之后才能登记 trusted publisher；细节见 `CONTRIBUTING.md`。
- 不要用 `npm publish --dry-run` 做预检（它会因版本已存在而报错）。
