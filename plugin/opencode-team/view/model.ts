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

export interface ModelParts {
  readonly provider?: string
  readonly model: string
  readonly variant?: string
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
  readonly modelParts: ModelParts
  readonly variantLabel: string
  readonly status: ModelStatus
  readonly statusLabel: string
  readonly source: ModelSource
  readonly sourceLabel: string
  /** 列表行右侧的短来源标签：团队 / Agent / 原生 / 继承。 */
  readonly configTag: string
  /** 详情徽标使用完整来源：团队覆盖 / Agent 配置 / 原生 / 继承。 */
  readonly configBadge: string
  readonly configTone: Tone
  readonly canConfigure: boolean
  readonly canRestore: boolean
  readonly prompt: PromptInfo
  readonly permissions: PermissionSummary
  readonly searchText: string
}

export interface DashboardGroup {
  readonly key: "primary" | "subagents" | "unavailable"
  readonly title: string
  readonly count: number
  readonly agents: readonly DashboardAgent[]
}

export interface DashboardLayout {
  readonly split: boolean
  readonly compact: boolean
  readonly minimal: boolean
  /** 24 行左右的终端：压缩卡片与底栏的固定高度，把行留给列表。 */
  readonly dense: boolean
  readonly dialogHeight: number
  /** 列表栏宽度；单栏布局时等于 contentWidth。 */
  readonly listWidth: number
  /** 弹窗去掉左右内边距后可用的内容宽度。 */
  readonly contentWidth: number
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

function isWideCodePoint(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f650 && code <= 0x1f6ff) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x1fa70 && code <= 0x1faff) ||
    (code >= 0x1f1e6 && code <= 0x1f1ff)
  )
}

/** 终端单元格宽度；只区分宽字符与半角，不依赖具体字体。 */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0)
    if (code === undefined || code < 32) continue
    width += isWideCodePoint(code) ? 2 : 1
  }
  return width
}

function charWidth(char: string): number {
  const code = char.codePointAt(0)
  if (code === undefined || code < 32) return 0
  return isWideCodePoint(code) ? 2 : 1
}

/** 截断时保留 1 格省略号，避免长文本把布局撑开。 */
export function clipText(text: string, max: number): string {
  if (max <= 0) return ""
  if (displayWidth(text) <= max) return text
  if (max === 1) return "…"
  let width = 0
  let out = ""
  for (const char of text) {
    const next = charWidth(char)
    if (width + next > max - 1) break
    out += char
    width += next
  }
  return `${out}…`
}

/**
 * 模型名尾部常带版本号（1017、Eco），从右侧截断会丢掉最有辨识度的信息；
 * 超出宽度时保留首词和末尾若干整词/片段，中间用省略号衔接。
 */
export function clipModelName(text: string, max: number): string {
  if (displayWidth(text) <= max) return text
  const spaced = text.trim().split(/\s+/).filter(Boolean)
  const tokens = spaced.length >= 2 ? spaced : text.split(/[-/]/).filter(Boolean)
  if (tokens.length < 2 || max < 10) return clipText(text, max)
  const first = tokens[0]!
  const head = displayWidth(first) <= max - 4 ? first : clipText(first, max - 4)
  let remaining = max - displayWidth(head) - 3
  if (remaining <= 0) return clipText(text, max)
  const tail: string[] = []
  for (let index = tokens.length - 1; index > 0; index--) {
    const token = tokens[index]!
    const cost = displayWidth(token) + (tail.length === 0 ? 0 : 1)
    // 放不下的词跳过而不是终止，后面可能有更短但同样重要的版本词。
    if (cost > remaining) continue
    tail.unshift(token)
    remaining -= cost
  }
  if (tail.length === 0) return head.endsWith("…") ? head : `${head}…`
  return `${head} … ${tail.join(" ")}`
}

/**
 * Agent 行第二行优先保留模型名与 Variant；Provider 必须完整，且仍能给模型留下
 * 至少 16 格（或模型本身能完整放下）时才展示，否则整体让位，避免出现
 * "OpenCo…" 这类无法辨认的缩写。
 */
export function fitModelParts(parts: ModelParts, width: number): ModelParts {
  const usable = Math.max(1, width)
  const variantBudget = Math.min(8, Math.max(4, usable - 12))
  const variant =
    usable < 12 || parts.variant === undefined || parts.variant === ""
      ? undefined
      : clipText(parts.variant, variantBudget)
  const variantWidth = variant === undefined ? 0 : 3 + displayWidth(variant)
  const baseBudget = Math.max(1, usable - variantWidth)
  const provider = parts.provider?.trim()
  if (provider !== undefined && provider !== "") {
    const modelBudget = baseBudget - 3 - displayWidth(provider)
    // 短模型能完整放下时优先保留 Provider；长模型则以至少 16 格为界。
    if (modelBudget >= 16 || displayWidth(parts.model) <= modelBudget) {
      return {
        provider,
        model: clipModelName(parts.model, modelBudget),
        ...(variant === undefined ? {} : { variant }),
      }
    }
  }
  return {
    model: clipModelName(parts.model, baseBudget),
    ...(variant === undefined ? {} : { variant }),
  }
}

/** 模型目录里的上下文窗口与价格只用于详情展示；缺失或异常时不编造数值。 */
export function formatContextWindow(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "-"
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000
    return `${Number.isInteger(value) ? value : value.toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    const value = tokens / 1_000
    return `${Number.isInteger(value) ? value : value.toFixed(1)}K`
  }
  return String(tokens)
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0"
  return value < 1
    ? value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
}

export function formatModelPrice(model: ModelInfo | undefined): string | undefined {
  const cost = model?.cost?.find((entry) => entry.tier === undefined) ?? model?.cost?.[0]
  if (cost === undefined) return undefined
  if (cost.input === 0 && cost.output === 0) return "免费"
  return `输入 $${formatPrice(cost.input)}/1M · 输出 $${formatPrice(cost.output)}/1M`
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

export const SETTINGS_ID = "__team-default-agent__"

/** 搜索时只过滤 Agent 行，设置行在空查询下才可选中，避免空格被开关拦截而无法输入。 */
export function settingsRowVisible(
  query: string,
  options: { readonly hasAgents?: boolean } = {},
): boolean {
  if (options.hasAgents === false) return false
  return query.trim() === ""
}

export type ConfigRegion = "models" | "variants"

/** 两侧都能展示信息（模型信息 / Variant），因此始终允许在区域间切换。 */
export function nextRegion(region: ConfigRegion): ConfigRegion {
  return region === "models" ? "variants" : "models"
}

export interface SelectionState {
  readonly hasCurrent: boolean
  readonly modelChanged: boolean
  readonly variantChanged: boolean
  readonly pending: boolean
}

/**
 * 只有用户实际改动过选择才显示“待保存”；打开面板时的自动首选项不算待保存。
 * 没有生效配置时也不复用待保存语义，由界面显示独立的“未设置”状态。
 */
export function selectionState(input: {
  readonly currentBase?: string
  readonly currentVariant?: string
  readonly selectedRef: string
  readonly variant?: string
  readonly dirty: boolean
}): SelectionState {
  const hasCurrent = input.currentBase !== undefined
  const modelChanged = hasCurrent && input.selectedRef !== input.currentBase
  const variantChanged =
    hasCurrent &&
    !modelChanged &&
    (input.variant ?? undefined) !== (input.currentVariant ?? undefined)
  return {
    hasCurrent,
    modelChanged,
    variantChanged,
    pending: input.dirty && (modelChanged || variantChanged),
  }
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
  readonly favoriteGroup?: boolean
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

/** 只有选中模型就是当前生效模型时，才把当前 Variant 回填到本地选择。 */
export function variantForSelection(
  model: ModelInfo | undefined,
  currentBase: string | undefined,
  currentVariant: string | undefined,
  selectedRef: string,
): string | undefined {
  if (currentBase === undefined || currentBase !== selectedRef) return undefined
  const available = variantsFor(model)
  return currentVariant !== undefined && available.includes(currentVariant)
    ? currentVariant
    : undefined
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

export const FAVORITES_GROUP_ID = "__favorites__"

/** 存储值是宿主 TUI 的持久对象；只保留合法基础引用，非法项忽略但不回写。 */
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

function matchesModel(
  model: ModelInfo,
  tokens: readonly string[],
  providers: readonly ProviderInfo[],
): boolean {
  if (!isChatModel(model)) return false
  const provider = providerLabel(providers, model.providerID)
  const text = [model.name, model.id, model.providerID, provider, modelRefOf(model)]
    .join(" ")
    .toLowerCase()
  return tokens.every((token) => text.includes(token))
}

function sortModels(list: ModelInfo[], current?: string): ModelInfo[] {
  return list.toSorted((left, right) => {
    const currentRank = (model: ModelInfo) => (modelRefOf(model) === current ? 0 : 1)
    return (
      currentRank(left) - currentRank(right) ||
      (left.name || left.id).localeCompare(right.name || right.id) ||
      left.id.localeCompare(right.id)
    )
  })
}

export function modelGroups(
  models: readonly ModelInfo[],
  providers: readonly ProviderInfo[],
  query: string,
  favorites: readonly string[] = [],
  current?: string,
): ModelGroup[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const favoriteSet = new Set(favorites)
  const favoriteModels: ModelInfo[] = []
  const byProvider = new Map<string, { name: string; models: ModelInfo[] }>()
  for (const model of models) {
    if (!matchesModel(model, tokens, providers)) continue
    if (favoriteSet.has(modelRefOf(model))) {
      favoriteModels.push(model)
      continue
    }
    const provider = providerLabel(providers, model.providerID)
    const group = byProvider.get(model.providerID) ?? { name: provider, models: [] }
    group.models.push(model)
    byProvider.set(model.providerID, group)
  }
  // 宿主把 current 的滚动定位推迟到下一帧，首帧仍停在顶部；当前项置顶才能打开即见。
  const hasCurrent = (models: readonly ModelInfo[]) =>
    current !== undefined && models.some((model) => modelRefOf(model) === current)
  const providerGroups: ModelGroup[] = [...byProvider.entries()]
    .map(([providerID, group]) => ({
      providerID,
      providerName: group.name,
      models: sortModels(group.models, current),
    }))
    .toSorted(
      (left, right) =>
        Number(hasCurrent(right.models)) - Number(hasCurrent(left.models)) ||
        left.providerName.localeCompare(right.providerName) ||
        left.providerID.localeCompare(right.providerID),
    )
  if (favoriteModels.length === 0) return providerGroups
  return [
    {
      providerID: FAVORITES_GROUP_ID,
      providerName: "FAVORITES",
      models: sortModels(favoriteModels, current),
      favoriteGroup: true,
    },
    ...providerGroups,
  ]
}

export function describeModel(
  ref: string | undefined,
  mode: AgentMode,
  models: readonly ModelInfo[],
  providers: readonly ProviderInfo[],
): {
  readonly label: string
  readonly variantLabel: string
  readonly refLabel?: string
  readonly parts: ModelParts
} {
  if (ref === undefined) {
    return {
      label: mode === "primary" ? "OpenCode 原生选择" : "继承调用方模型",
      variantLabel: "-",
      parts: { model: mode === "primary" ? "OpenCode 会话选择" : "继承调用方模型" },
    }
  }
  const parsed = parseModelRef(ref)
  if (parsed === undefined) {
    return {
      label: `${ref}（引用格式无效）`,
      variantLabel: "-",
      refLabel: ref,
      parts: { model: ref },
    }
  }
  const model = models.find(
    (candidate) => candidate.providerID === parsed.providerID && candidate.id === parsed.id,
  )
  const variantLabel = parsed.variant ?? "默认（不附加变体）"
  if (model === undefined) {
    return {
      label: `${ref}（当前目录不可用）`,
      variantLabel,
      refLabel: ref,
      parts: {
        provider: providerName(providers, parsed.providerID),
        model: parsed.id,
        ...(parsed.variant === undefined ? {} : { variant: parsed.variant }),
      },
    }
  }
  const base = `${providerName(providers, parsed.providerID)} / ${model.name}`
  return {
    label: parsed.variant === undefined ? base : `${base} · ${parsed.variant}`,
    variantLabel,
    refLabel: ref,
    parts: {
      provider: providerName(providers, parsed.providerID),
      model: model.name || model.id,
      ...(parsed.variant === undefined ? {} : { variant: parsed.variant }),
    },
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
  const configTag = source === "team" ? "团队" : source === "agent" ? "Agent" : STATUS_LABELS[status]
  const configBadge = source === "team" ? "团队覆盖" : source === "agent" ? "Agent 配置" : STATUS_LABELS[status]
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
    modelParts: described.parts,
    variantLabel: described.variantLabel,
    status,
    statusLabel: STATUS_LABELS[status],
    source,
    sourceLabel: SOURCE_LABELS[source],
    configTag,
    configBadge,
    configTone: statusTone(status),
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
    ...(primary.length === 0
      ? []
      : [{ key: "primary" as const, title: "PRIMARY", count: primary.length, agents: primary }]),
    ...(subagents.length === 0
      ? []
      : [
          {
            key: "subagents" as const,
            title: "SUBAGENTS",
            count: subagents.length,
            agents: subagents,
          },
        ]),
    ...(unavailable.length === 0
      ? []
      : [
          {
            key: "unavailable" as const,
            title: "已保存但不在团队视图",
            count: unavailable.length,
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
    return [{ ...group, count: agents.length, agents }]
  })
}

/**
 * 弹窗宽度上限来自宿主 xlarge 的 `dialogWidth`（packages/tui/src/ui/dialog.tsx 为 116），
 * 再减去本插件根容器的左右内边距；布局阈值都按内容宽度判断。
 */
const DIALOG_MAX_WIDTH = 116
const DIALOG_SIDE_PADDING = 4

export function dialogContentWidth(terminalWidth: number): number {
  return Math.max(0, Math.min(DIALOG_MAX_WIDTH, terminalWidth - 2) - DIALOG_SIDE_PADDING)
}

export function layoutFor(width: number, height: number): DashboardLayout {
  const contentWidth = dialogContentWidth(width)
  const split = contentWidth >= 88
  const dialogHeight = Math.max(6, Math.min(30, height - 4))
  return {
    split,
    // 紧凑只用于真正受限的高度/宽度：80 列终端仍保留两行 Agent 行。
    compact: height < 14 || contentWidth < 60,
    minimal: contentWidth < 46,
    dense: dialogHeight <= 24,
    dialogHeight,
    listWidth: !split ? contentWidth : contentWidth >= 106 ? 48 : 38,
    contentWidth,
  }
}

export function modelConfigLayoutFor(width: number, height: number): ModelConfigLayout {
  const base = layoutFor(width, height)
  return {
    ...base,
    variantWidth: !base.split ? base.contentWidth : base.contentWidth >= 106 ? 34 : 30,
  }
}
