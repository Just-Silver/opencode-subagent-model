import type { AgentInfo, ModelInfo, ProviderInfo } from "@opencode/client"

import { formatModelRef, isChatModel, parseModelRef } from "../model-ref.ts"
import { TEAM_SUBAGENT_IDS } from "../team-ids.ts"

export { formatModelRef, parseModelRef } from "../model-ref.ts"
export type { ModelRef as ParsedModelRef } from "../model-ref.ts"

export type AgentMode = AgentInfo["mode"]
export type ModelStatus = "native" | "inherit" | "custom"
export type ModelSource = "team" | "agent" | "none"
export type PermissionEffect = "allow" | "deny" | "ask"

export interface DashboardAgentInput {
  readonly id: string
  readonly name?: string
  readonly mode?: AgentMode
  readonly hidden?: boolean
  readonly description?: string
  readonly system?: string
  readonly model?: AgentInfo["model"]
  readonly permissions?: AgentInfo["permissions"]
  readonly known: boolean
}

export interface PromptInfo {
  readonly available: boolean
  readonly text?: string
  readonly reason?: string
}

export interface PermissionHighlight {
  readonly effect: PermissionEffect
  readonly action: string
  readonly resource: string
}

export interface PermissionSummary {
  readonly total: number
  readonly allow: number
  readonly ask: number
  readonly deny: number
  readonly defaultEffect?: PermissionEffect
  readonly highlights: readonly PermissionHighlight[]
}

export interface DashboardAgent {
  readonly id: string
  readonly name: string
  readonly mode: AgentMode
  readonly known: boolean
  readonly description?: string
  readonly teamModel?: string
  readonly hostModel?: string
  readonly effectiveModel?: string
  readonly modelLabel: string
  readonly modelRefLabel?: string
  readonly variantLabel: string
  readonly status: ModelStatus
  readonly statusLabel: string
  readonly source: ModelSource
  readonly sourceLabel: string
  readonly canConfigure: boolean
  readonly canRestore: boolean
  readonly prompt: PromptInfo
  readonly permissions: PermissionSummary
  readonly searchText: string
}

export interface DashboardGroup {
  readonly key: "primary" | "subagents" | "unavailable"
  readonly title: string
  readonly agents: readonly DashboardAgent[]
}

export interface DashboardLayout {
  readonly split: boolean
  readonly compact: boolean
  readonly minimal: boolean
  readonly dialogHeight: number
  readonly listWidth: number
}

export const STATUS_LABELS: Readonly<Record<ModelStatus, string>> = {
  native: "原生",
  inherit: "继承",
  custom: "自定义",
}

export const SOURCE_LABELS: Readonly<Record<ModelSource, string>> = {
  team: "团队策略",
  agent: "Agent 配置",
  none: "无独立模型",
}

export type FeedbackTone = "info" | "success" | "warning" | "error"

export interface Feedback {
  readonly tone: FeedbackTone
  readonly message: string
}

/** 错误保留到下一次操作或被关闭，其余状态自动收起，避免状态栏长期占用内容高度。 */
export function feedbackDismissMs(tone: FeedbackTone): number {
  if (tone === "error") return 0
  if (tone === "warning") return 6000
  return 4000
}

export type Tone = "neutral" | "accent" | "success" | "warning" | "error" | "info"

export function statusTone(status: ModelStatus): Tone {
  return status === "custom" ? "accent" : "neutral"
}

/** 允许规则数量多，保持中性；只有拒绝与询问用语义色，避免权限区抢走模型信息的注意力。 */
export function effectTone(effect: PermissionEffect): Tone {
  if (effect === "deny") return "error"
  if (effect === "ask") return "warning"
  return "neutral"
}

export type ConfigRegion = "models" | "variants"

/** 无 Variant 的模型没有可操作的第二栏，切换区域时始终留在模型列表。 */
export function nextRegion(region: ConfigRegion, hasVariants: boolean): ConfigRegion {
  if (!hasVariants) return "models"
  return region === "models" ? "variants" : "models"
}

const PROMPT_UNAVAILABLE = "宿主未为该 Agent 提供独立 System Prompt。"

function preferredRank(id: string): number {
  const index = TEAM_SUBAGENT_IDS.indexOf(id as (typeof TEAM_SUBAGENT_IDS)[number])
  return index === -1 ? TEAM_SUBAGENT_IDS.length : index
}

export function hostModelRef(model: AgentInfo["model"]): string | undefined {
  if (model === undefined) return undefined
  return formatModelRef({ providerID: model.providerID, id: model.id, variant: model.variant })
}

function providerName(providers: readonly ProviderInfo[], providerID: string): string {
  const provider = providers.find((candidate) => candidate.id === providerID)
  const name = provider?.name?.trim()
  return name === undefined || name === "" ? providerID : name
}

export function providerLabel(providers: readonly ProviderInfo[], providerID: string): string {
  return providerName(providers, providerID)
}

export interface ModelGroup {
  readonly providerID: string
  readonly providerName: string
  readonly models: readonly ModelInfo[]
}

export interface ModelConfigLayout extends DashboardLayout {
  readonly variantWidth: number
}

export function modelRefOf(model: ModelInfo): string {
  return `${model.providerID}/${model.id}`
}

export function roleLabel(mode: AgentMode): string {
  if (mode === "primary") return "PRIMARY"
  if (mode === "all") return "ALL"
  return "SUBAGENT"
}

export function resolveModel(
  models: readonly ModelInfo[],
  baseRef: string,
): ModelInfo | undefined {
  return models.find((candidate) => modelRefOf(candidate) === baseRef)
}

export function variantsFor(model: ModelInfo | undefined): readonly string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const variant of model?.variants ?? []) {
    if (variant.id === "" || seen.has(variant.id)) continue
    seen.add(variant.id)
    result.push(variant.id)
  }
  return result
}

/** 搜索改变列表后，选中项必须落在可见模型上；没有可见模型时返回 undefined。 */
export function firstVisibleRef(
  models: readonly ModelInfo[],
  current: string,
): string | undefined {
  if (models.some((model) => modelRefOf(model) === current)) return current
  const first = models[0]
  return first === undefined ? undefined : modelRefOf(first)
}

export function buildModelRef(baseRef: string, variant: string | undefined): string {
  return variant === undefined || variant === "" ? baseRef : `${baseRef}#${variant}`
}

export function modelGroups(
  models: readonly ModelInfo[],
  providers: readonly ProviderInfo[],
  query: string,
): ModelGroup[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const byProvider = new Map<string, { name: string; models: ModelInfo[] }>()
  for (const model of models) {
    if (!isChatModel(model)) continue
    const provider = providerLabel(providers, model.providerID)
    const text = [model.name, model.id, model.providerID, provider, modelRefOf(model)]
      .join(" ")
      .toLowerCase()
    if (!tokens.every((token) => text.includes(token))) continue
    const group = byProvider.get(model.providerID) ?? { name: provider, models: [] }
    group.models.push(model)
    byProvider.set(model.providerID, group)
  }
  return [...byProvider.entries()]
    .map(([providerID, group]) => ({
      providerID,
      providerName: group.name,
      models: group.models.toSorted(
        (left, right) =>
          (left.name || left.id).localeCompare(right.name || right.id) || left.id.localeCompare(right.id),
      ),
    }))
    .toSorted(
      (left, right) =>
        left.providerName.localeCompare(right.providerName) ||
        left.providerID.localeCompare(right.providerID),
    )
}

export function modelConfigLayoutFor(width: number, height: number): ModelConfigLayout {
  return {
    ...layoutFor(width, height),
    variantWidth: width >= 112 ? 38 : 32,
  }
}

export function describeModel(
  ref: string | undefined,
  mode: AgentMode,
  models: readonly ModelInfo[],
  providers: readonly ProviderInfo[],
): { readonly label: string; readonly variantLabel: string; readonly refLabel?: string } {
  if (ref === undefined) {
    return {
      label: mode === "primary" ? "OpenCode 原生选择" : "继承调用方模型",
      variantLabel: "—",
    }
  }
  const parsed = parseModelRef(ref)
  if (parsed === undefined) {
    return { label: `${ref}（引用格式无效）`, variantLabel: "—", refLabel: ref }
  }
  const model = models.find(
    (candidate) => candidate.providerID === parsed.providerID && candidate.id === parsed.id,
  )
  const variantLabel = parsed.variant ?? "默认（不附加变体）"
  if (model === undefined) {
    return { label: `${ref}（当前目录不可用）`, variantLabel, refLabel: ref }
  }
  const base = `${providerName(providers, parsed.providerID)} / ${model.name}`
  return {
    label: parsed.variant === undefined ? base : `${base} · ${parsed.variant}`,
    variantLabel,
    refLabel: ref,
  }
}

function classifyModel(input: {
  readonly mode: AgentMode
  readonly teamModel?: string
  readonly hostModel?: string
}): { readonly status: ModelStatus; readonly source: ModelSource } {
  if (input.teamModel !== undefined) return { status: "custom", source: "team" }
  if (input.hostModel !== undefined) return { status: "custom", source: "agent" }
  if (input.mode === "primary") return { status: "native", source: "none" }
  return { status: "inherit", source: "none" }
}

export function promptInfo(system: string | undefined): PromptInfo {
  if (system === undefined) return { available: false, reason: PROMPT_UNAVAILABLE }
  const text = system.replace(/\r\n?/g, "\n")
  if (text.trim() === "") return { available: false, reason: PROMPT_UNAVAILABLE }
  const lines = text.split("\n")
  if (lines.length > 0 && lines.at(-1) === "") lines.pop()
  return {
    available: true,
    text: lines.join("\n"),
  }
}

export function summarizePermissions(
  rules: readonly { readonly action: string; readonly resource: string; readonly effect: PermissionEffect }[] | undefined,
): PermissionSummary {
  if (rules === undefined || rules.length === 0) {
    return { total: 0, allow: 0, ask: 0, deny: 0, highlights: [] }
  }
  const seen = new Set<string>()
  const effective: { action: string; resource: string; effect: PermissionEffect }[] = []
  for (let index = rules.length - 1; index >= 0; index--) {
    const rule = rules[index]!
    const key = `${rule.action}\u0000${rule.resource}`
    if (seen.has(key)) continue
    seen.add(key)
    effective.push({ action: rule.action, resource: rule.resource, effect: rule.effect })
  }
  effective.reverse()

  let allow = 0
  let ask = 0
  let deny = 0
  for (const rule of effective) {
    if (rule.effect === "allow") allow++
    else if (rule.effect === "ask") ask++
    else deny++
  }

  const fallback = effective.find((rule) => rule.action === "*" && rule.resource === "*")
  const noteworthy = effective.filter(
    (rule) =>
      rule.resource !== "*" ||
      ["shell", "edit", "subagent", "question", "todowrite", "external_directory", "browser", "skill"].includes(
        rule.action,
      ),
  )
  const rank = (effect: PermissionEffect) => (effect === "deny" ? 0 : effect === "ask" ? 1 : 2)
  const highlights = noteworthy
    .toSorted((left, right) => rank(left.effect) - rank(right.effect))
    .slice(0, 4)

  return {
    total: effective.length,
    allow,
    ask,
    deny,
    ...(fallback === undefined ? {} : { defaultEffect: fallback.effect }),
    highlights,
  }
}

export function buildDashboardAgent(
  input: DashboardAgentInput,
  overrides: Readonly<Record<string, string>>,
  models: readonly ModelInfo[],
  providers: readonly ProviderInfo[],
): DashboardAgent {
  const mode = input.mode ?? "subagent"
  const teamModel = overrides[input.id]
  const hostModel = hostModelRef(input.model)
  const effectiveModel = teamModel ?? hostModel
  const { status, source } = classifyModel({
    mode,
    ...(teamModel === undefined ? {} : { teamModel }),
    ...(hostModel === undefined ? {} : { hostModel }),
  })
  const described = describeModel(effectiveModel, mode, models, providers)
  const prompt = input.known
    ? promptInfo(input.system)
    : {
        available: false,
        reason: "该 Agent 不在团队视图中，无法读取它的角色定义与 System Prompt。",
      }
  const description = input.known
    ? input.description?.trim() || undefined
    : "该 Agent 不在团队视图中；只能清除旧覆盖。"
  const name = input.name?.trim() || input.id
  const searchText = [
    input.id,
    name,
    mode,
    status,
    STATUS_LABELS[status],
    SOURCE_LABELS[source],
    described.label,
    teamModel ?? "",
    hostModel ?? "",
  ]
    .join(" ")
    .toLowerCase()

  return {
    id: input.id,
    name,
    mode,
    known: input.known,
    ...(description === undefined ? {} : { description }),
    ...(teamModel === undefined ? {} : { teamModel }),
    ...(hostModel === undefined ? {} : { hostModel }),
    ...(effectiveModel === undefined ? {} : { effectiveModel }),
    modelLabel: described.label,
    ...(described.refLabel === undefined ? {} : { modelRefLabel: described.refLabel }),
    variantLabel: described.variantLabel,
    status,
    statusLabel: STATUS_LABELS[status],
    source,
    sourceLabel: SOURCE_LABELS[source],
    canConfigure: input.known && mode !== "primary",
    canRestore: teamModel !== undefined,
    prompt,
    permissions: summarizePermissions(input.permissions),
    searchText,
  }
}

export function buildDashboardGroups(
  inputs: readonly DashboardAgentInput[],
  overrides: Readonly<Record<string, string>>,
  models: readonly ModelInfo[],
  providers: readonly ProviderInfo[],
): DashboardGroup[] {
  const known: DashboardAgentInput[] = []
  const knownIDs = new Set<string>()
  for (const agent of inputs) {
    if (agent.hidden) continue
    if (agent.mode === "primary" && agent.id !== "orchestrator") continue
    known.push(agent)
    knownIDs.add(agent.id)
  }

  const primary = known
    .filter((agent) => agent.mode === "primary")
    .map((agent) => buildDashboardAgent(agent, overrides, models, providers))
    .toSorted((left, right) => left.id.localeCompare(right.id))
  const subagents = known
    .filter((agent) => agent.mode !== "primary")
    .map((agent) => buildDashboardAgent(agent, overrides, models, providers))
    .toSorted(
      (left, right) =>
        preferredRank(left.id) - preferredRank(right.id) || left.id.localeCompare(right.id),
    )
  const unavailable = Object.keys(overrides)
    .filter((id) => !knownIDs.has(id))
    .toSorted()
    .map((id) =>
      buildDashboardAgent(
        { id, name: id, mode: "subagent", known: false },
        overrides,
        models,
        providers,
      ),
    )

  return [
    ...(primary.length === 0 ? [] : [{ key: "primary" as const, title: "PRIMARY", agents: primary }]),
    ...(subagents.length === 0
      ? []
      : [{ key: "subagents" as const, title: `SUBAGENTS · ${subagents.length}`, agents: subagents }]),
    ...(unavailable.length === 0
      ? []
      : [
          {
            key: "unavailable" as const,
            title: `已保存但不在团队视图 · ${unavailable.length}`,
            agents: unavailable,
          },
        ]),
  ]
}

export function filterDashboardGroups(
  groups: readonly DashboardGroup[],
  query: string,
): DashboardGroup[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return [...groups]
  return groups.flatMap((group) => {
    const agents = group.agents.filter((agent) =>
      tokens.every((token) => agent.searchText.includes(token)),
    )
    if (agents.length === 0) return []
    return [
      {
        ...group,
        title:
          group.key === "subagents"
            ? `SUBAGENTS · ${agents.length}`
            : group.key === "unavailable"
              ? `已保存但不在团队视图 · ${agents.length}`
              : group.title,
        agents,
      },
    ]
  })
}

export function layoutFor(width: number, height: number): DashboardLayout {
  return {
    split: width >= 90,
    compact: height < 20 || width < 100,
    minimal: width < 50,
    dialogHeight: Math.max(6, Math.min(30, height - 4)),
    listWidth: width >= 112 ? 32 : 28,
  }
}
