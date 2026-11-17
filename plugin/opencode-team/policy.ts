import { formatModelRef, isChatModel, parseModelRef, type ModelRef } from "./model-ref.ts"
import type { TeamConflict, TeamMigration, TeamPolicySummary } from "./rpc.ts"

const POLICY_KEY = "team-policy"
const MIGRATION_KEY = "team-legacy-migration"
const POLICY_VERSION = 1
const TOOL_NAME = "subagent"

export interface TeamToolEvent {
  tool: string
  input: unknown
}

type ToolContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }

interface ToolResult {
  readonly content?: string | readonly ToolContent[]
  readonly output?: unknown
  readonly metadata?: Readonly<Record<string, unknown>>
}

type TeamToolAfterEvent = { readonly tool: string; readonly input: unknown } & (
  | { readonly status: "completed"; result: ToolResult }
  | { readonly status: "error"; readonly error: unknown }
)

interface HookRegistration {
  dispose(): Promise<void>
}

export interface TeamModelInfo {
  readonly id: string
  readonly providerID: string
  readonly type?: string
  readonly variants?: readonly { readonly id: string }[]
}

export interface TeamAgentInfo {
  readonly id: string
  readonly mode?: string
  readonly hidden?: boolean
}

export interface LegacySubagentModel {
  readonly ok: boolean
  readonly supported: boolean
  readonly model?: string | null
  readonly errors?: readonly string[]
}

export interface LegacyPluginInfo {
  readonly id?: string
  readonly source: { readonly type: string; readonly target?: string; readonly path?: string }
  readonly state: { readonly status: string }
}

/**
 * The legacy plugin's RPC contract is reproduced locally so a loaded old package can hand its
 * setting over before the user removes it. The host routes an RPC by its definition ID, not by
 * which plugin registered it.
 */
export interface TeamPolicyContext {
  readonly storage: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
  }
  /** Absent on hosts without tool hooks; the policy then reports unsupported. */
  readonly tool?: {
    hook(name: "execute.before", callback: (event: TeamToolEvent) => Promise<void>): Promise<HookRegistration>
    hook(name: "execute.after", callback: (event: TeamToolAfterEvent) => void): Promise<HookRegistration>
  }
  /** Only needed to validate a save; reading, disabling and migration never call it. */
  readonly model?: {
    list(input?: { types?: readonly string[] }): Promise<{ data: readonly TeamModelInfo[] }>
  }
  /** Used to validate the agent and to enumerate subagents during legacy migration. */
  readonly agent?: {
    list(input?: unknown): Promise<{ data: readonly TeamAgentInfo[] }>
  }
  readonly plugin?: {
    list(input?: unknown): Promise<{ data: readonly LegacyPluginInfo[] }>
  }
  readonly rpc?: <Definition>(definition: Definition) => {
    getSubagentModel(input: Record<string, never>): Promise<LegacySubagentModel>
  }
}

export interface TeamPolicyOptions {
  readonly conflict?: TeamConflict
  readonly agentsSupported?: boolean
  readonly agentsError?: string
  /** Used when the host cannot list agents; the built-ins are enough for a faithful legacy import. */
  readonly fallbackAgents?: readonly string[]
  /**
   * Re-checks whether the legacy plugin is active. Plugin setup order is not guaranteed, so a boot
   * check alone can miss an old package that registers after this plugin.
   */
  readonly resolveConflict?: () => Promise<TeamConflict | undefined>
}

export interface TeamPolicyHandlers {
  getTeamPolicy(input?: unknown): Promise<TeamPolicySummary>
  setAgentModel(input?: unknown): Promise<TeamPolicySummary>
}

interface MigrationMarker {
  readonly from: string
  readonly status: "applied" | "empty"
  readonly model: string | null
  readonly agents: readonly string[]
}

/** Reuses a conflict result the caller already probed instead of asking the plugin list again. */
interface MigrationProbe {
  readonly conflict?: TeamConflict
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function corruptPolicy(): Error {
  return new Error(
    `Agent model policy is corrupt: expected { version: ${POLICY_VERSION}, agents: Record<string, string> }.`,
  )
}

async function readPolicy(storage: TeamPolicyContext["storage"]): Promise<Record<string, string>> {
  let raw: unknown
  try {
    raw = await storage.get(POLICY_KEY)
  } catch (error) {
    throw new Error(`Cannot read the agent model policy: ${message(error)}`)
  }
  if (raw === undefined) return {}
  if (!isRecord(raw) || raw.version !== POLICY_VERSION || !isRecord(raw.agents)) throw corruptPolicy()
  const agents: Record<string, string> = {}
  for (const [agentID, model] of Object.entries(raw.agents)) {
    if (agentID.trim() === "" || typeof model !== "string" || parseModelRef(model) === undefined) {
      throw corruptPolicy()
    }
    agents[agentID] = model
  }
  return agents
}

async function writePolicy(storage: TeamPolicyContext["storage"], agents: Record<string, string>): Promise<void> {
  try {
    await storage.set(POLICY_KEY, { version: POLICY_VERSION, agents })
  } catch (error) {
    throw new Error(`Cannot save the agent model policy: ${message(error)}`)
  }
}

async function readMarker(storage: TeamPolicyContext["storage"]): Promise<MigrationMarker | undefined> {
  const raw = await storage.get(MIGRATION_KEY)
  if (raw === undefined) return undefined
  if (
    !isRecord(raw) ||
    typeof raw.from !== "string" ||
    (raw.status !== "applied" && raw.status !== "empty") ||
    (raw.model !== null && typeof raw.model !== "string") ||
    !Array.isArray(raw.agents) ||
    raw.agents.some((agent) => typeof agent !== "string")
  ) {
    throw new Error("Agent model migration marker is corrupt.")
  }
  return {
    from: raw.from,
    status: raw.status,
    model: raw.model,
    agents: raw.agents,
  }
}

async function writeMarker(storage: TeamPolicyContext["storage"], marker: MigrationMarker): Promise<void> {
  await storage.set(MIGRATION_KEY, marker)
}

async function applyPolicy(
  ctx: TeamPolicyContext,
  event: TeamToolEvent,
  forced: WeakMap<object, string>,
  currentConflict: () => Promise<TeamConflict | undefined>,
  ensureMigration: (probe?: MigrationProbe) => Promise<TeamMigration>,
): Promise<void> {
  if (event.tool !== TOOL_NAME) return
  if (!isRecord(event.input)) return
  const agentID = event.input.agent
  if (typeof agentID !== "string" || agentID.trim() === "") return
  const agents = await readPolicy(ctx.storage)
  const model = agents[agentID]
  // Most calls target an agent without an override. Read the policy first so those calls never
  // pay for the legacy-plugin probe.
  if (model === undefined) return
  const conflict = await currentConflict()
  // While the legacy plugin is active its global hook owns this call. Importing its setting is
  // safe, but writing a competing model would make the effective model depend on plugin order.
  if (conflict !== undefined) {
    try {
      await ensureMigration({ conflict })
    } catch {
      // The old plugin still enforces this call; a migration failure is reported by the next read.
    }
    return
  }
  const input = { ...event.input, model }
  event.input = input
  forced.set(input, model)
}

function annotateResult(event: TeamToolAfterEvent, forced: WeakMap<object, string>): void {
  if (event.tool !== TOOL_NAME || !isRecord(event.input)) return
  const model = forced.get(event.input)
  forced.delete(event.input)
  if (model === undefined || event.status !== "completed" || event.input.model !== model) return

  const marker = `[effective subagent model: ${model} (forced by policy)]`
  const content = event.result.content
  event.result = {
    ...event.result,
    content: Array.isArray(content)
      ? [...content, { type: "text", text: `${content.length > 0 ? "\n\n" : ""}${marker}` }]
      : `${content || ""}${content ? "\n\n" : ""}${marker}`,
  }
}

async function validateModel(ctx: TeamPolicyContext, ref: ModelRef): Promise<string | undefined> {
  const list = ctx.model?.list
  if (typeof list !== "function") {
    return "This host cannot list models, so the agent model cannot be validated."
  }
  let data: readonly TeamModelInfo[]
  try {
    data = (await list({ types: ["chat"] })).data
  } catch (error) {
    return `Cannot list models: ${message(error)}`
  }
  const reference = formatModelRef(ref)
  const model = data.find((candidate) => candidate.providerID === ref.providerID && candidate.id === ref.id)
  if (model === undefined) return `Model "${reference}" is not an available chat model.`
  if (!isChatModel(model)) return `Model "${reference}" is not a chat model.`
  if (ref.variant === undefined) return undefined
  const variants = model.variants ?? []
  if (variants.some((variant) => variant.id === ref.variant)) return undefined
  return variants.length === 0
    ? `Model "${reference}" has no variants. Omit the variant.`
    : `Variant "${ref.variant}" is not available for "${reference}". Available: ${variants
        .map((variant) => variant.id)
        .join(", ")}.`
}

async function validateAgent(ctx: TeamPolicyContext, agentID: string): Promise<string | undefined> {
  const list = ctx.agent?.list
  if (typeof list !== "function") return undefined
  let data: readonly TeamAgentInfo[]
  try {
    data = (await list()).data
  } catch (error) {
    return `Cannot list agents: ${message(error)}`
  }
  const agent = data.find((candidate) => candidate.id === agentID)
  if (agent === undefined) return `Agent "${agentID}" is not available in this location.`
  if (agent.mode === "primary") {
    return `Agent "${agentID}" is a primary agent. Team policy only overrides subagent models; primary agents keep OpenCode's native selection.`
  }
  return undefined
}

function supportsHook(ctx: TeamPolicyContext): boolean {
  return typeof ctx.tool?.hook === "function"
}

function unavailable(reason: string, agentsSupported: boolean, agentsError?: string): TeamPolicyHandlers {
  const agentState = {
    agentsSupported,
    ...(agentsError === undefined ? {} : { agentsError }),
  }
  return {
    getTeamPolicy: async () => ({ ok: false, supported: false, ...agentState, errors: [reason] }),
    setAgentModel: async () => ({ ok: false, supported: false, ...agentState, errors: [reason] }),
  }
}

function conflictSummary(conflict: TeamConflict): TeamPolicySummary {
  return {
    ok: false,
    supported: true,
    errors: [
      `The legacy plugin "${conflict.pluginID}" is still loaded. Team policy mutates nothing until it is removed, because its global hook would override per-agent models.`,
    ],
    conflict,
  }
}

function migrationSummary(marker: MigrationMarker): TeamMigration {
  return {
    from: marker.from,
    status: marker.status,
    agents: marker.agents,
  }
}

async function listSubagentIDs(ctx: TeamPolicyContext, fallback: readonly string[]): Promise<string[]> {
  const list = ctx.agent?.list
  if (typeof list !== "function") return [...fallback]
  try {
    const data = (await list()).data
    const ids = data
      .filter((agent) => agent.mode !== "primary")
      .map((agent) => agent.id)
      .toSorted()
    return ids.length > 0 ? ids : [...fallback]
  } catch {
    return [...fallback]
  }
}

async function runMigration(
  ctx: TeamPolicyContext,
  fallbackAgents: readonly string[],
): Promise<MigrationMarker | { readonly status: "unavailable" | "failed"; readonly errors: readonly string[] }> {
  try {
    const existing = await readMarker(ctx.storage)
    if (existing !== undefined) return existing
  } catch (error) {
    return { status: "failed", errors: [message(error)] }
  }

  const rpc = ctx.rpc
  if (typeof rpc !== "function") {
    return { status: "unavailable", errors: ["This host cannot call the legacy plugin's RPC."] }
  }

  let legacy: LegacySubagentModel
  try {
    legacy = await rpc(legacyRpcDefinition).getSubagentModel({})
  } catch (error) {
    return { status: "unavailable", errors: [`Cannot read the legacy subagent model: ${message(error)}`] }
  }
  if (!legacy.supported) {
    return { status: "unavailable", errors: legacy.errors ?? ["The legacy plugin cannot report its model."] }
  }
  if (!legacy.ok) {
    return { status: "failed", errors: legacy.errors ?? ["The legacy plugin failed to report its model."] }
  }

  const legacyModel = legacy.model ?? null
  if (legacyModel !== null && parseModelRef(legacyModel) === undefined) {
    return { status: "failed", errors: [`The legacy model "${legacyModel}" is invalid.`] }
  }

  let agents: Record<string, string>
  try {
    agents = await readPolicy(ctx.storage)
  } catch (error) {
    return { status: "failed", errors: [message(error)] }
  }

  const imported =
    legacyModel === null ? [] : (await listSubagentIDs(ctx, fallbackAgents)).filter((agent) => agents[agent] === undefined)
  if (legacyModel !== null) {
    for (const agentID of imported) agents[agentID] = legacyModel
  }

  const marker: MigrationMarker = {
    from: "opencode-subagent-model",
    status: legacyModel === null ? "empty" : "applied",
    model: legacyModel,
    agents: imported,
  }
  try {
    if (imported.length > 0) await writePolicy(ctx.storage, agents)
    await writeMarker(ctx.storage, marker)
  } catch (error) {
    return { status: "failed", errors: [message(error)] }
  }
  return marker
}

/**
 * The legacy package keeps its own storage namespace, so its value is readable only while its
 * server plugin is loaded. Every attempt is memoized after success; a transient miss is retried
 * the next time the TUI or an intercepted call asks.
 */
function migration(
  ctx: TeamPolicyContext,
  currentConflict: () => Promise<TeamConflict | undefined>,
  fallbackAgents: readonly string[],
) {
  let settled: TeamMigration | undefined
  let pending: Promise<TeamMigration> | undefined
  const attempt = async (probe?: MigrationProbe): Promise<TeamMigration> => {
    const conflict = probe === undefined ? await currentConflict() : probe.conflict
    if (conflict === undefined) {
      try {
        const marker = await readMarker(ctx.storage)
        if (marker !== undefined) return migrationSummary(marker)
      } catch (error) {
        return { from: "opencode-subagent-model", status: "failed", errors: [message(error)] }
      }
      return { from: "opencode-subagent-model", status: "unavailable" }
    }
    if (settled !== undefined) return settled
    if (pending !== undefined) return pending
    pending = (async () => {
      const result = await runMigration(ctx, fallbackAgents)
      if ("from" in result) {
        settled = migrationSummary(result)
        return settled
      }
      return {
        from: "opencode-subagent-model",
        status: result.status,
        errors: result.errors,
      } satisfies TeamMigration
    })()
    try {
      return await pending
    } finally {
      pending = undefined
    }
  }
  return attempt
}

async function getState(
  ctx: TeamPolicyContext,
  options: TeamPolicyOptions,
  currentConflict: () => Promise<TeamConflict | undefined>,
  ensureMigration: (probe?: MigrationProbe) => Promise<TeamMigration>,
): Promise<TeamPolicySummary> {
  const agentState = {
    agentsSupported: options.agentsSupported ?? false,
    ...(options.agentsError === undefined ? {} : { agentsError: options.agentsError }),
  }
  const conflict = await currentConflict()
  if (!supportsHook(ctx)) {
    return {
      ok: false,
      supported: false,
      ...agentState,
      errors: ["This host cannot enforce a subagent model."],
      ...(conflict === undefined ? {} : { conflict }),
    }
  }
  try {
    const migrated = await ensureMigration({ conflict })
    const models = await readPolicy(ctx.storage)
    return {
      ok: true,
      supported: true,
      ...agentState,
      models,
      ...(migrated.status === "unavailable" && conflict === undefined ? {} : { migration: migrated }),
      ...(conflict === undefined ? {} : { conflict }),
    }
  } catch (error) {
    return {
      ok: false,
      supported: true,
      ...agentState,
      errors: [message(error)],
      ...(conflict === undefined ? {} : { conflict }),
    }
  }
}

async function setAgentModel(
  ctx: TeamPolicyContext,
  input: unknown,
  options: TeamPolicyOptions,
  currentConflict: () => Promise<TeamConflict | undefined>,
  ensureMigration: (probe?: MigrationProbe) => Promise<TeamMigration>,
): Promise<TeamPolicySummary> {
  const agentsSupported = options.agentsSupported ?? false
  if (!supportsHook(ctx)) {
    return {
      ok: false,
      supported: false,
      agentsSupported,
      errors: ["This host cannot enforce a subagent model."],
    }
  }
  const conflict = await currentConflict()
  if (conflict !== undefined) {
    return { ...conflictSummary(conflict), agentsSupported }
  }

  const agentID = isRecord(input) ? input.agentID : undefined
  const model = isRecord(input) ? input.model : undefined
  if (typeof agentID !== "string" || agentID.trim() === "") {
    return { ok: false, supported: true, agentsSupported, errors: ["The agent ID must be a non-empty string."] }
  }
  if (model !== null && typeof model !== "string") {
    return { ok: false, supported: true, agentsSupported, errors: ["The agent model must be a string or null."] }
  }

  let ref: ModelRef | undefined
  if (model !== null) {
    ref = parseModelRef(model)
    if (ref === undefined) {
      return {
        ok: false,
        supported: true,
        agentsSupported,
        errors: [`Invalid model "${model}". Use "providerID/modelID" or "providerID/modelID#variant".`],
      }
    }
    const invalidModel = await validateModel(ctx, ref)
    if (invalidModel !== undefined) return { ok: false, supported: true, agentsSupported, errors: [invalidModel] }
    const invalidAgent = await validateAgent(ctx, agentID)
    if (invalidAgent !== undefined) return { ok: false, supported: true, agentsSupported, errors: [invalidAgent] }
  }

  let agents: Record<string, string>
  try {
    agents = await readPolicy(ctx.storage)
  } catch (error) {
    return { ok: false, supported: true, agentsSupported, errors: [message(error)] }
  }

  if (model === null) {
    delete agents[agentID]
  } else {
    agents[agentID] = formatModelRef(ref!)
  }

  try {
    await writePolicy(ctx.storage, agents)
  } catch (error) {
    return { ok: false, supported: true, agentsSupported, errors: [message(error)] }
  }

  let migrated: TeamMigration | undefined
  try {
    migrated = await ensureMigration({ conflict })
  } catch {
    // The save already succeeded; migration remains visible on the next read.
  }
  return {
    ok: true,
    supported: true,
    agentsSupported,
    models: agents,
    ...(migrated === undefined || migrated.status === "unavailable" ? {} : { migration: migrated }),
  }
}

export async function registerTeamPolicy(
  ctx: TeamPolicyContext,
  options: TeamPolicyOptions = {},
): Promise<TeamPolicyHandlers> {
  const hook = ctx.tool?.hook
  if (typeof hook !== "function") {
    return unavailable(
      "This host does not expose the tool execute.before hook.",
      options.agentsSupported ?? false,
      options.agentsError,
    )
  }

  let cachedConflict = options.conflict
  const resolveConflict = options.resolveConflict
  const currentConflict = async (): Promise<TeamConflict | undefined> => {
    if (typeof resolveConflict !== "function") return cachedConflict
    try {
      cachedConflict = await resolveConflict()
    } catch {
      // A failed probe must not enable a second policy; keep the last known answer.
    }
    return cachedConflict
  }
  const ensureMigration = migration(ctx, currentConflict, options.fallbackAgents ?? [])
  const initialConflict = await currentConflict()
  if (initialConflict !== undefined) await ensureMigration({ conflict: initialConflict })

  const forced = new WeakMap<object, string>()
  let ready = false
  let before: HookRegistration | undefined
  try {
    before = await hook("execute.before", async (event) => {
      if (ready) await applyPolicy(ctx, event, forced, currentConflict, ensureMigration)
    })
    await hook("execute.after", (event) => annotateResult(event, forced))
    ready = true
  } catch (error) {
    try {
      await before?.dispose()
    } catch (cleanupError) {
      return unavailable(
        `Agent model policy hook registration failed: ${message(error)}; cleanup failed: ${message(cleanupError)}`,
        options.agentsSupported ?? false,
        options.agentsError,
      )
    }
    return unavailable(
      `Agent model policy hook registration failed: ${message(error)}`,
      options.agentsSupported ?? false,
      options.agentsError,
    )
  }
  return {
    getTeamPolicy: () => getState(ctx, options, currentConflict, ensureMigration),
    setAgentModel: (input) => setAgentModel(ctx, input, options, currentConflict, ensureMigration),
  }
}

/**
 * Only the method and input shape matter for routing; the output is checked as plain JSON.
 * The old package's RPC ID is part of its storage-era contract and must stay exact.
 */
const legacyRpcDefinition = {
  id: "opencode-subagent-model",
  methods: {
    getSubagentModel: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          supported: { type: "boolean" },
          model: { type: ["string", "null"] },
          errors: { type: "array", items: { type: "string" } },
        },
        required: ["ok", "supported"],
        additionalProperties: false,
      },
    },
  },
  events: {},
} as const
