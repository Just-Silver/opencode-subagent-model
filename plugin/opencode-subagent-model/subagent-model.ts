// Read shared storage on every interception so no location keeps a stale policy.

import type { SubagentModelSummary } from "./rpc.ts"

const POLICY_KEY = "subagent-model-policy"
const TOOL_NAME = "subagent"

export interface SubagentToolEvent {
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

type SubagentToolAfterEvent = { readonly tool: string; readonly input: unknown } & (
  | { readonly status: "completed"; result: ToolResult }
  | { readonly status: "error"; readonly error: unknown }
)

interface HookRegistration {
  dispose(): Promise<void>
}

export interface SubagentModelInfo {
  readonly id: string
  readonly providerID: string
  readonly type?: string
  readonly variants?: readonly { readonly id: string }[]
}

export interface SubagentModelContext {
  readonly storage: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
  }
  /** Absent on hosts without tool hooks; the policy then reports unsupported. */
  readonly tool?: {
    hook(name: "execute.before", callback: (event: SubagentToolEvent) => Promise<void>): Promise<HookRegistration>
    hook(name: "execute.after", callback: (event: SubagentToolAfterEvent) => void): Promise<HookRegistration>
  }
  /** Only needed to validate a save; reading and disabling never call it. */
  readonly model?: {
    list(input?: { types?: readonly string[] }): Promise<{ data: readonly SubagentModelInfo[] }>
  }
}

export interface SubagentModelHandlers {
  getSubagentModel(input?: unknown): Promise<SubagentModelSummary>
  setSubagentModel(input?: unknown): Promise<SubagentModelSummary>
}

interface ModelRef {
  readonly providerID: string
  readonly id: string
  readonly variant?: string
}

// 模型 ID 本身可能包含 /，因此只在第一个 / 分隔供应商。
function parseModelRef(input: string): ModelRef | undefined {
  const providerEnd = input.indexOf("/")
  if (providerEnd <= 0) return undefined
  const variantStart = input.indexOf("#", providerEnd + 1)
  const providerID = input.slice(0, providerEnd)
  const id = input.slice(providerEnd + 1, variantStart === -1 ? undefined : variantStart)
  const variant = variantStart === -1 ? undefined : input.slice(variantStart + 1)
  if (!id || providerID.includes("#") || (variant !== undefined && (!variant || variant.includes("#")))) {
    return undefined
  }
  return { providerID, id, ...(variant === undefined ? {} : { variant }) }
}

function formatModelRef(ref: ModelRef): string {
  return `${ref.providerID}/${ref.id}${ref.variant === undefined ? "" : `#${ref.variant}`}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function corruptPolicy(): Error {
  return new Error("Subagent model policy is corrupt: expected { model: string | null }.")
}

async function readModel(storage: SubagentModelContext["storage"]): Promise<string | null> {
  let raw: unknown
  try {
    raw = await storage.get(POLICY_KEY)
  } catch (error) {
    throw new Error(`Cannot read the subagent model policy: ${message(error)}`)
  }
  if (raw === undefined) return null
  if (!isRecord(raw)) throw corruptPolicy()
  const model = raw.model
  if (model === null) return null
  if (typeof model !== "string" || parseModelRef(model) === undefined) throw corruptPolicy()
  return model
}

async function writeModel(storage: SubagentModelContext["storage"], model: string | null): Promise<void> {
  try {
    await storage.set(POLICY_KEY, { model })
  } catch (error) {
    throw new Error(`Cannot save the subagent model policy: ${message(error)}`)
  }
}

async function applyPolicy(
  ctx: SubagentModelContext,
  event: SubagentToolEvent,
  forced: WeakMap<object, string>,
): Promise<void> {
  if (event.tool !== TOOL_NAME) return
  if (!isRecord(event.input)) return
  const model = await readModel(ctx.storage)
  // Disabled means "leave the call alone", not "strip an explicit model".
  if (model === null) return
  const input = { ...event.input, model }
  event.input = input
  forced.set(input, model)
}

function annotateResult(event: SubagentToolAfterEvent, forced: WeakMap<object, string>): void {
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

async function validate(ctx: SubagentModelContext, ref: ModelRef): Promise<string | undefined> {
  const list = ctx.model?.list
  if (typeof list !== "function") {
    return "This host cannot list models, so the subagent model cannot be validated."
  }
  let data: readonly SubagentModelInfo[]
  try {
    data = (await list({ types: ["chat"] })).data
  } catch (error) {
    return `Cannot list models: ${message(error)}`
  }
  const reference = formatModelRef(ref)
  const model = data.find((candidate) => candidate.providerID === ref.providerID && candidate.id === ref.id)
  if (model === undefined) return `Model "${reference}" is not an available chat model.`
  if (model.type !== undefined && model.type !== "chat") return `Model "${reference}" is not a chat model.`
  if (ref.variant === undefined) return undefined
  const variants = model.variants ?? []
  if (variants.some((variant) => variant.id === ref.variant)) return undefined
  return variants.length === 0
    ? `Model "${reference}" has no variants. Omit the variant.`
    : `Variant "${ref.variant}" is not available for "${reference}". Available: ${variants
        .map((variant) => variant.id)
        .join(", ")}.`
}

function supportsHook(ctx: SubagentModelContext): boolean {
  return typeof ctx.tool?.hook === "function"
}

function unavailable(reason: string): SubagentModelHandlers {
  return {
    getSubagentModel: async () => ({ ok: false, supported: false, errors: [reason] }),
    setSubagentModel: async () => ({ ok: false, supported: false, errors: [reason] }),
  }
}

async function getPolicy(ctx: SubagentModelContext): Promise<SubagentModelSummary> {
  if (!supportsHook(ctx)) {
    return { ok: false, supported: false, errors: ["This host cannot enforce a subagent model."] }
  }
  try {
    return { ok: true, supported: true, model: await readModel(ctx.storage) }
  } catch (error) {
    return { ok: false, supported: true, errors: [message(error)] }
  }
}

async function setPolicy(ctx: SubagentModelContext, input: unknown): Promise<SubagentModelSummary> {
  if (!supportsHook(ctx)) {
    return { ok: false, supported: false, errors: ["This host cannot enforce a subagent model."] }
  }

  const value: unknown = isRecord(input) ? input.model : undefined
  if (value !== null && typeof value !== "string") {
    return { ok: false, supported: true, errors: ["The subagent model must be a string or null."] }
  }

  if (value === null) {
    try {
      await writeModel(ctx.storage, null)
    } catch (error) {
      return { ok: false, supported: true, errors: [message(error)] }
    }
    return { ok: true, supported: true, model: null }
  }

  const ref = parseModelRef(value)
  if (ref === undefined) {
    return {
      ok: false,
      supported: true,
      errors: [`Invalid model "${value}". Use "providerID/modelID" or "providerID/modelID#variant".`],
    }
  }
  const invalid = await validate(ctx, ref)
  if (invalid !== undefined) return { ok: false, supported: true, errors: [invalid] }

  const model = formatModelRef(ref)
  try {
    await writeModel(ctx.storage, model)
  } catch (error) {
    return { ok: false, supported: true, errors: [message(error)] }
  }
  return { ok: true, supported: true, model }
}

export async function registerSubagentModelPolicy(
  ctx: SubagentModelContext,
): Promise<SubagentModelHandlers> {
  const hook = ctx.tool?.hook
  if (typeof hook !== "function") {
    return unavailable("This host does not expose the tool execute.before hook.")
  }
  const forced = new WeakMap<object, string>()
  let ready = false
  let before: HookRegistration | undefined
  try {
    before = await hook("execute.before", async (event) => {
      if (ready) await applyPolicy(ctx, event, forced)
    })
    await hook("execute.after", (event) => annotateResult(event, forced))
    ready = true
  } catch (error) {
    try {
      await before?.dispose()
    } catch (cleanupError) {
      return unavailable(`Subagent model policy hook registration failed: ${message(error)}; cleanup failed: ${message(cleanupError)}`)
    }
    return unavailable(`Subagent model policy hook registration failed: ${message(error)}`)
  }
  return {
    getSubagentModel: () => getPolicy(ctx),
    setSubagentModel: (input) => setPolicy(ctx, input),
  }
}
