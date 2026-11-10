const emptyInput = { type: "object", properties: {}, additionalProperties: false } as const

const policyOutput = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    supported: { type: "boolean" },
    model: { type: ["string", "null"] },
    errors: { type: "array", items: { type: "string" } },
  },
  required: ["ok", "supported"],
  additionalProperties: false,
} as const

export const subagentModelRpc = {
  id: "opencode-subagent-model",
  methods: {
    getSubagentModel: {
      input: emptyInput,
      output: policyOutput,
    },
    setSubagentModel: {
      input: {
        type: "object",
        properties: { model: { type: ["string", "null"] } },
        required: ["model"],
        additionalProperties: false,
      },
      output: policyOutput,
    },
  },
  events: {},
} as const

export interface SubagentModelSummary {
  readonly ok: boolean
  readonly supported: boolean
  readonly model?: string | null
  readonly errors?: readonly string[]
}
