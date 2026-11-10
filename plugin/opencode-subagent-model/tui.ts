import { Plugin } from "@opencode/plugin/tui"
import { subagentModelRpc } from "./rpc.ts"
import { configureSubagentModel } from "./view/subagent-model.ts"

export default Plugin.define({
  id: subagentModelRpc.id,
  setup(context) {
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: `${subagentModelRpc.id}.configure`,
          title: "子代理统一模型",
          group: "Model",
          slash: { name: "subagent-model" },
          palette: true,
          run: () => configureSubagentModel(context),
        },
      ],
    }))
  },
})
