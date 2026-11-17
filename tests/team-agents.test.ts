import assert from "node:assert/strict"
import { test } from "node:test"

import { registerTeamAgents, TEAM_AGENTS, type PermissionRule } from "../plugin/opencode-team/team-agents.ts"

interface Agent {
  id: string
  name: string
  description?: string
  mode: "primary" | "subagent" | "all"
  system?: string
  hidden: boolean
  permissions: PermissionRule[]
}

function editor(initial: readonly Agent[] = []) {
  const agents = new Map(initial.map((agent) => [agent.id, { ...agent, permissions: [...agent.permissions] }]))
  return {
    agents,
    editor: {
      get: (id: string) => agents.get(id),
      list: () => [...agents.values()],
      update: (id: string, update: (agent: Agent) => void) => {
        const agent = agents.get(id) ?? {
          id,
          name: id,
          mode: "primary" as const,
          hidden: false,
          permissions: [],
        }
        agents.set(id, agent)
        update(agent)
        agent.id = id
      },
      remove: (id: string) => agents.delete(id),
    },
  }
}

async function apply(initial: readonly Agent[] = []) {
  const target = editor(initial)
  const result = await registerTeamAgents({
    agent: {
      transform: async (callback) => {
        callback(target.editor)
        return { dispose: async () => {} }
      },
    },
  })
  assert.equal(result.supported, true)
  return target.agents
}

test("只注册 Orchestrator、QA、Reviewer，不改动内置 general/explore", async () => {
  const existingGeneral: Agent = {
    id: "general",
    name: "General",
    mode: "subagent",
    hidden: false,
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  }
  const existingExplore: Agent = {
    id: "explore",
    name: "Explore",
    mode: "subagent",
    hidden: false,
    permissions: [{ action: "shell", resource: "*", effect: "allow" }],
  }
  const agents = await apply([existingGeneral, existingExplore])

  assert.deepEqual(TEAM_AGENTS.map((agent) => agent.id).toSorted(), ["orchestrator", "qa", "reviewer"])
  assert.deepEqual([...agents.keys()].toSorted(), ["explore", "general", "orchestrator", "qa", "reviewer"])
  assert.deepEqual(agents.get("general")?.permissions, existingGeneral.permissions)
  assert.deepEqual(agents.get("explore")?.permissions, existingExplore.permissions)
  assert.equal(agents.get("general")?.name, "General")
  assert.equal(agents.get("explore")?.name, "Explore")
})

test("QA/Reviewer 是叶子子代理：拒绝 question 与 subagent，其余权限继承默认与用户配置", async () => {
  const agents = await apply()
  const leaf = [
    { action: "question", resource: "*", effect: "deny" },
    { action: "subagent", resource: "*", effect: "deny" },
  ]

  assert.deepEqual(agents.get("orchestrator")?.permissions, [])
  assert.deepEqual(agents.get("qa")?.permissions, leaf)
  assert.deepEqual(agents.get("reviewer")?.permissions, leaf)
})

test("团队成员保留角色字段与职责提示词", async () => {
  const agents = await apply()
  assert.equal(agents.get("orchestrator")?.mode, "primary")
  assert.equal(agents.get("qa")?.mode, "subagent")
  assert.equal(agents.get("reviewer")?.mode, "subagent")
  for (const id of ["orchestrator", "qa", "reviewer"]) {
    assert.ok((agents.get(id)?.description ?? "").length > 0)
    assert.ok((agents.get(id)?.system ?? "").length > 0)
    assert.equal(agents.get(id)?.hidden, false)
  }
})

test("注册团队成员不会改变默认主代理", async () => {
  const target = editor()
  let defaultCalls = 0
  ;(target.editor as { default?: (id: string | undefined) => void }).default = () => {
    defaultCalls += 1
  }
  await registerTeamAgents({
    agent: {
      transform: async (callback) => {
        callback(target.editor)
        return { dispose: async () => {} }
      },
    },
  })

  assert.equal(defaultCalls, 0, "默认主代理仍由宿主和 default_agent 配置决定")
})

test("后注册的用户配置可以覆盖同名团队成员，冲突不会静默丢失", async () => {
  const target = editor()
  await registerTeamAgents({
    agent: {
      transform: async (callback) => {
        callback(target.editor)
        return { dispose: async () => {} }
      },
    },
  })
  // The host applies config-agent transforms after plugin transforms.
  target.editor.update("qa", (agent) => {
    agent.system = "用户自定义 QA 提示词"
    agent.mode = "primary"
    agent.hidden = true
    agent.permissions.push({ action: "edit", resource: "*", effect: "allow" })
  })

  const qa = target.agents.get("qa")!
  assert.equal(qa.system, "用户自定义 QA 提示词")
  assert.equal(qa.mode, "primary")
  assert.equal(qa.hidden, true)
  assert.deepEqual(qa.permissions, [
    { action: "question", resource: "*", effect: "deny" },
    { action: "subagent", resource: "*", effect: "deny" },
    { action: "edit", resource: "*", effect: "allow" },
  ])
})

test("宿主没有动态注册能力或注册失败时明确返回不支持，不假装团队已可用", async () => {
  assert.deepEqual(await registerTeamAgents({}), {
    supported: false,
    error: "This host cannot register agents at runtime.",
  })

  const failed = await registerTeamAgents({
    agent: {
      transform: async () => {
        throw new Error("transform unavailable")
      },
    },
  })
  assert.equal(failed.supported, false)
  assert.match(failed.error ?? "", /transform unavailable/)
})

test("三份 System Prompt 明确职责边界", () => {
  const byID = new Map(TEAM_AGENTS.map((agent) => [agent.id, agent]))
  assert.match(byID.get("orchestrator")!.system, /主编排代理/)
  assert.match(byID.get("orchestrator")!.system, /委派/)
  assert.match(byID.get("orchestrator")!.system, /共享文件冲突/)
  assert.match(byID.get("qa")!.system, /独立质量保证代理/)
  assert.match(byID.get("qa")!.system, /验收标准/)
  assert.match(byID.get("qa")!.system, /不以自身修复后的测试结果代替独立验收/)
  assert.match(byID.get("reviewer")!.system, /独立代码审查代理/)
  assert.match(byID.get("reviewer")!.system, /默认保持审查独立性/)
  assert.match(byID.get("reviewer")!.system, /待验证/)
})
