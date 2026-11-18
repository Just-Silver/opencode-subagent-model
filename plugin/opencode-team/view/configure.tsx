/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"

import { TeamDashboard } from "./dashboard.tsx"
import { normalizeFavorites, toggleFavorite, type DashboardAgent } from "./model.ts"
import {
  currentLocation,
  loadTeamDashboard,
  refreshModels,
  restoreAgentModel,
  saveAgentModel,
  setDefaultAgent,
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
  let overrides: Readonly<Record<string, string>> = data.overrides
  let closed = false
  // 收藏是界面偏好，与模型策略分开存；与 /models 的私有 state 不互通。
  const [favorites, setFavorites] = ctx.storage.store("team-favorites", {
    initial: { models: [] as string[] },
  })

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
          {...(data.agentsError === undefined ? {} : { agentsError: data.agentsError })}
          defaultAgent={data.defaultAgent}
          toggleDefaultAgent={(enabled) => setDefaultAgent(ctx, location, enabled)}
          refreshModels={() => refreshModels(ctx, location)}
          favorites={normalizeFavorites(favorites)}
          toggleFavorite={async (ref) => {
            try {
              await setFavorites((draft) => {
                draft.models = toggleFavorite(normalizeFavorites(draft), ref)
              })
              return { ok: true }
            } catch (error) {
              return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }
            }
          }}
          theme={ctx.theme}
          layer={(factory) => ctx.keymap.layer(factory)}
          clearDialog={() => ctx.ui.dialog.clear()}
          saveModel={async (agent: DashboardAgent, model: string | null) => {
            const saved = await saveAgentModel(ctx, location, agent, model)
            if (saved.saved && saved.models !== undefined) overrides = saved.models
            return saved
          }}
          restoreModel={async (agent: DashboardAgent) => {
            const restored = await restoreAgentModel(ctx, location, agent)
            if (restored.saved && restored.models !== undefined) overrides = restored.models
            return restored
          }}
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
