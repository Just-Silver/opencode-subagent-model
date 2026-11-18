import { ORCHESTRATOR_PROMPT, QA_PROMPT, REVIEWER_PROMPT } from "./prompts.generated.ts"

export { TEAM_SUBAGENT_IDS } from "./team-ids.ts"

export interface PermissionRule {
  readonly action: string
  readonly resource: string
  readonly effect: "allow" | "deny" | "ask"
}

export interface TeamAgentDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly mode: "primary" | "subagent"
  readonly system: string
  readonly permissions: readonly PermissionRule[]
}

// QA and Reviewer are leaves: the primary Orchestrator owns user interaction and further delegation.
const LEAF_SUBAGENT_PERMISSIONS: readonly PermissionRule[] = [
  { action: "question", resource: "*", effect: "deny" },
  { action: "subagent", resource: "*", effect: "deny" },
]

export const TEAM_AGENTS: readonly TeamAgentDefinition[] = [
  {
    id: "orchestrator",
    name: "Orchestrator",
    description: ORCHESTRATOR_PROMPT.description,
    mode: "primary",
    system: ORCHESTRATOR_PROMPT.system,
    permissions: [],
  },
  {
    id: "qa",
    name: "QA",
    description: QA_PROMPT.description,
    mode: "subagent",
    system: QA_PROMPT.system,
    permissions: LEAF_SUBAGENT_PERMISSIONS,
  },
  {
    id: "reviewer",
    name: "Reviewer",
    description: REVIEWER_PROMPT.description,
    mode: "subagent",
    system: REVIEWER_PROMPT.system,
    permissions: LEAF_SUBAGENT_PERMISSIONS,
  },
]

export interface TeamAgentEditor {
  get(id: string): { readonly id: string } | undefined
  default(id: string | undefined): void
  update(
    id: string,
    update: (agent: {
      name: string
      description?: string
      mode: "primary" | "subagent" | "all"
      system?: string
      hidden: boolean
      permissions: PermissionRule[]
    }) => void,
  ): void
}

export interface TeamAgentContext {
  readonly agent?: {
    transform(callback: (editor: TeamAgentEditor) => void): Promise<{ dispose(): Promise<void> }>
  }
}

export interface TeamAgentRegistration {
  readonly supported: boolean
  readonly error?: string
}

export async function registerTeamAgents(
  ctx: TeamAgentContext,
  options: { readonly defaultAgent?: () => boolean } = {},
): Promise<TeamAgentRegistration> {
  const transform = ctx.agent?.transform
  if (typeof transform !== "function") {
    return { supported: false, error: "This host cannot register agents at runtime." }
  }
  try {
    await transform((editor) => {
      for (const definition of TEAM_AGENTS) {
        editor.update(definition.id, (agent) => {
          agent.name = definition.name
          agent.description = definition.description
          agent.mode = definition.mode
          agent.system = definition.system
          agent.hidden = false
          // 正常 reload 会重建 Agent 状态；这里防御同一 editor 被重复应用时规则累积。
          for (const rule of definition.permissions) {
            const exists = agent.permissions.some(
              (current) =>
                current.action === rule.action &&
                current.resource === rule.resource &&
                current.effect === rule.effect,
            )
            if (!exists) agent.permissions.push(rule)
          }
        })
      }
      // reload 会重跑 transform；用 getter 读当前设置，开关切换后无需重建注册。
      if (options.defaultAgent?.() === true) editor.default("orchestrator")
    })
  } catch (error) {
    return {
      supported: false,
      error: `Team agent registration failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  return { supported: true }
}
