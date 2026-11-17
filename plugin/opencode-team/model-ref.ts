export interface ModelRef {
  readonly providerID: string
  readonly id: string
  readonly variant?: string
}

// 模型 ID 本身可能包含 /，因此只在第一个 / 分隔供应商。
export function parseModelRef(input: string): ModelRef | undefined {
  const providerEnd = input.indexOf("/")
  if (providerEnd <= 0) return undefined
  const variantStart = input.indexOf("#", providerEnd + 1)
  const providerID = input.slice(0, providerEnd)
  const id = input.slice(providerEnd + 1, variantStart === -1 ? undefined : variantStart)
  const variant = variantStart === -1 ? undefined : input.slice(variantStart + 1)
  if (!id || providerID.includes("#") || (variant !== undefined && (!variant || variant.includes("#")))) {
    return undefined
  }
  return { providerID, id, ...(variant === undefined ? {} : { variant }) }
}

export function formatModelRef(ref: ModelRef): string {
  return `${ref.providerID}/${ref.id}${ref.variant === undefined ? "" : `#${ref.variant}`}`
}

/** 与宿主一致：未声明 type 的模型按 chat 处理。 */
export function isChatModel(model: { readonly type?: string }): boolean {
  return model.type === undefined || model.type === "chat"
}
