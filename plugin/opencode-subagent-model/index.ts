import { subagentModelRpc } from "./rpc.ts"
import {
  registerSubagentModelPolicy,
  type SubagentModelContext,
  type SubagentModelHandlers,
} from "./subagent-model.ts"

interface SetupContext extends SubagentModelContext {
  readonly rpc: {
    register(definition: typeof subagentModelRpc, handlers: SubagentModelHandlers): Promise<unknown>
  }
}

export default {
  id: subagentModelRpc.id,
  async setup(ctx: SetupContext) {
    const handlers = await registerSubagentModelPolicy(ctx)
    await ctx.rpc.register(subagentModelRpc, handlers)
  },
}
