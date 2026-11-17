/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"

import { TeamDashboard, type DashboardSession } from "./dashboard.tsx"
import type { DashboardAgent } from "./model.ts"
import {
  currentLocation,
  loadTeamDashboard,
  restoreAgentModel,
  saveAgentModel,
} from "./team.ts"

// A second /team while a model picker is open replaces the first flow; the old continuation
// must not reopen its dashboard on top of the newer one.
let latest = 0

export async function configureTeam(ctx: Plugin.Context): Promise<void> {
  const token = ++latest
  const location = currentLocation(ctx)
  const result = await loadTeamDashboard(ctx, location)
  if (token !== latest) return
  if (result.kind === "blocked") {
    ctx.ui.toast.show({ variant: "error", message: result.message })
    return
  }

  const data = result.data
  if (!data.agentsSupported) {
    ctx.ui.toast.show({
      variant: "warning",
      message:
        "当前宿主不能动态注册团队 Agent；Orchestrator、QA、Reviewer 不可用，但现有子代理的模型覆盖仍可配置。",
    })
  }

  let overrides: Readonly<Record<string, string>> = data.overrides
  let closed = false
  const session: DashboardSession = {
    query: "",
    searching: false,
    pane: "list",
  }

  const open = (): void => {
    if (token !== latest || closed) return
    ctx.ui.dialog.show(
      () => (
        <TeamDashboard
          agents={data.agents}
          overrides={overrides}
          models={data.models}
          providers={data.providers}
          {...(data.modelError === undefined ? {} : { modelError: data.modelError })}
          {...(data.warning === undefined ? {} : { warning: data.warning })}
          agentsSupported={data.agentsSupported}
          session={session}
          theme={ctx.theme}
          layer={(factory) => ctx.keymap.layer(factory)}
          clearDialog={() => ctx.ui.dialog.clear()}
          saveModel={async (agent: DashboardAgent, model: string | null) => {
            const saved = await saveAgentModel(ctx, location, agent, model)
            if (saved === undefined) return undefined
            overrides = saved.models ?? overrides
            return overrides
          }}
          restoreModel={async (agent: DashboardAgent) => {
            const restored = await restoreAgentModel(ctx, location, agent)
            if (restored?.models === undefined) return undefined
            overrides = restored.models
            return restored.models
          }}
          notify={(message) => ctx.ui.toast.show({ variant: "info", message })}
          close={() => {
            closed = true
          }}
        />
      ),
      () => {},
    )
    // show() resets the dialog to medium; set the dashboard presentation after it is mounted.
    ctx.ui.dialog.set({ size: "xlarge", centered: true })
  }

  open()
}
