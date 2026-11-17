import { detectLegacyPlugin } from "./legacy.ts"
import { registerTeamPolicy, type TeamPolicyContext, type TeamPolicyHandlers } from "./policy.ts"
import { teamRpc } from "./rpc.ts"
import { registerTeamAgents, TEAM_SUBAGENT_IDS, type TeamAgentContext } from "./team-agents.ts"

interface LegacyRpcClient {
  getSubagentModel(input: Record<string, never>): Promise<{
    readonly ok: boolean
    readonly supported: boolean
    readonly model?: string | null
    readonly errors?: readonly string[]
  }>
}

interface SetupContext extends Omit<TeamPolicyContext, "agent"> {
  readonly agent?: NonNullable<TeamPolicyContext["agent"]> & NonNullable<TeamAgentContext["agent"]>
  readonly rpc: {
    <Definition>(definition: Definition): LegacyRpcClient
    register(definition: typeof teamRpc, handlers: TeamPolicyHandlers): Promise<unknown>
  }
}

export default {
  id: teamRpc.id,
  async setup(ctx: SetupContext) {
    const agents = await registerTeamAgents(ctx)
    const legacy = await detectLegacyPlugin(ctx)
    const initialConflict = legacy.active ? legacy.conflict : undefined
    const detect = async () => {
      const next = await detectLegacyPlugin(ctx)
      // A transient inventory failure must not re-enable enforcement beside a known old plugin.
      if (next.error !== undefined) throw new Error(next.error)
      return next.active ? next.conflict : undefined
    }
    const handlers = await registerTeamPolicy(ctx, {
      ...(initialConflict === undefined ? {} : { conflict: initialConflict }),
      agentsSupported: agents.supported,
      fallbackAgents: TEAM_SUBAGENT_IDS,
      resolveConflict: detect,
    })
    await ctx.rpc.register(teamRpc, handlers)
  },
}
