import { Plugin } from "@opencode/plugin/tui"
import { teamRpc } from "./rpc.ts"
import { configureTeam } from "./view/configure.tsx"

export default Plugin.define({
  id: teamRpc.id,
  setup(context) {
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: `${teamRpc.id}.configure`,
          title: "Agent 团队与模型",
          group: "Model",
          slash: { name: "team" },
          palette: true,
          run: () => configureTeam(context),
        },
      ],
    }))
  },
})
