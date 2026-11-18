import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { parsePrompt, readPrompts, renderPrompts } from "../scripts/build-prompts.mjs"
import { registerTeamAgents, type PermissionRule } from "../plugin/opencode-team/team-agents.ts"
import { buildDashboardGroups } from "../plugin/opencode-team/view/model.ts"

interface Agent {
  id: string
  name: string
  description?: string
  mode: "primary" | "subagent" | "all"
  system?: string
  hidden: boolean
  permissions: PermissionRule[]
}

const PROMPT_IDS = new Map([
  ["ORCHESTRATOR_PROMPT", "orchestrator"],
  ["QA_PROMPT", "qa"],
  ["REVIEWER_PROMPT", "reviewer"],
])

async function registered(): Promise<Map<string, Agent>> {
  const agents = new Map<string, Agent>()
  const editor = {
    get: (id: string) => agents.get(id),
    list: () => [...agents.values()],
    update: (id: string, update: (agent: Agent) => void) => {
      const agent = agents.get(id) ?? { id, name: id, mode: "primary" as const, hidden: false, permissions: [] }
      agents.set(id, agent)
      update(agent)
      agent.id = id
    },
    remove: (id: string) => agents.delete(id),
  }
  await registerTeamAgents({
    agent: {
      transform: async (callback) => {
        callback(editor)
        return { dispose: async () => {} }
      },
    },
  })
  return agents
}

test("角色 Markdown 的 description 与正文就是注册后的 Agent 定义", async () => {
  const agents = await registered()
  for (const prompt of readPrompts()) {
    const id = PROMPT_IDS.get(prompt.constant)
    assert.ok(id, `未知提示词常量：${prompt.constant}`)
    assert.equal(agents.get(id)?.description, prompt.description)
    assert.equal(agents.get(id)?.system, prompt.system)
  }
})

test("/team 面板展示的 System Prompt 与角色 Markdown 一致", async () => {
  const agents = await registered()
  const inputs = [...agents.values()].map((agent) => ({
    id: agent.id,
    name: agent.name,
    mode: agent.mode,
    hidden: agent.hidden,
    description: agent.description,
    system: agent.system,
    known: true,
  }))
  const visible = buildDashboardGroups(inputs, {}, [], []).flatMap((group) => group.agents)

  for (const prompt of readPrompts()) {
    const id = PROMPT_IDS.get(prompt.constant)!
    const agent = visible.find((candidate) => candidate.id === id)
    assert.ok(agent, `${id} 应出现在面板中`)
    assert.equal(agent.prompt.text, prompt.system)
    assert.equal(agent.description, prompt.description)
  }
})

test("生成结果可复现，且仓库中的生成物与 Markdown 同步", () => {
  const expected = renderPrompts(readPrompts())
  assert.equal(renderPrompts(readPrompts()), expected)
  const actual = readFileSync(new URL("../plugin/opencode-team/prompts.generated.ts", import.meta.url), "utf8")
  assert.equal(actual, expected, "生成物过期：请运行 npm run build:prompts")
})

test("Frontmatter 决定 description，正文原样作为 System Prompt", () => {
  const { description, system } = parsePrompt(
    '---\n# 职责说明，不进入字段\ndescription: "独立验收"\n---\n\n# 角色\n\n正文\n',
  )
  assert.equal(description, "独立验收")
  assert.equal(system, "# 角色\n\n正文")
})

test("格式非法、字段缺失或正文为空时明确报错", () => {
  const cases: Array<[string, RegExp]> = [
    ["description: x\n---\n正文\n", /缺少 YAML Frontmatter/],
    ["---\ndescription: x\n正文\n", /结束标记/],
    ["---\n---\n正文\n", /缺少 description/],
    ['---\ndescription: ""\n---\n正文\n', /description 为空/],
    ['---\ndescription: "x"\nunknown: y\n---\n正文\n', /未知 Frontmatter 字段/],
    ['---\ndescription: "x"\n---\n\n', /正文为空/],
  ]

  for (const [source, pattern] of cases) {
    assert.throws(() => parsePrompt(source, "test.md"), pattern)
  }
})
