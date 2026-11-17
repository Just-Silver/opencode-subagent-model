import assert from "node:assert/strict"
import { test } from "node:test"

import { TEAM_AGENTS, type PermissionRule } from "../plugin/opencode-team/team-agents.ts"

/**
 * Mirrors the host contract in packages/core/src/permission.ts and packages/core/src/tool.ts:
 * - rules match by wildcard, last match wins
 * - deny is checked before saved "always" grants are appended
 * - a tool is hidden only when its last matching action rule denies every resource
 * - session permissions are appended after agent permissions
 */
const BASE_DEFAULT: readonly PermissionRule[] = [
  { action: "*", resource: "*", effect: "allow" },
  { action: "read", resource: "*.env", effect: "ask" },
  { action: "read", resource: "*.env.*", effect: "ask" },
  { action: "read", resource: "*.env.example", effect: "allow" },
]

const GENERAL_NATIVE: readonly PermissionRule[] = [
  ...BASE_DEFAULT,
  { action: "question", resource: "*", effect: "deny" },
  { action: "subagent", resource: "*", effect: "deny" },
]

function wildcard(input: string, pattern: string): boolean {
  const normalized = input.replaceAll("\\", "/")
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"
  return new RegExp(`^${escaped}$`, "s").test(normalized)
}

function evaluate(
  action: string,
  resource: string,
  ...rulesets: readonly (readonly PermissionRule[])[]
): PermissionRule {
  return (
    rulesets
      .flat()
      .findLast((rule) => wildcard(action, rule.action) && wildcard(resource, rule.resource)) ?? {
      action,
      resource: "*",
      effect: "ask",
    }
  )
}

function whollyDisabled(action: string, rules: readonly PermissionRule[]): boolean {
  const rule = [...rules].findLast((candidate) => wildcard(action, candidate.action))
  return rule?.resource === "*" && rule.effect === "deny"
}

function effective(agentID: string, extra: readonly PermissionRule[] = []): PermissionRule[] {
  const agent = TEAM_AGENTS.find((candidate) => candidate.id === agentID)!
  return [...BASE_DEFAULT, ...agent.permissions, ...extra]
}

function evaluateInput(
  action: string,
  resources: readonly string[],
  rules: readonly PermissionRule[],
  saved: readonly PermissionRule[] = [],
): "allow" | "deny" | "ask" {
  if (resources.some((resource) => evaluate(action, resource, rules).effect === "deny")) return "deny"
  const all = [...rules, ...saved]
  const effects = resources.map((resource) => evaluate(action, resource, all).effect)
  return effects.includes("ask") ? "ask" : "allow"
}

test("Orchestrator 不注入规则；QA/Reviewer 拒绝 question 与 subagent，其余继承默认开放", () => {
  const orchestrator = effective("orchestrator")
  for (const action of ["edit", "shell", "subagent", "question", "grep", "glob"]) {
    assert.equal(whollyDisabled(action, orchestrator), false, `orchestrator 不应限制 ${action}`)
  }
  assert.equal(evaluateInput("question", ["*"], orchestrator), "allow")

  for (const agentID of ["qa", "reviewer"]) {
    const rules = effective(agentID)
    assert.equal(whollyDisabled("question", rules), true, `${agentID} 应隐藏 question`)
    assert.equal(whollyDisabled("subagent", rules), true, `${agentID} 应隐藏 subagent`)
    assert.equal(evaluateInput("question", ["*"], rules), "deny")
    assert.equal(evaluateInput("subagent", ["general"], rules), "deny")
    for (const action of ["edit", "shell", "grep", "glob"]) {
      assert.equal(whollyDisabled(action, rules), false, `${agentID} 不应限制 ${action}`)
    }
    assert.equal(evaluateInput("edit", ["src/a.ts"], rules), "allow")
    assert.equal(evaluateInput("shell", ["rm -rf src"], rules), "allow")
    assert.equal(evaluateInput("read", [".env"], rules), "ask")
  }
})

test("用户配置可以收紧或放开团队成员，插件不覆盖", () => {
  const denyEdit = effective("qa", [{ action: "edit", resource: "*", effect: "deny" }])
  assert.equal(whollyDisabled("edit", denyEdit), true)
  assert.equal(evaluateInput("edit", ["src/a.ts"], denyEdit), "deny")

  const denyShell = effective("reviewer", [{ action: "shell", resource: "*", effect: "deny" }])
  assert.equal(whollyDisabled("shell", denyShell), true)

  const allowQuestion = effective("qa", [{ action: "question", resource: "*", effect: "allow" }])
  assert.equal(whollyDisabled("question", allowQuestion), false)
  assert.equal(evaluateInput("question", ["*"], allowQuestion), "allow")

  const allowSubagent = effective("qa", [{ action: "subagent", resource: "*", effect: "allow" }])
  assert.equal(whollyDisabled("subagent", allowSubagent), false)
  assert.equal(evaluateInput("subagent", ["general"], allowSubagent), "allow")

  const denyOrchestratorQuestion = effective("orchestrator", [
    { action: "question", resource: "*", effect: "deny" },
  ])
  assert.equal(whollyDisabled("question", denyOrchestratorQuestion), true)

  const allowGeneralSubagent = [
    ...GENERAL_NATIVE,
    { action: "subagent", resource: "*", effect: "allow" },
  ] as PermissionRule[]
  assert.equal(evaluateInput("subagent", ["explore"], GENERAL_NATIVE), "deny")
  assert.equal(evaluateInput("subagent", ["explore"], allowGeneralSubagent), "allow")
})

test("用户配置拒绝 edit 时同时隐藏 write 与 patch", () => {
  const denyEdit = effective("qa", [{ action: "edit", resource: "*", effect: "deny" }])
  for (const tool of ["edit", "write", "patch"]) {
    assert.equal(whollyDisabled("edit", denyEdit), true, `${tool} 使用 edit 动作，应被隐藏`)
  }
})

test("会话权限追加在 Agent 之后，可进一步收紧或放开", () => {
  const qa = effective("qa")
  const sessionDenyShell = [...qa, { action: "shell", resource: "*", effect: "deny" }] as PermissionRule[]
  assert.equal(evaluateInput("shell", ["git status"], sessionDenyShell), "deny")

  const sessionAllowEdit = [...effective("qa", [{ action: "edit", resource: "*", effect: "deny" }]), {
    action: "edit",
    resource: "*",
    effect: "allow",
  }] as PermissionRule[]
  assert.equal(evaluateInput("edit", ["src/a.ts"], sessionAllowEdit), "allow")
})

test("saved always allow 不能覆盖 Agent deny", () => {
  const denyEdit = effective("qa", [{ action: "edit", resource: "*", effect: "deny" }])
  const saved = [{ action: "edit", resource: "*", effect: "allow" }] as PermissionRule[]
  assert.equal(evaluateInput("edit", ["src/a.ts"], denyEdit, saved), "deny")

  const savedQuestion = [{ action: "question", resource: "*", effect: "allow" }] as PermissionRule[]
  assert.equal(evaluateInput("question", ["*"], effective("qa"), savedQuestion), "deny")

  const savedSubagent = [{ action: "subagent", resource: "*", effect: "allow" }] as PermissionRule[]
  assert.equal(evaluateInput("subagent", ["general"], effective("qa"), savedSubagent), "deny")
})

test("子会话使用自己的 Agent 规则，派生子代理使用父 Agent 的规则", () => {
  assert.equal(evaluateInput("edit", ["src/a.ts"], GENERAL_NATIVE), "allow")
  assert.equal(evaluateInput("edit", ["src/a.ts"], effective("qa")), "allow")
  assert.equal(
    evaluateInput("edit", ["src/a.ts"], effective("qa", [{ action: "edit", resource: "*", effect: "deny" }])),
    "deny",
  )

  assert.equal(evaluateInput("subagent", ["qa"], GENERAL_NATIVE), "deny")
  assert.equal(evaluateInput("subagent", ["general"], effective("qa")), "deny")
  assert.equal(evaluateInput("subagent", ["qa"], effective("orchestrator")), "allow")
  assert.equal(evaluateInput("question", ["*"], effective("qa")), "deny")
  assert.equal(evaluateInput("question", ["*"], effective("orchestrator")), "allow")
})
