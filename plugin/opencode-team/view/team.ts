import type { AgentInfo, ModelInfo, ProviderInfo } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"

import { teamRpc, type TeamPolicySummary } from "../rpc.ts"
import type { DashboardAgent, DashboardAgentInput } from "./model.ts"

type Context = Plugin.Context
type Location = ReturnType<typeof currentLocation>

export interface TeamDashboardData {
  readonly agents: readonly DashboardAgentInput[]
  readonly overrides: Readonly<Record<string, string>>
  readonly models: readonly ModelInfo[]
  readonly providers: readonly ProviderInfo[]
  readonly modelError?: string
  readonly warning?: string
  readonly agentsSupported: boolean
}

export type LoadTeamDashboardResult =
  | { readonly kind: "ready"; readonly data: TeamDashboardData }
  | { readonly kind: "blocked"; readonly message: string }

export interface ModelSelectionResult {
  readonly saved: boolean
  readonly model: string | null
  readonly models?: Readonly<Record<string, string>>
}

export function currentLocation(ctx: Context): NonNullable<Context["location"]> {
  return ctx.location ?? ctx.data.location.default()
}

/**
 * 面板打开时重新同步 Agent 定义，System Prompt 与权限必须来自宿主当前生效值；
 * 同步失败但有缓存时继续展示，并明确标注可能不是最新。
 */
export async function loadTeamDashboard(
  ctx: Context,
  location: Location,
): Promise<LoadTeamDashboardResult> {
  const state = await readState(ctx, location)
  if (state.problem !== undefined) return { kind: "blocked", message: state.problem }
  const summary = state.summary
  if (summary === undefined) return { kind: "blocked", message: "无法读取团队模型设置。" }
  if (summary.conflict !== undefined) {
    return { kind: "blocked", message: conflictMessage(summary) }
  }
  if (!summary.supported) {
    return {
      kind: "blocked",
      message: "当前宿主不支持子代理模型覆盖（所需工具钩子不可用），团队模型功能不可用。",
    }
  }

  const agents = await readAgents(ctx, location)
  if (agents.message !== undefined) return { kind: "blocked", message: agents.message }

  const models = await readModels(ctx, location)
  const providers = await readProviders(ctx, location)
  const inputs: DashboardAgentInput[] = agents.agents.map((agent) => ({
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

  return {
    kind: "ready",
    data: {
      agents: inputs,
      overrides: summary.models ?? {},
      models: models.models,
      providers,
      ...(models.error === undefined ? {} : { modelError: models.error }),
      ...(agents.warning === undefined ? {} : { warning: agents.warning }),
      agentsSupported: summary.agentsSupported ?? false,
    },
  }
}

export async function saveAgentModel(
  ctx: Context,
  location: Location,
  agent: DashboardAgent,
  model: string | null,
): Promise<ModelSelectionResult | undefined> {
  if (model !== null) {
    if (!agent.known) {
      toastInfo(ctx, "该 Agent 当前目录不可用，只能清除旧覆盖。")
      return undefined
    }
    if (agent.mode === "primary") {
      toastInfo(ctx, "主代理模型由 OpenCode 会话选择，团队策略只覆盖子代理。")
      return undefined
    }
  }
  return saveModel(ctx, location, agent.id, agent.name, model, agent.hostModel)
}

export async function restoreAgentModel(
  ctx: Context,
  location: Location,
  agent: DashboardAgent,
): Promise<ModelSelectionResult | undefined> {
  if (!agent.canRestore) {
    toastInfo(ctx, `${agent.name} 没有团队模型覆盖，无需恢复。`)
    return undefined
  }
  return saveAgentModel(ctx, location, agent, null)
}

async function readState(
  ctx: Context,
  location: Location,
): Promise<{ readonly summary?: TeamPolicySummary; readonly problem?: string }> {
  let result: TeamPolicySummary
  try {
    result = (await ctx.client.rpc(teamRpc).getTeamPolicy({}, { location })) as TeamPolicySummary
  } catch (error) {
    return { problem: `无法读取团队模型设置：${message(error)}` }
  }
  if (!result.supported) {
    return {
      problem: "当前宿主不支持子代理模型覆盖（所需工具钩子不可用），团队模型功能不可用。",
    }
  }
  if (!result.ok) return { problem: `无法读取团队模型设置：${summarize(result)}` }
  return { summary: result }
}

async function readAgents(
  ctx: Context,
  location: Location,
): Promise<{ readonly agents: AgentInfo[]; readonly warning?: string; readonly message?: string }> {
  const collection = ctx.data.location.agent
  let warning: string | undefined
  try {
    await collection.sync(location)
  } catch (error) {
    const cached = collection.list(location)
    if (cached === undefined) return { agents: [], message: `无法读取 Agent 列表：${message(error)}` }
    warning = `Agent 定义同步失败，正在使用缓存，内容可能不是最新：${message(error)}`
  }
  try {
    const agents = collection.list(location)
    if (agents === undefined) throw new Error("Agent 目录未返回数据")
    return { agents, ...(warning === undefined ? {} : { warning }) }
  } catch (error) {
    return { agents: [], message: `无法读取 Agent 列表：${message(error)}` }
  }
}

async function readModels(
  ctx: Context,
  location: Location,
): Promise<{ readonly models: ModelInfo[]; readonly error?: string }> {
  const collection = ctx.data.location.model
  try {
    // `list` reads the per-location cache the host fills at boot; syncing only when it is
    // absent avoids a network hop on every open while still distinguishing "not loaded"
    // from a genuinely empty catalog.
    if (collection.list(location) === undefined) await collection.sync(location)
    const models = collection.list(location)
    if (models === undefined) throw new Error("模型目录未返回数据")
    return { models: models.filter((model) => model.type === undefined || model.type === "chat") }
  } catch (error) {
    return { models: [], error: `无法读取模型列表：${message(error)}` }
  }
}

async function readProviders(ctx: Context, location: Location): Promise<ProviderInfo[]> {
  const collection = ctx.data.location.provider
  try {
    if (collection.list(location) === undefined) await collection.sync(location)
    return collection.list(location) ?? []
  } catch {
    return collection.list(location) ?? []
  }
}

function conflictMessage(state: TeamPolicySummary): string {
  const migration = state.migration
  if (migration?.status === "applied") {
    const count = migration.agents?.length ?? 0
    const imported =
      count === 0 ? "当前没有可迁移的子代理" : `已迁移旧全局模型到 ${count} 个子代理`
    return `检测到旧版插件 ${state.conflict?.pluginID ?? ""} 仍在加载。${imported}；请移除旧插件并完全重启 OpenCode，之后才能调整团队模型。`
  }
  if (migration?.status === "empty") {
    return `检测到旧版插件 ${state.conflict?.pluginID ?? ""} 仍在加载。旧插件没有启用模型覆盖；请移除旧插件并完全重启 OpenCode。`
  }
  const reason = migration?.errors?.join("; ")
  return `检测到旧版插件 ${state.conflict?.pluginID ?? ""} 仍在加载，它会覆盖按 Agent 的模型设置。请移除旧插件并完全重启 OpenCode。${reason === undefined ? "" : `（旧设置迁移失败：${reason}）`}`
}

async function saveModel(
  ctx: Context,
  location: Location,
  agentID: string,
  agentName: string,
  model: string | null,
  hostModel: string | undefined,
): Promise<ModelSelectionResult | undefined> {
  let result: TeamPolicySummary
  try {
    result = (await ctx.client.rpc(teamRpc).setAgentModel({ agentID, model }, { location })) as TeamPolicySummary
  } catch (error) {
    toastError(ctx, `保存 Agent 模型失败：${message(error)}`)
    return undefined
  }
  if (!result.ok) {
    toastError(ctx, `保存 Agent 模型失败：${summarize(result)}`)
    return undefined
  }
  ctx.ui.toast.show({
    variant: "success",
    message:
      model === null
        ? hostModel === undefined
          ? `已恢复 ${agentName} 的 OpenCode 原生模型选择`
          : `已清除 ${agentName} 的团队覆盖，回到 Agent 配置的 ${hostModel}`
        : `${agentName} 的子代理模型已设为 ${result.models?.[agentID] ?? model}`,
  })
  return {
    saved: true,
    model,
    ...(result.models === undefined ? {} : { models: result.models }),
  }
}

function summarize(result: TeamPolicySummary): string {
  return (result.errors ?? []).join("; ") || "未知错误"
}

function toastError(ctx: Context, message: string): void {
  ctx.ui.toast.show({ variant: "error", message })
}

function toastInfo(ctx: Context, message: string): void {
  ctx.ui.toast.show({ variant: "info", message })
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
