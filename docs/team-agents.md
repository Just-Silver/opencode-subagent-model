<!-- 职责：opencode-team 的 Orchestrator/QA/Reviewer 角色、提示词职责与权限继承策略；不写：模型存储契约、安装教程、发布流程。 -->

# 团队 Agent

## 角色与注册

| Agent | 模式 | 来源 | 职责 |
|---|---|---|---|
| `orchestrator` | primary | 本插件动态注册 | 优先编排，简单任务可直接执行；协调并发写入与共享文件冲突，负责最终交付 |
| `general` | subagent | OpenCode 内置 | 通用多步任务，由 Orchestrator 复用 |
| `explore` | subagent | OpenCode 内置 | 代码库探索 |
| `qa` | subagent | 本插件动态注册 | 独立设计、编写及执行验收测试，不迎合实现修改验收标准 |
| `reviewer` | subagent | 本插件动态注册 | 默认只审查和报告；确需直接修复时区分审查结果与后续修改 |

注册通过 `ctx.agent.transform` 完成，不写全局 Agent 文件。插件卸载时宿主关闭注册 scope，
这些 Agent 从状态中移除。用户配置同名 Agent 时，配置插件的 transform 在本插件之后运行，
因此用户字段和权限覆盖插件默认值；`disabled: true` 会直接移除该 Agent。详见[策略契约](./team-policy.md#agent-注册)。

`general`、`explore` 完全复用 OpenCode 内置定义；本插件不添加、不修改它们的权限。

## System Prompt 来源

`plugin/opencode-team/prompts/` 下的 Markdown 是 Agent 描述与提示词的唯一来源：Frontmatter 的
`description` 映射到注册 Agent 的 `description`，正文原样映射到 `system`。
`scripts/build-prompts.mjs` 在构建阶段解析并生成 `prompts.generated.ts`；运行时只加载生成物，
不读取 Markdown。修改后运行 `npm run build:prompts`，并用 `npm run check:prompts`（CI 与
`prepack` 会执行）确认生成物已同步；生成文件不要手改。

三份提示词明确职责边界：

- **Orchestrator**：优先编排；简单任务可以直接执行；协调并发写入和共享文件冲突，
  避免多个 Agent 同时修改同一文件或工作区。整合子代理的证据并对任务分解、结果采纳和最终交付负责；
  失败或验证不通过时先分析原因，没有新证据或新策略不重复尝试。
- **QA**：从需求与可观察行为独立推导验收标准，设计、编写并执行验收测试；不得为了让实现通过
  而修改验收标准，也不得只改生产代码来迎合测试。生产代码修复原则上交由实现代理；
  自身参与修复后，不得以自己的测试结果代替独立验收。
- **Reviewer**：默认只审查和报告；必要时可运行针对性验证，但不替代 QA 对行为的独立验收；
  确需直接修复时，明确区分审查结果与后续修改。

角色元数据（ID、名称、模式）与注册、权限逻辑仍在 `team-agents.ts`，Markdown 只承载
`description` 与 System Prompt。

职责边界主要靠 System Prompt，不是权限沙箱；插件只额外给两个子代理注入 `question` 与
`subagent` 两条硬性拒绝，其余工具权限来自 OpenCode 默认值和用户配置。

## 权限策略

插件只给 `qa`、`reviewer` 注入：

```text
question * deny
subagent * deny
```

原因：子代理不应直接向用户提问，也不应继续派生下级子代理；用户交互和进一步委派由主代理
Orchestrator 负责。两者因此都是叶子子代理。

- `orchestrator`：不追加任何权限规则
- `qa`、`reviewer`：追加 `question * deny`、`subagent * deny`
- `general`、`explore`：定义与权限均不修改
- 所有 Agent 的其余权限继承 OpenCode 默认值及用户在 `opencode.json` 中的配置

因此默认情况下：

- Orchestrator 可以提问；QA、Reviewer 不能提问
- Orchestrator 可以派生子代理；QA、Reviewer 不能派生子代理
- Orchestrator、QA、Reviewer 都可以编辑文件、执行 Shell
- QA 可以自行创建或修改验收测试；Reviewer 也可以编辑，但 System Prompt 要求默认不修改
- 用户配置可以覆盖 `question` / `subagent` 拒绝，或进一步限制其他工具

不要把本插件描述成权限沙箱。职责边界主要靠 System Prompt 和 Orchestrator 协调，而不是强制权限。

### 用户配置优先

宿主先应用内置 Agent 权限，再应用插件 transform，最后应用用户配置 Agent 的权限规则。
插件给 `qa`、`reviewer` 追加的两条拒绝先于用户规则，所以用户规则追加在其后，按“最后命中”生效：

```jsonc
{
  "agents": {
    "reviewer": {
      "permissions": [
        { "action": "edit", "resource": "*", "effect": "deny" }
      ]
    }
  }
}
```

这会把 Reviewer 的“默认只审查”变成工具层面的硬限制。也可以给 QA 追加特定的 `edit` 限制，
给 `qa` / `reviewer` 追加 `question` 或 `subagent` allow 来覆盖插件的拒绝，或给 `general`
追加 `subagent` 允许规则来覆盖内置拒绝。

### 合并与匹配细节

- Agent 权限先与会话权限合并，规则从后往前匹配，最后命中的规则生效。
- `deny` 在 saved “always allow” 之前判定；用户点过 “always allow” 也不能放宽 Agent 的 `deny`。
- 会话权限追加在 Agent 之后，可以进一步收紧或放开。
- 工具是否暴露只看对应 action 的最后一条规则；最后一条是全资源 `deny` 时工具隐藏。
- `edit`、`write`、`patch` 共用 `edit` 权限动作；用户配置 `edit deny` 会同时隐藏三者。
- 子会话执行工具时使用子 Agent 的权限；派生子代理的 `subagent` 权限断言使用父 Agent 的权限。

## 并发协调

并发写入与工作区变更由 Orchestrator 协调：

- 分派可能写文件的 Agent 前，分配文件或目录所有权
- 不允许两个 Agent 同时编辑同一文件或重叠区域
- `checkout`、`reset`、`rebase`、`merge`、`commit`、`stash` 等会改变状态的 Git 操作
  串行执行，由单一 owner 负责
- 范围重叠时串行化或等待当前写入完成

这是 System Prompt 约束，不是插件层面的锁；用户配置也无法替代协调。当前提示词原文要求协调
共享文件冲突；Git 操作串行是同一原则在工作区变更上的延伸。

## 客观验证

保留项目现有客观验证机制：

- `node --test`
- `node scripts/changelog.mjs check`
- esbuild 双入口
- `npm pack --dry-run`
- `git diff --check`

Agent 的自我声明不视为测试通过。Orchestrator 需要求子代理给出命令输出、测试结果或其他
可复现证据；QA 必须实际执行验收；Reviewer 依赖代码、diff 与测试，而不是作者自述。

## 已确认的取舍

| 项目 | 决定 | 原因 |
|---|---|---|
| 注入 `question * deny` 与 `subagent * deny` | 保留 | 子代理不向用户提问、不再派生下级；其余权限默认开放、用户配置优先 |
| QA 可写验收测试 | 保留 | 独立设计、编写及执行验收测试 |
| Reviewer 默认不改代码 | 保留 | 由 System Prompt 约束，不额外做权限系统 |
| Orchestrator 完整执行能力 | 保留 | 主代理在必要时可以直接处理简单任务 |
| 默认主代理默认不修改 | 保留 | 避免安装后擅自改变用户工作流；用户可在 `/team` 面板显式开启，或配置 `default_agent` |
