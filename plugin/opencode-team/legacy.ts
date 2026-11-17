import type { LegacyPluginInfo, TeamPolicyContext } from "./policy.ts"
import type { TeamConflict } from "./rpc.ts"

export const LEGACY_PLUGIN_ID = "opencode-subagent-model"
export const LEGACY_PACKAGE = "@justsilver/opencode-subagent-model"
const LEGACY_SOURCE_SUFFIX = "opencode-subagent-model"

export interface LegacyDetection {
  readonly conflict?: TeamConflict
  /** The loaded legacy plugin is active; its RPC can hand over the old setting. */
  readonly active: boolean
  readonly error?: string
}

/**
 * A second copy of the old package is dangerous in a way a package-name check alone cannot see:
 * its global hook overwrites every subagent model after ours. Detect the plugin ID and both the
 * package and local-source forms, and require the plugin to be active before trusting its RPC.
 */
export async function detectLegacyPlugin(ctx: Pick<TeamPolicyContext, "plugin">): Promise<LegacyDetection> {
  const list = ctx.plugin?.list
  if (typeof list !== "function") return { active: false }
  let plugins: readonly LegacyPluginInfo[]
  try {
    plugins = (await list()).data
  } catch (error) {
    return { active: false, error: `Cannot list plugins: ${error instanceof Error ? error.message : String(error)}` }
  }
  const legacy = plugins.find(
    (plugin) =>
      plugin.id === LEGACY_PLUGIN_ID ||
      plugin.source.target === LEGACY_PACKAGE ||
      (plugin.source.type === "local" &&
        plugin.source.path?.replaceAll("\\", "/").replace(/\/+$/, "").endsWith(`/${LEGACY_SOURCE_SUFFIX}`)),
  )
  if (legacy === undefined) return { active: false }
  return {
    active: legacy.state.status === "active",
    conflict: {
      pluginID: legacy.id ?? LEGACY_PLUGIN_ID,
      ...(legacy.source.target === undefined
        ? legacy.source.path === undefined
          ? {}
          : { source: legacy.source.path }
        : { source: legacy.source.target }),
    },
  }
}
