const emptyInput = { type: "object", properties: {}, additionalProperties: false } as const

const agentModels = {
  type: "object",
  additionalProperties: { type: "string" },
} as const

const conflict = {
  type: "object",
  properties: {
    pluginID: { type: "string" },
    source: { type: "string" },
  },
  required: ["pluginID"],
  additionalProperties: false,
} as const

const migration = {
  type: "object",
  properties: {
    from: { type: "string" },
    status: { type: "string" },
    agents: { type: "array", items: { type: "string" } },
    errors: { type: "array", items: { type: "string" } },
  },
  required: ["from", "status"],
  additionalProperties: false,
} as const

const stateOutput = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    supported: { type: "boolean" },
    agentsSupported: { type: "boolean" },
    agentsError: { type: "string" },
    defaultAgent: { type: "boolean" },
    models: agentModels,
    errors: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
    conflict,
    migration,
  },
  required: ["ok", "supported"],
  additionalProperties: false,
} as const

export const teamRpc = {
  id: "opencode-team",
  methods: {
    getTeamPolicy: {
      input: emptyInput,
      output: stateOutput,
    },
    setAgentModel: {
      input: {
        type: "object",
        properties: {
          agentID: { type: "string", minLength: 1 },
          model: { type: ["string", "null"] },
        },
        required: ["agentID", "model"],
        additionalProperties: false,
      },
      output: stateOutput,
    },
    setDefaultAgent: {
      input: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
        },
        required: ["enabled"],
        additionalProperties: false,
      },
      output: stateOutput,
    },
  },
  events: {},
} as const

export interface TeamConflict {
  readonly pluginID: string
  readonly source?: string
}

export interface TeamMigration {
  readonly from: string
  readonly status: "applied" | "empty" | "unavailable" | "failed"
  readonly agents?: readonly string[]
  readonly errors?: readonly string[]
}

export interface TeamPolicySummary {
  readonly ok: boolean
  readonly supported: boolean
  readonly agentsSupported?: boolean
  readonly agentsError?: string
  readonly defaultAgent?: boolean
  readonly models?: Readonly<Record<string, string>>
  readonly errors?: readonly string[]
  readonly warnings?: readonly string[]
  readonly conflict?: TeamConflict
  readonly migration?: TeamMigration
}
