import assert from "node:assert/strict"
import { test } from "node:test"

import {
  registerTeamPolicy,
  type TeamPolicyContext,
  type TeamPolicyOptions,
} from "../plugin/opencode-team/policy.ts"
import {
  buildDashboardAgent,
  buildDashboardGroups,
  buildModelRef,
  currentModelSelection,
  effectTone,
  feedbackDismissMs,
  filterDashboardGroups,
  firstVisibleRef,
  layoutFor,
  modelConfigLayoutFor,
  modelGroups,
  nextRegion,
  promptInfo,
  resolveModel,
  roleLabel,
  statusTone,
  summarizePermissions,
  variantsFor,
  type DashboardAgent,
  type DashboardAgentInput,
} from "../plugin/opencode-team/view/model.ts"
import {
  loadTeamDashboard,
  restoreAgentModel,
  saveAgentModel,
} from "../plugin/opencode-team/view/team.ts"

const POLICY_KEY = "team-policy"
const CURRENT_LOCATION = { directory: "D:\\projects\\demo" }
const DEFAULT_LOCATION = { directory: "D:\\projects\\default" }

interface TestModel {
  readonly id: string
  readonly providerID: string
  readonly name: string
  readonly type?: string
  readonly variants?: readonly { readonly id: string }[]
}

interface TestAgent {
  readonly id: string
  readonly name: string
  readonly mode: "primary" | "subagent" | "all"
  readonly hidden?: boolean
  readonly description?: string
  readonly system?: string
  readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
  readonly permissions?: readonly {
    readonly action: string
    readonly resource: string
    readonly effect: "allow" | "deny" | "ask"
  }[]
}

interface TestProvider {
  readonly id: string
  readonly name: string
}

const ALPHA: TestModel = {
  id: "alpha",
  providerID: "provider-a",
  name: "Alpha",
  type: "chat",
  variants: [{ id: "high" }, { id: "low" }],
}
const BETA: TestModel = { id: "beta", providerID: "provider-b", name: "Beta" }
const VISION: TestModel = { id: "vision", providerID: "provider-a", name: "Vision", type: "image" }

const PROVIDERS: readonly TestProvider[] = [
  { id: "provider-a", name: "Provider A" },
  { id: "provider-b", name: "Provider B" },
]

const AGENTS: readonly TestAgent[] = [
  { id: "orchestrator", name: "Orchestrator", mode: "primary", system: "orchestrate" },
  { id: "general", name: "General", mode: "subagent" },
  { id: "explore", name: "Explore", mode: "subagent", system: "explore the codebase" },
  { id: "qa", name: "QA", mode: "subagent", system: "verify independently" },
  { id: "reviewer", name: "Reviewer", mode: "subagent", system: "review independently" },
  { id: "build", name: "Build", mode: "primary" },
  { id: "plan", name: "Plan", mode: "primary" },
  { id: "hidden-helper", name: "Hidden", mode: "subagent", hidden: true },
]

function inputs(agents: readonly TestAgent[] = AGENTS): DashboardAgentInput[] {
  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    mode: agent.mode,
    hidden: agent.hidden,
    description: agent.description,
    system: agent.system,
    model: agent.model,
    permissions: agent.permissions,
    known: true,
  }))
}

function dashboardAgent(
  id: string,
  overrides: Readonly<Record<string, string>> = {},
  models: readonly TestModel[] = [ALPHA, BETA],
): DashboardAgent {
  const groups = buildDashboardGroups(inputs(), overrides, models, PROVIDERS)
  const agent = groups.flatMap((group) => group.agents).find((candidate) => candidate.id === id)
  assert.ok(agent, `Agent ${id} 应在面板中`)
  return agent
}

interface FakeStorage {
  readonly map: Map<string, unknown>
  failGet: boolean
  failSet: boolean
  readonly api: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
  }
}

function fakeStorage(initial?: Record<string, unknown>): FakeStorage {
  const map = new Map<string, unknown>(Object.entries(initial ?? {}))
  const state: FakeStorage = {
    map,
    failGet: false,
    failSet: false,
    api: {
      async get(key) {
        if (state.failGet) throw new Error("存储读取失败")
        return map.get(key)
      },
      async set(key, value) {
        if (state.failSet) throw new Error("存储写入失败")
        map.set(key, value)
      },
    },
  }
  return state
}

type Step =
  | { kind: "select"; value?: unknown }
  | { kind: "title"; title: string }
  | { kind: "value"; value: unknown }

interface HarnessInput {
  readonly policy?: Record<string, string>
  readonly models?: readonly TestModel[]
  readonly agents?: readonly TestAgent[]
  readonly providers?: readonly TestProvider[]
  readonly location?: { directory: string }
  readonly defaultLocation?: { directory: string }
  readonly script?: Step[]
  readonly hook?: boolean
  readonly storage?: FakeStorage
  readonly getThrows?: Error
  readonly conflict?: TeamPolicyOptions["conflict"]
  readonly agentsSupported?: boolean
  readonly agentsSyncError?: boolean
  readonly agentsCache?: boolean
  readonly agentsListError?: boolean
  readonly agentsAlwaysUnloaded?: boolean
  readonly modelsSyncError?: boolean
  readonly modelsListError?: boolean
  readonly modelsAlwaysUnloaded?: boolean
}

async function harness(input: HarnessInput) {
  const calls = {
    getLocations: [] as unknown[],
    setLocations: [] as unknown[],
    agentListLocations: [] as unknown[],
    agentSyncLocations: [] as unknown[],
    modelListLocations: [] as unknown[],
    modelSyncLocations: [] as unknown[],
    providerListLocations: [] as unknown[],
    toast: [] as Array<{ variant?: string; message: string }>,
    selects: [] as any[],
    dialogOptions: [] as any[],
  }
  const storage =
    input.storage ??
    fakeStorage(input.policy === undefined ? {} : { [POLICY_KEY]: { version: 1, agents: input.policy } })
  const catalog = input.models ?? [ALPHA, BETA, VISION]
  const agentList = input.agents ?? AGENTS
  const providers = input.providers ?? PROVIDERS
  const queue = [...(input.script ?? [])]

  const policyContext: TeamPolicyContext = {
    storage: storage.api,
    ...(input.hook === false ? {} : { tool: { hook: async () => ({ dispose: async () => {} }) } }),
    model: {
      list: async (query?: { types?: readonly string[] }) => {
        const types = query?.types
        const data =
          types === undefined ? catalog : catalog.filter((model) => types.includes(model.type ?? "chat"))
        return { location: {}, data }
      },
    },
    agent: { list: async () => ({ location: {}, data: [...agentList] }) },
  }
  const handlers = await registerTeamPolicy(policyContext, {
    conflict: input.conflict,
    agentsSupported: input.agentsSupported ?? true,
  })

  const ctx: any = {
    location: input.location,
    client: {
      rpc: () => ({
        getTeamPolicy: async (value: unknown, options?: { location?: unknown }) => {
          calls.getLocations.push(options?.location)
          if (input.getThrows !== undefined) throw input.getThrows
          return handlers.getTeamPolicy(value)
        },
        setAgentModel: async (value: unknown, options?: { location?: unknown }) => {
          calls.setLocations.push(options?.location)
          return handlers.setAgentModel(value)
        },
      }),
    },
    data: {
      location: {
        default: () => input.defaultLocation ?? DEFAULT_LOCATION,
        agent: {
          list: (location: unknown) => {
            calls.agentListLocations.push(location)
            if (input.agentsListError === true) throw new Error("Agent 目录读取失败")
            if (input.agentsAlwaysUnloaded === true) return undefined
            if (input.agentsSyncError === true && input.agentsCache === false) return undefined
            return [...agentList]
          },
          sync: async (location: unknown) => {
            calls.agentSyncLocations.push(location)
            if (input.agentsSyncError === true) throw new Error("Agent 目录同步失败")
          },
          invalidate: () => {},
        },
        model: {
          list: (location: unknown) => {
            calls.modelListLocations.push(location)
            if (input.modelsListError === true) throw new Error("模型目录读取失败")
            if (input.modelsAlwaysUnloaded === true) return undefined
            if (input.modelsSyncError === true) return undefined
            return [...catalog]
          },
          sync: async (location: unknown) => {
            calls.modelSyncLocations.push(location)
            if (input.modelsSyncError === true) throw new Error("模型目录同步失败")
          },
          invalidate: () => {},
        },
        provider: {
          list: (location: unknown) => {
            calls.providerListLocations.push(location)
            return [...providers]
          },
          sync: async () => {},
          invalidate: () => {},
        },
      },
    },
    ui: {
      toast: {
        show: (options: { variant?: string; message: string }) => calls.toast.push(options),
      },
      dialog: {
        set: (options: any) => calls.dialogOptions.push(options),
        show: () => {},
        clear: () => {},
        select: async (options: any) => {
          calls.selects.push(options)
          const step = queue.shift()
          if (step === undefined) throw new Error("测试脚本用完了：界面打开了额外的选择框")
          if (step.kind === "select") return step.value
          if (step.kind === "value") return step.value
          const option = options.options.find((candidate: any) => candidate.title === step.title)
          assert.ok(option, `选择框里应有「${step.title}」`)
          return option.value
        },
      },
    },
  }

  return { ctx, calls, storage, handlers }
}

test("面板按团队范围分组：保留 Orchestrator 与所有可见子代理，排除其他主代理和隐藏 Agent", () => {
  const groups = buildDashboardGroups(inputs(), {}, [ALPHA], PROVIDERS)
  assert.deepEqual(
    groups.map((group) => group.title),
    ["PRIMARY", "SUBAGENTS · 4"],
  )
  assert.deepEqual(
    groups[0]!.agents.map((agent) => agent.id),
    ["orchestrator"],
  )
  assert.deepEqual(
    groups[1]!.agents.map((agent) => agent.id),
    ["general", "explore", "qa", "reviewer"],
  )
})

test("失效覆盖单独成组，仍允许清除旧设置", () => {
  const groups = buildDashboardGroups(inputs(), { removed: "provider-a/alpha" }, [ALPHA], PROVIDERS)
  const unavailable = groups.find((group) => group.key === "unavailable")
  assert.ok(unavailable)
  assert.match(unavailable.title, /已保存但当前不可用/)
  assert.equal(unavailable.agents[0]!.id, "removed")
  assert.equal(unavailable.agents[0]!.known, false)
  assert.equal(unavailable.agents[0]!.canRestore, true)
  assert.equal(unavailable.agents[0]!.canConfigure, false)
  assert.match(unavailable.agents[0]!.prompt.reason ?? "", /不在当前目录/)
})

test("模型状态区分原生、继承与自定义，并标注来源", () => {
  const orchestrator = dashboardAgent("orchestrator")
  assert.equal(orchestrator.status, "native")
  assert.equal(orchestrator.statusLabel, "原生")
  assert.equal(orchestrator.modelLabel, "OpenCode 原生选择")
  assert.equal(orchestrator.sourceLabel, "无独立模型")

  const general = dashboardAgent("general")
  assert.equal(general.status, "inherit")
  assert.equal(general.statusLabel, "继承")
  assert.equal(general.modelLabel, "继承调用方模型")

  const custom = dashboardAgent("qa", { qa: "provider-a/alpha#high" })
  assert.equal(custom.status, "custom")
  assert.equal(custom.source, "team")
  assert.equal(custom.sourceLabel, "团队策略")
  assert.equal(custom.modelLabel, "Provider A / Alpha · high")
  assert.equal(custom.variantLabel, "high")
})

test("宿主 Agent 配置的模型显示为自定义 · Agent 配置，团队覆盖优先", () => {
  const configured = buildDashboardGroups(
    inputs([{ id: "reviewer", name: "Reviewer", mode: "subagent", model: { id: "beta", providerID: "provider-b" } }]),
    {},
    [ALPHA, BETA],
    PROVIDERS,
  )[0]!.agents[0]!
  assert.equal(configured.status, "custom")
  assert.equal(configured.sourceLabel, "Agent 配置")
  assert.equal(configured.modelLabel, "Provider B / Beta")

  const overridden = buildDashboardGroups(
    inputs([{ id: "reviewer", name: "Reviewer", mode: "subagent", model: { id: "beta", providerID: "provider-b" } }]),
    { reviewer: "provider-a/alpha#low" },
    [ALPHA, BETA],
    PROVIDERS,
  )[0]!.agents[0]!
  assert.equal(overridden.sourceLabel, "团队策略")
  assert.equal(overridden.modelLabel, "Provider A / Alpha · low")
  assert.equal(overridden.hostModel, "provider-b/beta")
})

test("目录中不存在的模型保留原始引用并明确标记不可用", () => {
  const agent = dashboardAgent("qa", { qa: "provider-a/removed#high" }, [BETA])
  assert.match(agent.modelLabel, /provider-a\/removed#high/)
  assert.match(agent.modelLabel, /当前目录不可用/)
})

test("System Prompt 来自宿主定义；缺失或空白时明确说明，不生成占位内容", () => {
  const prompt = promptInfo("line one\r\nline two")
  assert.equal(prompt.available, true)
  assert.equal(prompt.text, "line one\nline two")
  assert.equal(prompt.lineCount, 2)
  assert.match(prompt.preview ?? "", /line one/)

  const missing = promptInfo(undefined)
  assert.equal(missing.available, false)
  assert.equal(missing.text, undefined)
  assert.match(missing.reason ?? "", /宿主未为该 Agent 提供独立 System Prompt/)

  for (const empty of ["", "   ", "\r\n"]) {
    const info = promptInfo(empty)
    assert.equal(info.available, false)
    assert.equal(info.text, undefined)
    assert.match(info.reason ?? "", /宿主未为该 Agent 提供独立 System Prompt/)
  }
})

test("预览只截取开头，完整 Prompt 保留全文", () => {
  const system = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join("\n")
  const info = promptInfo(system)
  assert.equal(info.available, true)
  assert.equal(info.text, system)
  assert.equal(info.lineCount, 40)
  assert.match(info.preview ?? "", /line 12/)
  assert.doesNotMatch(info.preview ?? "", /line 13/)
  assert.match(info.preview ?? "", /…/)
})

test("权限摘要按最后命中规则去重，并保留关键限制", () => {
  const summary = summarizePermissions([
    { action: "*", resource: "*", effect: "allow" },
    { action: "read", resource: "*", effect: "allow" },
    { action: "edit", resource: "*", effect: "deny" },
    { action: "edit", resource: ".opencode/team/qa/*", effect: "allow" },
    { action: "read", resource: "*.env", effect: "ask" },
    { action: "read", resource: "*", effect: "allow" },
    { action: "read", resource: "*", effect: "ask" },
  ])
  assert.equal(summary.defaultEffect, "allow")
  assert.equal(summary.total, 5)
  assert.equal(summary.allow, 2)
  assert.equal(summary.ask, 2)
  assert.equal(summary.deny, 1)
  assert.ok(summary.highlights.some((rule) => rule.action === "edit" && rule.effect === "deny"))
})

test("没有权限规则时摘要为空，不伪造默认拒绝", () => {
  assert.deepEqual(summarizePermissions(undefined), {
    total: 0,
    allow: 0,
    ask: 0,
    deny: 0,
    highlights: [],
  })
})

test("搜索匹配名称、状态、来源与模型，并更新子代理计数", () => {
  const groups = buildDashboardGroups(inputs(), { qa: "provider-a/alpha" }, [ALPHA], PROVIDERS)
  const filtered = filterDashboardGroups(groups, "团队策略")
  assert.deepEqual(
    filtered.flatMap((group) => group.agents.map((agent) => agent.id)),
    ["qa"],
  )
  assert.equal(filtered[0]!.title, "SUBAGENTS · 1")

  const byModel = filterDashboardGroups(groups, "Provider A")
  assert.ok(byModel.flatMap((group) => group.agents).some((agent) => agent.id === "qa"))

  assert.deepEqual(filterDashboardGroups(groups, "不存在"), [])
  assert.equal(filterDashboardGroups(groups, "  ").length, groups.length)
})

test("布局在窄终端切换单栏，在低高度切换紧凑行", () => {
  assert.deepEqual(layoutFor(120, 32), {
    split: true,
    compact: false,
    minimal: false,
    dialogHeight: 28,
    listWidth: 32,
  })
  assert.deepEqual(layoutFor(80, 24), {
    split: false,
    compact: true,
    minimal: false,
    dialogHeight: 20,
    listWidth: 28,
  })
  assert.deepEqual(layoutFor(40, 12), {
    split: false,
    compact: true,
    minimal: true,
    dialogHeight: 8,
    listWidth: 28,
  })
  assert.equal(layoutFor(60, 8).dialogHeight, 6)
})

test("加载面板数据绑定当前 location，模型目录只保留聊天模型", async () => {
  const h = await harness({
    policy: { qa: "provider-a/alpha#high" },
    models: [ALPHA, BETA, VISION],
    location: CURRENT_LOCATION,
  })
  const result = await loadTeamDashboard(h.ctx, CURRENT_LOCATION)
  assert.equal(result.kind, "ready")
  if (result.kind !== "ready") return
  assert.deepEqual(result.data.overrides, { qa: "provider-a/alpha#high" })
  assert.deepEqual(
    result.data.models.map((model) => model.id),
    ["alpha", "beta"],
  )
  assert.deepEqual(
    result.data.agents.map((agent) => agent.id),
    AGENTS.map((agent) => agent.id),
  )
  assert.ok(h.calls.agentSyncLocations.every((location) => location === CURRENT_LOCATION))
  assert.ok(h.calls.modelListLocations.every((location) => location === CURRENT_LOCATION))
  assert.ok(h.calls.providerListLocations.every((location) => location === CURRENT_LOCATION))
})

test("Agent 同步失败但有缓存时继续展示并标注可能过期", async () => {
  const h = await harness({ agentsSyncError: true, location: CURRENT_LOCATION })
  const result = await loadTeamDashboard(h.ctx, CURRENT_LOCATION)
  assert.equal(result.kind, "ready")
  if (result.kind !== "ready") return
  assert.match(result.data.warning ?? "", /同步失败/)
  assert.match(result.data.warning ?? "", /缓存/)
})

test("Agent 同步失败且没有缓存时明确报错，不打开面板", async () => {
  const h = await harness({ agentsSyncError: true, agentsCache: false, location: CURRENT_LOCATION })
  const result = await loadTeamDashboard(h.ctx, CURRENT_LOCATION)
  assert.equal(result.kind, "blocked")
  if (result.kind === "blocked") assert.match(result.message, /无法读取 Agent 列表/)
})

test("Agent 列表读取失败时明确报错", async () => {
  const h = await harness({ agentsListError: true, location: CURRENT_LOCATION })
  const result = await loadTeamDashboard(h.ctx, CURRENT_LOCATION)
  assert.equal(result.kind, "blocked")
  if (result.kind === "blocked") assert.match(result.message, /无法读取 Agent 列表/)
})

test("模型目录失败时仍打开面板，并保留错误说明", async () => {
  const h = await harness({
    modelsAlwaysUnloaded: true,
    modelsSyncError: true,
    location: CURRENT_LOCATION,
  })
  const result = await loadTeamDashboard(h.ctx, CURRENT_LOCATION)
  assert.equal(result.kind, "ready")
  if (result.kind !== "ready") return
  assert.match(result.data.modelError ?? "", /无法读取模型列表/)
  assert.deepEqual(result.data.models, [])
})

test("旧插件冲突、hook 不支持与策略读取失败都阻止打开", async () => {
  const conflict = await harness({
    conflict: { pluginID: "opencode-subagent-model", source: "@justsilver/opencode-subagent-model" },
    location: CURRENT_LOCATION,
  })
  const blocked = await loadTeamDashboard(conflict.ctx, CURRENT_LOCATION)
  assert.equal(blocked.kind, "blocked")
  if (blocked.kind === "blocked") {
    assert.match(blocked.message, /旧版插件/)
    assert.match(blocked.message, /移除旧插件/)
  }

  const unsupported = await harness({ hook: false, location: CURRENT_LOCATION })
  const noHook = await loadTeamDashboard(unsupported.ctx, CURRENT_LOCATION)
  assert.equal(noHook.kind, "blocked")
  if (noHook.kind === "blocked") assert.match(noHook.message, /不支持/)

  const storage = fakeStorage({ [POLICY_KEY]: { version: 1, agents: {} } })
  storage.failGet = true
  const broken = await harness({ storage, location: CURRENT_LOCATION })
  const corrupt = await loadTeamDashboard(broken.ctx, CURRENT_LOCATION)
  assert.equal(corrupt.kind, "blocked")
  if (corrupt.kind === "blocked") assert.match(corrupt.message, /无法读取团队模型设置/)
})

test("宿主不能动态注册团队 Agent 时仍返回面板数据并标记受限", async () => {
  const h = await harness({ agentsSupported: false, location: CURRENT_LOCATION })
  const result = await loadTeamDashboard(h.ctx, CURRENT_LOCATION)
  assert.equal(result.kind, "ready")
  if (result.kind === "ready") assert.equal(result.data.agentsSupported, false)
})

test("缺少 location 时使用 data.location.default()", async () => {
  const h = await harness({ defaultLocation: DEFAULT_LOCATION })
  const result = await loadTeamDashboard(h.ctx, DEFAULT_LOCATION)
  assert.equal(result.kind, "ready")
  assert.ok(h.calls.agentSyncLocations.every((location) => location === DEFAULT_LOCATION))
})

test("保存无变体模型后写入完整引用", async () => {
  const h = await harness({})
  const result = await saveAgentModel(h.ctx, CURRENT_LOCATION, dashboardAgent("qa"), "provider-b/beta")
  assert.equal(result.saved, true)
  assert.equal(result.tone, "success")
  assert.match(result.message, /qa.*provider-b\/beta/i)
  assert.deepEqual(h.storage.map.get(POLICY_KEY), {
    version: 1,
    agents: { qa: "provider-b/beta" },
  })
  assert.equal(h.calls.toast.length, 0)
  assert.ok(h.calls.setLocations.every((location) => location === CURRENT_LOCATION))
})

test("保存指定变体时写入 #variant，默认变体只写基础引用", async () => {
  const variant = await harness({})
  await saveAgentModel(variant.ctx, CURRENT_LOCATION, dashboardAgent("reviewer"), "provider-a/alpha#low")
  assert.deepEqual(variant.storage.map.get(POLICY_KEY), {
    version: 1,
    agents: { reviewer: "provider-a/alpha#low" },
  })

  const base = await harness({})
  await saveAgentModel(base.ctx, CURRENT_LOCATION, dashboardAgent("qa"), "provider-a/alpha")
  assert.deepEqual(base.storage.map.get(POLICY_KEY), {
    version: 1,
    agents: { qa: "provider-a/alpha" },
  })
})

test("清除团队覆盖后回到 Agent 配置", async () => {
  const configured = buildDashboardGroups(
    inputs([{ id: "reviewer", name: "Reviewer", mode: "subagent", model: { id: "beta", providerID: "provider-b" } }]),
    { reviewer: "provider-a/alpha#high" },
    [ALPHA, BETA],
    PROVIDERS,
  )[0]!.agents[0]!
  const h = await harness({ policy: { reviewer: "provider-a/alpha#high" } })
  const result = await saveAgentModel(h.ctx, CURRENT_LOCATION, configured, null)
  assert.equal(result.saved, true)
  assert.equal(result.tone, "success")
  assert.match(result.message, /Agent 配置/)
  assert.deepEqual(h.storage.map.get(POLICY_KEY), { version: 1, agents: {} })
})

test("主代理与失效 Agent 拒绝写入新模型，但仍允许清除旧覆盖", async () => {
  const primary = await harness({})
  const primaryResult = await saveAgentModel(
    primary.ctx,
    CURRENT_LOCATION,
    dashboardAgent("orchestrator"),
    "provider-a/alpha",
  )
  assert.equal(primaryResult.saved, false)
  assert.equal(primaryResult.tone, "info")
  assert.match(primaryResult.message, /主代理/)
  assert.equal(primary.calls.setLocations.length, 0)
  assert.equal(primary.calls.toast.length, 0)

  const missing = buildDashboardGroups(inputs(), { removed: "provider-a/alpha" }, [ALPHA], PROVIDERS)
    .find((group) => group.key === "unavailable")!
    .agents[0]!
  const unknown = await harness({ policy: { removed: "provider-a/alpha" } })
  const unknownResult = await saveAgentModel(unknown.ctx, CURRENT_LOCATION, missing, "provider-b/beta")
  assert.equal(unknownResult.saved, false)
  assert.equal(unknownResult.tone, "warning")
  assert.match(unknownResult.message, /当前目录不可用/)
  assert.equal(unknown.calls.toast.length, 0)
  assert.deepEqual(unknown.storage.map.get(POLICY_KEY), { version: 1, agents: { removed: "provider-a/alpha" } })

  const cleared = await saveAgentModel(unknown.ctx, CURRENT_LOCATION, missing, null)
  assert.equal(cleared.saved, true)
  assert.deepEqual(unknown.storage.map.get(POLICY_KEY), { version: 1, agents: {} })
})

test("保存失败时返回错误反馈，旧设置保持不变", async () => {
  const storage = fakeStorage({ [POLICY_KEY]: { version: 1, agents: { general: "provider-a/alpha#high" } } })
  storage.failSet = true
  const h = await harness({ storage })
  const result = await saveAgentModel(h.ctx, CURRENT_LOCATION, dashboardAgent("qa"), "provider-a/alpha")
  assert.equal(result.saved, false)
  assert.equal(result.tone, "error")
  assert.match(result.message, /保存 Agent 模型失败/)
  assert.equal(h.calls.toast.length, 0)
  assert.deepEqual(storage.map.get(POLICY_KEY), {
    version: 1,
    agents: { general: "provider-a/alpha#high" },
  })
})

test("模型配置按 Provider 分组，并支持名称、引用与 Provider 搜索", () => {
  const grouped = modelGroups([ALPHA, BETA, VISION], PROVIDERS, "")
  assert.deepEqual(
    grouped.map((group) => group.providerName),
    ["Provider A", "Provider B"],
  )
  assert.deepEqual(
    grouped[0]!.models.map((model) => model.id),
    ["alpha"],
  )
  assert.deepEqual(
    modelGroups([ALPHA, BETA], PROVIDERS, "provider-b/beta").flatMap((group) => group.models.map((model) => model.id)),
    ["beta"],
  )
  assert.deepEqual(
    modelGroups([ALPHA, BETA], PROVIDERS, "Alpha").flatMap((group) => group.models.map((model) => model.id)),
    ["alpha"],
  )
  assert.deepEqual(modelGroups([ALPHA, BETA], PROVIDERS, "不存在"), [])
})

test("Variant 来自模型实际能力，引用按是否选择 Variant 生成", () => {
  assert.deepEqual(variantsFor(ALPHA), ["high", "low"])
  assert.deepEqual(variantsFor(BETA), [])
  assert.equal(buildModelRef("provider-a/alpha", undefined), "provider-a/alpha")
  assert.equal(buildModelRef("provider-a/alpha", "high"), "provider-a/alpha#high")
  assert.deepEqual(
    variantsFor({ id: "x", providerID: "p", name: "X", variants: [{ id: "a" }, { id: "a" }, { id: "" }] }),
    ["a"],
  )
})

test("当前模型选择从团队覆盖或 Agent 配置解析，缺省时为空", () => {
  assert.deepEqual(currentModelSelection(dashboardAgent("qa", { qa: "provider-a/alpha#high" })), {
    baseRef: "provider-a/alpha",
    variant: "high",
  })
  assert.deepEqual(
    currentModelSelection(
      buildDashboardGroups(
        inputs([{ id: "reviewer", name: "Reviewer", mode: "subagent", model: { id: "beta", providerID: "provider-b", variant: "x" } }]),
        {},
        [ALPHA, BETA],
        PROVIDERS,
      )[0]!.agents[0]!,
    ),
    { baseRef: "provider-b/beta", variant: "x" },
  )
  assert.equal(currentModelSelection(dashboardAgent("qa")), undefined)
  assert.equal(resolveModel([ALPHA], "provider-a/alpha")?.id, "alpha")
})

test("模型配置布局在窄终端切换单栏，并保留 Variant 面板宽度", () => {
  assert.equal(modelConfigLayoutFor(120, 32).split, true)
  assert.equal(modelConfigLayoutFor(120, 32).variantWidth, 38)
  assert.equal(modelConfigLayoutFor(80, 24).split, false)
  assert.equal(modelConfigLayoutFor(80, 24).variantWidth, 32)
  assert.equal(modelConfigLayoutFor(40, 12).minimal, true)
  assert.equal(roleLabel("primary"), "PRIMARY")
  assert.equal(roleLabel("subagent"), "SUBAGENT")
})

test("恢复模型覆盖而不经过选择框", async () => {
  const h = await harness({
    policy: { qa: "provider-a/alpha#high" },
    location: CURRENT_LOCATION,
  })
  const agent = dashboardAgent("qa", { qa: "provider-a/alpha#high" })
  const result = await restoreAgentModel(h.ctx, CURRENT_LOCATION, agent)
  assert.equal(result.saved, true)
  assert.equal(result.tone, "success")
  assert.deepEqual(h.storage.map.get(POLICY_KEY), { version: 1, agents: {} })
  assert.deepEqual(h.calls.setLocations, [CURRENT_LOCATION])
  assert.equal(h.calls.toast.length, 0)
})

test("没有团队覆盖时恢复操作只返回提示，不调用 RPC", async () => {
  const h = await harness({ policy: { general: "provider-a/alpha" } })
  const agent = dashboardAgent("qa")
  const result = await restoreAgentModel(h.ctx, CURRENT_LOCATION, agent)
  assert.equal(result.saved, false)
  assert.equal(result.tone, "info")
  assert.match(result.message, /没有团队模型覆盖/)
  assert.equal(h.calls.setLocations.length, 0)
  assert.equal(h.calls.toast.length, 0)
})

test("清除覆盖后面板重新计算为原生或 Agent 配置", () => {
  const before = buildDashboardGroups(inputs(), { qa: "provider-a/alpha#high" }, [ALPHA], PROVIDERS)
  const after = buildDashboardGroups(inputs(), {}, [ALPHA], PROVIDERS)
  assert.equal(before[1]!.agents.find((agent) => agent.id === "qa")!.status, "custom")
  assert.equal(after[1]!.agents.find((agent) => agent.id === "qa")!.status, "inherit")

  const configured = buildDashboardGroups(
    inputs([{ id: "reviewer", name: "Reviewer", mode: "subagent", model: { id: "beta", providerID: "provider-b" } }]),
    {},
    [ALPHA, BETA],
    PROVIDERS,
  )[0]!.agents[0]!
  assert.equal(configured.status, "custom")
  assert.equal(configured.sourceLabel, "Agent 配置")
})

test("区域切换在无 Variant 时停留在模型列表", () => {
  assert.equal(nextRegion("models", true), "variants")
  assert.equal(nextRegion("variants", true), "models")
  assert.equal(nextRegion("models", false), "models")
  assert.equal(nextRegion("variants", false), "models")
})

test("状态与权限语义色保持克制：自定义、拒绝、询问突出，原生继承与允许中性", () => {
  assert.equal(statusTone("custom"), "accent")
  assert.equal(statusTone("native"), "neutral")
  assert.equal(statusTone("inherit"), "neutral")
  assert.equal(effectTone("deny"), "error")
  assert.equal(effectTone("ask"), "warning")
  assert.equal(effectTone("allow"), "neutral")
})

test("Modal 内反馈停留时间：错误常驻，警告次之，普通状态自动收起", () => {
  assert.equal(feedbackDismissMs("error"), 0)
  assert.ok(feedbackDismissMs("warning") > feedbackDismissMs("success"))
  assert.ok(feedbackDismissMs("success") > 0)
  assert.equal(feedbackDismissMs("success"), feedbackDismissMs("info"))
})

test("搜索过滤后选中项落到可见模型，无结果时不保留不可见选中项", () => {
  assert.equal(firstVisibleRef([ALPHA, BETA], "provider-b/beta"), "provider-b/beta")
  assert.equal(firstVisibleRef([ALPHA], "provider-b/beta"), "provider-a/alpha")
  assert.equal(firstVisibleRef([], "provider-b/beta"), undefined)
})
