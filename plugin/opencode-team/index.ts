import { detectLegacyPlugin } from "./legacy.ts"
import {
  readDefaultAgentSetting,
  registerTeamPolicy,
  type TeamPolicyContext,
  type TeamPolicyHandlers,
} from "./policy.ts"
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
  readonly agent?: NonNullable<TeamPolicyContext["agent"]> &
    NonNullable<TeamAgentContext["agent"]> & { readonly reload?: () => Promise<void> }
  readonly rpc: {
    <Definition>(definition: Definition): LegacyRpcClient
    register(definition: typeof teamRpc, handlers: TeamPolicyHandlers): Promise<unknown>
  }
}

export default {
  id: teamRpc.id,
  async setup(ctx: SetupContext) {
    const setting = await readDefaultAgentSetting(ctx.storage)
    let defaultAgent = setting.ok && setting.value
    const agents = await registerTeamAgents(ctx, { defaultAgent: () => defaultAgent })
    const detect = async () => {
      const next = await detectLegacyPlugin(ctx)
      // A transient inventory failure must not re-enable enforcement beside a known old plugin.
      if (next.error !== undefined) throw new Error(next.error)
      return next.active ? next.conflict : undefined
    }
    const handlers = await registerTeamPolicy(ctx, {
      agentsSupported: agents.supported,
      ...(agents.error === undefined ? {} : { agentsError: agents.error }),
      ...(setting.ok ? {} : { defaultAgentError: setting.error }),
      fallbackAgents: TEAM_SUBAGENT_IDS,
      resolveConflict: detect,
    })
    await ctx.rpc.register(teamRpc, {
      ...handlers,
      getTeamPolicy: async (input) => {
        const summary = await handlers.getTeamPolicy(input)
        // 开关是全局存储，transform 闭包按 location 各自持有；打开面板时把本 location 拉回一致。
        if (
          summary.ok &&
          summary.defaultAgent !== undefined &&
          summary.defaultAgent !== defaultAgent
        ) {
          defaultAgent = summary.defaultAgent
          if (typeof ctx.agent?.reload === "function") {
            try {
              await ctx.agent.reload()
            } catch {
              // 面板仍展示存储值；下次重启或重载时生效。
            }
          }
        }
        return summary
      },
      setDefaultAgent: async (input) => {
        const summary = await handlers.setDefaultAgent(input)
        if (!summary.ok) return summary
        defaultAgent = summary.defaultAgent === true
        if (typeof ctx.agent?.reload !== "function") {
          return {
            ...summary,
            warnings: [
              ...(summary.warnings ?? []),
              "当前宿主不支持重新加载 Agent 定义；设置已保存，重启 OpenCode 后生效。",
            ],
          }
        }
        try {
          await ctx.agent.reload()
          return summary
        } catch (error) {
          return {
            ...summary,
            warnings: [
              ...(summary.warnings ?? []),
              `设置已保存，但重新加载 Agent 定义失败：${error instanceof Error ? error.message : String(error)}；重启 OpenCode 后生效。`,
            ],
          }
        }
      },
    })
  },
}
