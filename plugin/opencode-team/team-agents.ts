import { ORCHESTRATOR_PROMPT, QA_PROMPT, REVIEWER_PROMPT } from "./prompts.ts"

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
    description:
      "Primary team lead responsible for end-to-end delivery. Dynamically delegates or executes tasks, coordinates parallel work and Git operations, reconciles agent findings, and owns final decisions and verification.",
    mode: "primary",
    system: ORCHESTRATOR_PROMPT,
    permissions: [],
  },
  {
    id: "qa",
    name: "QA",
    description:
      "Independent quality assurance agent. Designs and executes acceptance and regression tests against requirements and contracts, investigates failures, and independently verifies fixes. Production code changes require explicit authorization.",
    mode: "subagent",
    system: QA_PROMPT,
    permissions: LEAF_SUBAGENT_PERMISSIONS,
  },
  {
    id: "reviewer",
    name: "Reviewer",
    description:
      "Independent code reviewer. Primarily reviews source code for correctness, architecture, and risks, using targeted verification when needed. Reports evidence-based findings without replacing QA acceptance testing. Production code changes require explicit authorization.",
    mode: "subagent",
    system: REVIEWER_PROMPT,
    permissions: LEAF_SUBAGENT_PERMISSIONS,
  },
]

export interface TeamAgentEditor {
  get(id: string): { readonly id: string } | undefined
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

export async function registerTeamAgents(ctx: TeamAgentContext): Promise<TeamAgentRegistration> {
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
          agent.permissions.push(...definition.permissions)
        })
      }
    })
  } catch (error) {
    return {
      supported: false,
      error: `Team agent registration failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  return { supported: true }
}
