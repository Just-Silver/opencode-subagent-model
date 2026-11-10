import assert from "node:assert/strict"
import { test } from "node:test"

import plugin from "../plugin/opencode-subagent-model/index.ts"
import type { SubagentModelHandlers } from "../plugin/opencode-subagent-model/subagent-model.ts"

const POLICY_KEY = "subagent-model-policy"

interface ModelInfo {
  readonly id: string
  readonly providerID: string
  readonly type?: string
  readonly variants?: readonly { readonly id: string }[]
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
        if (state.failGet) throw new Error("storage unavailable")
        return map.get(key)
      },
      async set(key, value) {
        if (state.failSet) throw new Error("storage unavailable")
        map.set(key, value)
      },
    },
  }
  return state
}

const enabledPolicy = (model: string): Record<string, unknown> => ({ [POLICY_KEY]: { model } })

const MODEL_A: ModelInfo = {
  id: "model-a",
  providerID: "provider-a",
  type: "chat",
  variants: [{ id: "high" }, { id: "low" }],
}

const SLASH_MODEL: ModelInfo = {
  id: "model/img",
  providerID: "provider-a",
  type: "chat",
  variants: [{ id: "high" }],
}

const IMAGE_MODEL: ModelInfo = { id: "vision", providerID: "provider-a", type: "image" }

const CATALOG: readonly ModelInfo[] = [MODEL_A, SLASH_MODEL, IMAGE_MODEL]

interface FakeHost {
  readonly hooks: Map<string, (event: any) => Promise<void>>
}

interface HostOptions {
  readonly storage: FakeStorage
  /** `"none"` = 宿主没有模型目录能力（旧宿主）。 */
  readonly models?: readonly ModelInfo[] | "none"
  readonly hook?: boolean
  readonly hookError?: Error
  readonly afterHookError?: Error
  readonly disposeError?: Error
}

async function register(options: HostOptions) {
  const host: FakeHost = { hooks: new Map() }
  const ctx: Record<string, unknown> = { storage: options.storage.api }

  if (options.hook !== false) {
    ctx.tool = {
      hook: async (name: string, callback: (event: any) => Promise<void>) => {
        if (options.hookError !== undefined) throw options.hookError
        if (name === "execute.after" && options.afterHookError !== undefined) throw options.afterHookError
        host.hooks.set(name, callback)
        return {
          dispose: async () => {
            if (options.disposeError !== undefined) throw options.disposeError
            host.hooks.delete(name)
          },
        }
      },
    }
  }

  if (options.models !== "none") {
    const catalog = options.models ?? []
    ctx.model = {
      list: async (query?: { types?: readonly string[] }) => {
        const types = query?.types
        const data =
          types === undefined ? catalog : catalog.filter((model) => types.includes(model.type ?? "chat"))
        return { location: {}, data }
      },
    }
  }

  let handlers: SubagentModelHandlers | undefined
  ctx.rpc = {
    register: async (_definition: unknown, registered: SubagentModelHandlers) => {
      handlers = registered
      return { dispose: async () => {} }
    },
  }
  await plugin.setup(ctx as never)
  assert.ok(handlers, "独立 server 入口应暴露可调用的策略")
  return { host, handlers }
}

async function intercept(
  host: FakeHost,
  input: unknown,
  tool = "subagent",
): Promise<{ tool: string; input: any }> {
  const event = { tool, input, sessionID: "ses_parent", agent: "build", messageID: "msg_parent", id: "call_fixture" }
  await host.hooks.get("execute.before")?.(event)
  return event
}

async function complete(host: FakeHost, event: { tool: string; input: unknown }, result: any) {
  const after = { ...event, status: "completed", result }
  await host.hooks.get("execute.after")?.(after)
  return after.result
}

const subagentInput = (extra: Record<string, unknown> = {}) => ({
  agent: "general",
  description: "短标签",
  prompt: "做点事",
  ...extra,
})

test("未设置策略时 subagent 输入原样保留（不给缺省值补 model）", async () => {
  const { host, handlers } = await register({ storage: fakeStorage(), models: CATALOG })

  const bare = subagentInput()
  assert.deepEqual((await intercept(host, bare)).input, bare)

  const explicit = subagentInput({ model: "provider-a/model-a" })
  assert.deepEqual((await intercept(host, explicit)).input, explicit)

  const current = await handlers.getSubagentModel({})
  assert.equal(current.ok, true)
  assert.equal(current.supported, true)
  assert.equal(current.model, null)
})

test("策略只作用于 subagent 的有效对象输入", async () => {
  const { host } = await register({
    storage: fakeStorage(enabledPolicy("provider-a/model-a#high")),
    models: CATALOG,
  })

  const bashInput = { command: "echo hi" }
  assert.deepEqual((await intercept(host, bashInput, "bash")).input, bashInput)

  assert.equal((await intercept(host, "not-an-object")).input, "not-an-object")
  assert.equal((await intercept(host, null)).input, null)
  assert.deepEqual((await intercept(host, ["array"])).input, ["array"])
})

test("启用后未显式指定 model 的调用也被覆盖，其他字段与续接/后台参数保留", async () => {
  const { host } = await register({
    storage: fakeStorage(enabledPolicy("provider-a/model-a#high")),
    models: CATALOG,
  })

  const input = subagentInput({ sessionID: "ses_child", background: true })
  const event = await intercept(host, input)

  assert.deepEqual(event.input, { ...input, model: "provider-a/model-a#high" })
})

test("启用后显式指定的 model 同样被覆盖", async () => {
  const { host } = await register({
    storage: fakeStorage(enabledPolicy("provider-a/model-a")),
    models: CATALOG,
  })

  const event = await intercept(host, subagentInput({ model: "provider-b/other" }))
  assert.equal(event.input.model, "provider-a/model-a")
})

test("关闭策略后不再改写输入，恢复原有选择规则", async () => {
  const storage = fakeStorage(enabledPolicy("provider-a/model-a#high"))
  const { host, handlers } = await register({ storage, models: CATALOG })

  const saved = await handlers.setSubagentModel({ model: null })
  assert.equal(saved.ok, true)
  assert.equal(saved.model, null)

  const bare = subagentInput()
  assert.deepEqual((await intercept(host, bare)).input, bare)
  assert.equal((await handlers.getSubagentModel({})).model, null)
})

test("策略存在共享存储中：A 保存后 B 下一次拦截立即生效，重新注册的实例仍读取", async () => {
  const storage = fakeStorage()
  const a = await register({ storage, models: CATALOG })
  const b = await register({ storage, models: CATALOG })

  const saved = await a.handlers.setSubagentModel({ model: "provider-a/model-a#low" })
  assert.equal(saved.ok, true)

  const eventB = await intercept(b.host, subagentInput())
  assert.equal(eventB.input.model, "provider-a/model-a#low")

  const reloaded = await register({ storage, models: CATALOG })
  const eventC = await intercept(reloaded.host, subagentInput())
  assert.equal(eventC.input.model, "provider-a/model-a#low")
})

test("保存时拒绝未知模型、非聊天模型、非法变体与非法引用，旧设置不变", async () => {
  const storage = fakeStorage(enabledPolicy("provider-a/model-a"))
  const { handlers } = await register({ storage, models: CATALOG })

  const rejected = [
    "provider-a/missing",
    "provider-a/vision",
    "provider-a/model-a#ultra",
    "no-slash",
    "",
    "provider-a/model-a#high#x",
  ]
  for (const model of rejected) {
    const summary = await handlers.setSubagentModel({ model })
    assert.equal(summary.ok, false, `应拒绝 ${JSON.stringify(model)}`)
    assert.equal(summary.supported, true)
    assert.ok((summary.errors ?? []).length > 0, `拒绝 ${JSON.stringify(model)} 时应说明原因`)
  }

  assert.deepEqual(storage.map.get(POLICY_KEY), { model: "provider-a/model-a" })
})

test("模型 ID 含 / 也能保存并生效", async () => {
  const storage = fakeStorage()
  const { host, handlers } = await register({ storage, models: CATALOG })

  const saved = await handlers.setSubagentModel({ model: "provider-a/model/img#high" })
  assert.equal(saved.ok, true)
  assert.equal(saved.model, "provider-a/model/img#high")

  const event = await intercept(host, subagentInput())
  assert.equal(event.input.model, "provider-a/model/img#high")
})

test("关闭策略不依赖模型目录可用", async () => {
  const storage = fakeStorage(enabledPolicy("provider-a/model-a"))
  const { host, handlers } = await register({ storage, models: "none" })

  const saved = await handlers.setSubagentModel({ model: null })
  assert.equal(saved.ok, true)

  const input = subagentInput()
  assert.deepEqual((await intercept(host, input)).input, input)
  assert.equal((await handlers.getSubagentModel({})).ok, true)
})

test("存储读取失败时阻止 subagent 调用", async () => {
  const storage = fakeStorage()
  storage.failGet = true
  const { host } = await register({ storage, models: CATALOG })

  await assert.rejects(() => intercept(host, subagentInput()), /subagent model policy/i)
})

test("持久值损坏时阻止 subagent 调用", async () => {
  for (const stored of ["provider-a/model-a", { model: 42 }, {}, { model: "no-slash" }]) {
    const { host } = await register({ storage: fakeStorage({ [POLICY_KEY]: stored }), models: CATALOG })
    await assert.rejects(
      () => intercept(host, subagentInput()),
      /subagent model policy/i,
      `损坏值 ${JSON.stringify(stored)} 应阻止调用`,
    )
  }
})

test("保存写入失败时报告失败并保留旧设置", async () => {
  const storage = fakeStorage(enabledPolicy("provider-a/model-a"))
  storage.failSet = true
  const { handlers } = await register({ storage, models: CATALOG })

  const summary = await handlers.setSubagentModel({ model: "provider-a/model-a#high" })
  assert.equal(summary.ok, false)
  assert.ok((summary.errors ?? []).length > 0)
  assert.deepEqual(storage.map.get(POLICY_KEY), { model: "provider-a/model-a" })
})

test("宿主没有执行前钩子时明确不支持，且不谎报保存成功", async () => {
  const storage = fakeStorage()
  const { handlers } = await register({ storage, models: CATALOG, hook: false })

  const current = await handlers.getSubagentModel({})
  assert.equal(current.ok, false)
  assert.equal(current.supported, false)

  const saved = await handlers.setSubagentModel({ model: "provider-a/model-a" })
  assert.equal(saved.ok, false)
  assert.equal(saved.supported, false)
  assert.equal(storage.map.has(POLICY_KEY), false, "不支持时不应写入策略")
})

test("钩子注册失败时不抛错，而是明确不支持", async () => {
  const storage = fakeStorage()
  const { handlers } = await register({
    storage,
    models: CATALOG,
    hookError: new Error("hook unavailable"),
  })

  const saved = await handlers.setSubagentModel({ model: "provider-a/model-a" })
  assert.equal(saved.ok, false)
  assert.equal(saved.supported, false)
  assert.equal(storage.map.has(POLICY_KEY), false)
})

test("强制模型随前台完成或后台启动的工具文本在末尾告知，原结果保持不变", async () => {
  const { host } = await register({
    storage: fakeStorage(enabledPolicy("provider-a/model-a#high")),
    models: CATALOG,
  })

  for (const scenario of [
    {
      input: subagentInput(),
      output: { sessionID: "ses_front", status: "completed", output: "子代理最终输出" },
      content: '<subagent sessionID="ses_front" state="completed">\n子代理最终输出\n</subagent>',
      expected: '<subagent sessionID="ses_front" state="completed">\n子代理最终输出\n</subagent>\n\n[effective subagent model: provider-a/model-a#high (forced by policy)]',
    },
    {
      input: subagentInput({ background: true, sessionID: "ses_child" }),
      output: { sessionID: "ses_child", status: "running", output: "子代理已在后台启动" },
      content: "子代理已在后台启动",
      expected: "子代理已在后台启动\n\n[effective subagent model: provider-a/model-a#high (forced by policy)]",
    },
  ]) {
    const event = await intercept(host, scenario.input)
    const metadata = { sessionID: scenario.output.sessionID, status: scenario.output.status }
    const original = { output: scenario.output, content: scenario.content, metadata }
    const result = await complete(host, event, original)

    assert.deepEqual(result, { ...original, content: scenario.expected })
    assert.equal(original.content, scenario.content)
    assert.equal(result.output, scenario.output)
    assert.equal(result.metadata, metadata)
  }
})

test("宿主已归一化的内容块保留正文与附件，并在末尾追加模型文本块", async () => {
  const { host } = await register({
    storage: fakeStorage(enabledPolicy("provider-a/model/img#high")),
    models: CATALOG,
  })
  const event = await intercept(host, subagentInput())
  const content = [
    { type: "text", text: "子代理输出" },
    { type: "file", uri: "file:///report.txt", mime: "text/plain", name: "report.txt" },
  ]
  const result = await complete(host, event, { content })

  assert.deepEqual(result.content, [
    { type: "text", text: "子代理输出" },
    { type: "file", uri: "file:///report.txt", mime: "text/plain", name: "report.txt" },
    { type: "text", text: "\n\n[effective subagent model: provider-a/model/img#high (forced by policy)]" },
  ])
  assert.equal(content.length, 2)
})

test("没有原文本时仍告知默认变体模型，不添加空变体或丢失结构化结果", async () => {
  const { host } = await register({
    storage: fakeStorage(enabledPolicy("provider-a/model-a")),
    models: CATALOG,
  })

  for (const content of [undefined, "", []]) {
    const event = await intercept(host, subagentInput())
    const output = { sessionID: "ses_child", status: "completed", output: "" }
    const result = await complete(host, event, { output, content })
    const marker = "[effective subagent model: provider-a/model-a (forced by policy)]"
    assert.deepEqual(result.content, Array.isArray(content) ? [{ type: "text", text: marker }] : marker)
    assert.equal(result.output, output)
  }
})

test("未启用策略的调用和其他工具不附加模型声明", async () => {
  const storage = fakeStorage()
  const { host, handlers } = await register({ storage, models: CATALOG })
  const unforced = await intercept(host, subagentInput({ model: "provider-a/model-a" }))
  await handlers.setSubagentModel({ model: "provider-a/model-a#high" })
  const other = await intercept(host, { command: "echo hi" }, "bash")

  for (const event of [unforced, other]) {
    const original = { content: "原工具输出", metadata: { preserved: true } }
    assert.equal(await complete(host, event, original), original)
  }
})

test("并发调用倒序返回时各自报告派发模型，返回不依赖当前存储", async () => {
  const storage = fakeStorage(enabledPolicy("provider-a/model-a#high"))
  const { host, handlers } = await register({ storage, models: CATALOG })
  const input = subagentInput()
  const first = await intercept(host, input)
  await handlers.setSubagentModel({ model: "provider-a/model-a#low" })
  const second = await intercept(host, input)
  storage.failGet = true

  assert.equal(
    (await complete(host, second, { content: "第二个结果" })).content,
    "第二个结果\n\n[effective subagent model: provider-a/model-a#low (forced by policy)]",
  )
  assert.equal(
    (await complete(host, first, { content: "第一个结果" })).content,
    "第一个结果\n\n[effective subagent model: provider-a/model-a#high (forced by policy)]",
  )
})

test("返回前关闭策略仍告知已派发调用的模型，关闭后的新调用不告知", async () => {
  const { host, handlers } = await register({
    storage: fakeStorage(enabledPolicy("provider-a/model-a#high")),
    models: CATALOG,
  })
  const running = await intercept(host, subagentInput())
  await handlers.setSubagentModel({ model: null })
  const unforced = await intercept(host, subagentInput())

  assert.equal(
    (await complete(host, running, { content: "旧调用结果" })).content,
    "旧调用结果\n\n[effective subagent model: provider-a/model-a#high (forced by policy)]",
  )
  assert.deepEqual(await complete(host, unforced, { content: "新调用结果" }), { content: "新调用结果" })
})

test("子代理失败时保留原失败，不宣称已经成功使用策略模型", async () => {
  const { host } = await register({
    storage: fakeStorage(enabledPolicy("provider-a/model-a#high")),
    models: CATALOG,
  })
  const before = await intercept(host, subagentInput())
  const error = new Error("model unavailable")
  const after = { ...before, status: "error", error }
  await host.hooks.get("execute.after")?.(after)
  assert.equal(after.error, error)
  assert.equal(after.status, "error")
})

test("后续插件改变模型或替换输入时不把原策略模型误报为生效模型", async () => {
  const { host } = await register({
    storage: fakeStorage(enabledPolicy("provider-a/model-a#high")),
    models: CATALOG,
  })

  const mutated = await intercept(host, subagentInput())
  mutated.input.model = "provider-b/other"
  const replaced = await intercept(host, subagentInput())
  replaced.input = { ...replaced.input, model: "provider-b/other" }
  for (const event of [mutated, replaced]) {
    const original = { content: "原工具输出" }
    assert.equal(await complete(host, event, original), original)
  }
})

test("执行后钩子不可用时不留下半启用覆盖，也不允许保存策略", async () => {
  const { host, handlers } = await register({
    storage: fakeStorage(enabledPolicy("provider-a/model-a#high")),
    models: CATALOG,
    afterHookError: new Error("after hook unavailable"),
  })

  const current = await handlers.getSubagentModel({})
  assert.equal(current.supported, false)
  assert.equal(current.ok, false)
  const saved = await handlers.setSubagentModel({ model: "provider-a/model-a#low" })
  assert.equal(saved.ok, false)
  assert.deepEqual((await intercept(host, subagentInput())).input, subagentInput())
})

test("注册失败且宿主无法撤销钩子时仍禁用覆盖，不阻断插件其他功能", async () => {
  const { host, handlers } = await register({
    storage: fakeStorage(enabledPolicy("provider-a/model-a#high")),
    models: CATALOG,
    afterHookError: new Error("after hook unavailable"),
    disposeError: new Error("cannot dispose hook"),
  })

  assert.equal((await handlers.getSubagentModel({})).supported, false)
  assert.deepEqual((await intercept(host, subagentInput())).input, subagentInput())
})
