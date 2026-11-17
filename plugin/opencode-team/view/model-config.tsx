/** @jsxImportSource @opentui/solid */
import {
  TextAttributes,
  type InputRenderable,
  type Renderable,
  type ScrollBoxRenderable,
} from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { ModelInfo, ProviderInfo } from "@opencode/client"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from "solid-js"

import {
  buildModelRef,
  modelConfigLayoutFor,
  modelGroups,
  modelRefOf,
  parseModelRef,
  resolveModel,
  roleLabel,
  variantsFor,
  type DashboardAgent,
} from "./model.ts"
import { Badge, Hints, type Hint, type KeymapLayer, type Theme } from "./ui.tsx"

type Focus = "models" | "variants" | "search"

interface VariantOption {
  readonly id?: string
  readonly label: string
}

export interface ModelConfigProps {
  readonly agent: DashboardAgent
  readonly models: readonly ModelInfo[]
  readonly providers: readonly ProviderInfo[]
  readonly currentOverride?: string
  readonly modelError?: string
  readonly theme: Theme
  readonly layer: (factory: () => KeymapLayer) => void
  readonly onClose: () => void
  readonly onSave: (model: string) => Promise<boolean>
  readonly onRestore: () => Promise<boolean>
  readonly notify: (message: string) => void
}

export function ModelConfigView(props: ModelConfigProps) {
  const theme = () => props.theme.surface("dialog")
  const dimensions = useTerminalDimensions()
  const layout = createMemo(() => modelConfigLayoutFor(dimensions().width, dimensions().height))

  const current = createMemo(() => {
    const ref = props.currentOverride ?? props.agent.hostModel
    if (ref === undefined) return undefined
    const parsed = parseModelRef(ref)
    if (parsed === undefined) return undefined
    return {
      baseRef: `${parsed.providerID}/${parsed.id}`,
      ...(parsed.variant === undefined ? {} : { variant: parsed.variant }),
    }
  })

  const initialGroups = modelGroups(props.models, props.providers, "")
  const firstModel = initialGroups[0]?.models[0]
  const initialCurrent = current()
  const initialModel =
    initialCurrent === undefined
      ? firstModel
      : (resolveModel(props.models, initialCurrent.baseRef) ?? firstModel)
  const initialVariants = variantsFor(initialModel)
  const initialVariant =
    initialCurrent?.baseRef === (initialModel === undefined ? "" : modelRefOf(initialModel)) &&
    initialCurrent.variant !== undefined &&
    initialVariants.includes(initialCurrent.variant)
      ? initialCurrent.variant
      : undefined

  const [selectedRef, setSelectedRef] = createSignal(
    initialModel === undefined ? "" : modelRefOf(initialModel),
  )
  const [variant, setVariant] = createSignal<string | undefined>(initialVariant)
  const [variantCursor, setVariantCursor] = createSignal(
    initialVariant === undefined ? 0 : initialVariants.indexOf(initialVariant) + 1,
  )
  const [query, setQuery] = createSignal("")
  const [focus, setFocus] = createSignal<Focus>("models")
  const [saving, setSaving] = createSignal(false)
  const [saveFailed, setSaveFailed] = createSignal(false)

  const groups = createMemo(() => modelGroups(props.models, props.providers, query()))
  const flatModels = createMemo(() => groups().flatMap((group) => group.models))
  const selectedModel = createMemo(() => resolveModel(props.models, selectedRef()))
  const variants = createMemo(() => variantsFor(selectedModel()))
  const variantRows = createMemo<VariantOption[]>(() => [
    { label: "默认" },
    ...variants().map((id) => ({ id, label: id })),
  ])

  const pendingLabel = () => {
    const model = selectedModel()
    if (model === undefined) return "—"
    return variant() === undefined ? `${model.name} · 默认` : `${model.name} · ${variant()}`
  }

  let modelScroll: ScrollBoxRenderable | undefined
  let variantScroll: ScrollBoxRenderable | undefined
  let searchInput: InputRenderable | undefined
  let focusTimer: ReturnType<typeof setTimeout> | undefined
  let scrollTimer: ReturnType<typeof setTimeout> | undefined
  const modelNodes = new Map<string, Renderable>()
  const variantNodes = new Map<number, Renderable>()

  createEffect(() => {
    const list = flatModels()
    if (list.length === 0) return
    if (!list.some((model) => modelRefOf(model) === selectedRef())) {
      setSelectedRef(modelRefOf(list[0]!))
    }
  })

  createEffect(
    on(
      selectedRef,
      (ref) => {
        const model = resolveModel(props.models, ref)
        const available = variantsFor(model)
        const currentValue = current()
        const next =
          currentValue?.baseRef === ref &&
          currentValue.variant !== undefined &&
          available.includes(currentValue.variant)
            ? currentValue.variant
            : undefined
        setVariant(next)
        setVariantCursor(next === undefined ? 0 : available.indexOf(next) + 1)
        setSaveFailed(false)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(focus, (value) => {
      if (value === "search") {
        if (focusTimer !== undefined) clearTimeout(focusTimer)
        focusTimer = setTimeout(() => {
          if (searchInput !== undefined && !searchInput.isDestroyed) searchInput.focus()
        }, 1)
      } else {
        if (searchInput !== undefined && !searchInput.isDestroyed) searchInput.blur()
      }
    }),
  )

  createEffect(on(selectedRef, (ref) => ensureModelVisible(ref)))
  createEffect(on(variantCursor, (index) => ensureVariantVisible(index)))
  onCleanup(() => {
    if (focusTimer !== undefined) clearTimeout(focusTimer)
    if (scrollTimer !== undefined) clearTimeout(scrollTimer)
  })

  function ensureModelVisible(ref: string): void {
    ensureVisible(modelScroll, modelNodes.get(ref))
  }

  function ensureVariantVisible(index: number): void {
    ensureVisible(variantScroll, variantNodes.get(index))
  }

  function ensureVisible(scroll: ScrollBoxRenderable | undefined, node: Renderable | undefined): void {
    if (scroll === undefined || node === undefined || node.isDestroyed) return
    if (scrollTimer !== undefined) clearTimeout(scrollTimer)
    scrollTimer = setTimeout(() => {
      if (scroll === undefined || scroll.isDestroyed || node.isDestroyed) return
      const top = node.y - scroll.y
      if (top < 0) scroll.scrollBy(top - 1)
      else if (top + node.height > scroll.height) {
        scroll.scrollBy(top + node.height - scroll.height + 1)
      }
    }, 0)
  }

  function cycleFocus(delta: number): void {
    if (focus() === "variants" && variants().length === 0) {
      setFocus("models")
      return
    }
    const order: Focus[] =
      variants().length > 0 ? ["models", "variants", "search"] : ["models", "search"]
    const index = order.indexOf(focus())
    const next = order[(index < 0 ? 0 : index + delta + order.length) % order.length]!
    setFocus(next)
  }

  function moveModel(delta: number): void {
    const list = flatModels()
    if (list.length === 0) return
    const index = list.findIndex((model) => modelRefOf(model) === selectedRef())
    const next = index < 0 ? 0 : (index + delta + list.length) % list.length
    setSelectedRef(modelRefOf(list[next]!))
  }

  function setVariantAt(index: number): void {
    const rows = variantRows()
    const row = rows[index]
    if (row === undefined) return
    setVariantCursor(index)
    setVariant(row.id)
    setSaveFailed(false)
    ensureVariantVisible(index)
  }

  function moveVariant(delta: number): void {
    if (variants().length === 0) return
    const rows = variantRows()
    const next = (variantCursor() + delta + rows.length) % rows.length
    setVariantAt(next)
  }

  function first(): void {
    if (focus() === "variants" && variants().length > 0) setVariantAt(0)
    else {
      const list = flatModels()
      if (list.length > 0) setSelectedRef(modelRefOf(list[0]!))
    }
  }

  function last(): void {
    if (focus() === "variants" && variants().length > 0) setVariantAt(variantRows().length - 1)
    else {
      const list = flatModels()
      if (list.length > 0) setSelectedRef(modelRefOf(list[list.length - 1]!))
    }
  }

  function page(delta: number): void {
    if (focus() === "variants") {
      const scroll = variantScroll
      if (scroll !== undefined && !scroll.isDestroyed) scroll.scrollBy(delta * 5)
      return
    }
    const scroll = modelScroll
    if (scroll !== undefined && !scroll.isDestroyed) scroll.scrollBy(delta * 10)
  }

  async function save(): Promise<void> {
    if (saving()) return
    const model = selectedModel()
    if (model === undefined) {
      props.notify("请选择一个模型。")
      return
    }
    setSaving(true)
    setSaveFailed(false)
    try {
      const saved = await props.onSave(buildModelRef(selectedRef(), variant()))
      setSaving(false)
      if (saved) props.onClose()
      else setSaveFailed(true)
    } catch {
      setSaving(false)
      setSaveFailed(true)
    }
  }

  async function restore(): Promise<void> {
    if (saving()) return
    setSaving(true)
    setSaveFailed(false)
    try {
      const restored = await props.onRestore()
      setSaving(false)
      if (restored) props.onClose()
    } catch {
      setSaving(false)
      setSaveFailed(true)
    }
  }

  function escape(): void {
    if (saving()) return
    if (focus() === "search") {
      if (query().trim() !== "") {
        setQuery("")
        setFocus("models")
        return
      }
      setFocus("models")
      return
    }
    props.onClose()
  }

  props.layer(() => ({
    mode: "modal",
    priority: 20,
    commands: [
      {
        id: "opencode-team.model.up",
        bind: "up",
        run: () => {
          if (focus() === "variants") moveVariant(-1)
          else moveModel(-1)
        },
      },
      {
        id: "opencode-team.model.up.k",
        bind: "k",
        enabled: () => focus() !== "search",
        run: () => {
          if (focus() === "variants") moveVariant(-1)
          else moveModel(-1)
        },
      },
      {
        id: "opencode-team.model.down",
        bind: "down",
        run: () => {
          if (focus() === "variants") moveVariant(1)
          else moveModel(1)
        },
      },
      {
        id: "opencode-team.model.down.j",
        bind: "j",
        enabled: () => focus() !== "search",
        run: () => {
          if (focus() === "variants") moveVariant(1)
          else moveModel(1)
        },
      },
      {
        id: "opencode-team.model.tab",
        bind: "tab",
        run: () => cycleFocus(1),
      },
      {
        id: "opencode-team.model.shift_tab",
        bind: "shift+tab",
        run: () => cycleFocus(-1),
      },
      {
        id: "opencode-team.model.enter",
        bind: "enter",
        run: () => void save(),
      },
      {
        id: "opencode-team.model.search",
        bind: "slash",
        enabled: () => focus() !== "search",
        run: () => setFocus("search"),
      },
      {
        id: "opencode-team.model.restore",
        bind: "r",
        enabled: () => focus() !== "search",
        run: () => void restore(),
      },
      {
        id: "opencode-team.model.home",
        bind: "home",
        run: first,
      },
      {
        id: "opencode-team.model.end",
        bind: "end",
        run: last,
      },
      {
        id: "opencode-team.model.page_up",
        bind: "pageup",
        run: () => page(-1),
      },
      {
        id: "opencode-team.model.page_down",
        bind: "pagedown",
        run: () => page(1),
      },
      {
        id: "opencode-team.model.escape",
        bind: "escape",
        run: escape,
      },
    ],
  }))

  const split = () => layout().split
  const showSearch = () => !layout().minimal || focus() === "search"
  const showModels = () => split() || focus() !== "variants"
  const showVariants = () => split() || focus() === "variants"

  return (
    <box flexGrow={1} minHeight={0} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between" gap={2} flexShrink={0}>
        <box flexDirection="row" gap={1}>
          <text fg={theme().text.base} attributes={TextAttributes.BOLD}>
            Agent Team
          </text>
          <text fg={theme().text.faint}>›</text>
          <text fg={theme().text.base}>模型配置</text>
        </box>
        <text fg={theme().text.muted}>ESC 返回</text>
      </box>

      <box paddingTop={1} flexShrink={0}>
        <AgentCard theme={theme()} agent={props.agent} compact={layout().compact} />
      </box>

      <Show when={showSearch()}>
        <box paddingTop={1} flexShrink={0}>
          <SearchBox
            theme={theme()}
            query={query()}
            focused={focus() === "search"}
            onFocus={() => setFocus("search")}
            onInput={(value) => {
              setQuery(value)
              if (focus() !== "search") setFocus("search")
            }}
            inputRef={(value) => {
              searchInput = value
            }}
          />
        </box>
      </Show>

      <Show when={props.modelError !== undefined}>
        <box paddingTop={1} flexShrink={0}>
          <text fg={theme().text.feedback.warning.base} wrapMode="word">
            ! {props.modelError}；模型目录不可用时仍可清除团队覆盖。
          </text>
        </box>
      </Show>

      <box flexGrow={1} minHeight={0} paddingTop={1} flexDirection="row">
        <Show when={showModels()}>
          <ModelList
            theme={theme()}
            groups={groups()}
            selectedRef={selectedRef()}
            currentBase={current()?.baseRef}
            compact={layout().compact}
            onSelect={(ref) => {
              setSelectedRef(ref)
              setFocus("models")
            }}
            onRef={(ref, node) => modelNodes.set(ref, node)}
            onScrollRef={(value) => (modelScroll = value)}
          />
        </Show>
        <Show when={split()}>
          <box width={1} flexShrink={0} backgroundColor={theme().border.base} />
        </Show>
        <Show when={showVariants()}>
          <VariantPane
            theme={theme()}
            model={selectedModel()}
            variants={variantRows()}
            cursor={variantCursor()}
            pending={pendingLabel()}
            focused={focus() === "variants"}
            width={split() ? layout().variantWidth : undefined}
            saving={saving()}
            failed={saveFailed()}
            onSelect={(index) => {
              setVariantAt(index)
              setFocus("variants")
            }}
            onRef={(index, node) => variantNodes.set(index, node)}
            onScrollRef={(value) => (variantScroll = value)}
          />
        </Show>
      </box>

      <Foot
        theme={theme()}
        minimal={layout().minimal}
        focus={focus()}
        saving={saving()}
      />
    </box>
  )
}

function AgentCard(props: {
  readonly theme: Theme
  readonly agent: DashboardAgent
  readonly compact: boolean
}) {
  return (
    <box
      backgroundColor={props.theme.background.raised.base}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={props.compact ? 0 : 1}
      paddingBottom={props.compact ? 0 : 1}
      flexDirection="row"
      justifyContent="space-between"
      gap={2}
    >
      <box flexDirection="column" flexGrow={1} minWidth={0}>
        <box flexDirection="row" gap={1}>
          <text fg={props.theme.text.base} attributes={TextAttributes.BOLD}>
            {props.agent.name}
          </text>
          <Show when={props.compact}>
            <text
              flexGrow={1}
              fg={props.theme.text.muted}
              overflow="hidden"
              wrapMode="none"
            >
              当前：{props.agent.modelLabel}
            </text>
          </Show>
        </box>
        <Show when={!props.compact}>
          <text
            fg={props.theme.text.muted}
            overflow="hidden"
            wrapMode="none"
          >
            当前模型：{props.agent.modelLabel} · {props.agent.sourceLabel}
          </text>
        </Show>
      </box>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <Badge theme={props.theme} text={roleLabel(props.agent.mode)} tone="neutral" />
        <Badge
          theme={props.theme}
          text={props.agent.statusLabel}
          tone={props.agent.status === "custom" ? "info" : "neutral"}
        />
      </box>
    </box>
  )
}

function SearchBox(props: {
  readonly theme: Theme
  readonly query: string
  readonly focused: boolean
  readonly onFocus: () => void
  readonly onInput: (value: string) => void
  readonly inputRef: (value: InputRenderable) => void
}) {
  return (
    <box
      flexDirection="row"
      gap={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={
        props.focused ? props.theme.background.formfield.focused : props.theme.background.raised.base
      }
      onMouseDown={props.onFocus}
    >
      <text fg={props.focused ? props.theme.text.formfield.focused : props.theme.text.muted}>
        搜索
      </text>
      <input
        flexGrow={1}
        value={props.query}
        onInput={props.onInput}
        placeholder="模型名称 / Provider / ID…"
        placeholderColor={props.theme.text.muted}
        focusedBackgroundColor={props.theme.background.formfield.focused}
        focusedTextColor={props.theme.text.formfield.focused}
        cursorColor={props.theme.text.formfield.focused}
        ref={props.inputRef}
      />
    </box>
  )
}

function ModelList(props: {
  readonly theme: Theme
  readonly groups: readonly { providerID: string; providerName: string; models: readonly ModelInfo[] }[]
  readonly selectedRef: string
  readonly currentBase?: string
  readonly compact: boolean
  readonly onSelect: (ref: string) => void
  readonly onRef: (ref: string, node: Renderable) => void
  readonly onScrollRef: (value: ScrollBoxRenderable) => void
}) {
  return (
    <box flexGrow={1} minWidth={0} minHeight={0}>
      <Show
        when={props.groups.length > 0}
        fallback={
          <box paddingLeft={1} paddingTop={1}>
            <text fg={props.theme.text.muted}>没有匹配的模型。</text>
          </box>
        }
      >
        <scrollbox
          flexGrow={1}
          minHeight={0}
          scrollbarOptions={{ visible: false }}
          ref={props.onScrollRef}
        >
          <For each={props.groups}>
            {(group, index) => (
              <box flexDirection="column">
                <box
                  flexDirection="row"
                  justifyContent="space-between"
                  paddingTop={index() === 0 ? 0 : 1}
                  paddingLeft={1}
                  paddingRight={1}
                >
                  <text fg={props.theme.text.faint} attributes={TextAttributes.BOLD}>
                    {group.providerName.toUpperCase()}
                  </text>
                  <text fg={props.theme.text.faint}>{group.models.length}</text>
                </box>
                <For each={group.models}>
                  {(model) => {
                    const ref = modelRefOf(model)
                    const active = () => ref === props.selectedRef
                    const current = () => ref === props.currentBase
                    return (
                      <box
                        flexDirection="column"
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={
                          active() ? props.theme.background.action.primary.focused : undefined
                        }
                        onMouseUp={() => props.onSelect(ref)}
                        ref={(node: Renderable) => props.onRef(ref, node)}
                      >
                        <box flexDirection="row" gap={1}>
                          <text
                            flexShrink={0}
                            fg={
                              active()
                                ? props.theme.text.action.primary.focused
                                : props.theme.text.faint
                            }
                          >
                            {active() ? "›" : " "}
                          </text>
                          <text
                            flexGrow={1}
                            overflow="hidden"
                            wrapMode="none"
                            fg={
                              active()
                                ? props.theme.text.action.primary.focused
                                : props.theme.text.base
                            }
                            attributes={active() ? TextAttributes.BOLD : undefined}
                          >
                            {model.name || model.id}
                          </text>
                          <Show when={current()}>
                            <text
                              flexShrink={0}
                              fg={
                                active()
                                  ? props.theme.text.action.primary.focused
                                  : props.theme.text.feedback.info.base
                              }
                            >
                              当前
                            </text>
                          </Show>
                        </box>
                        <Show when={!props.compact}>
                          <text
                            paddingLeft={2}
                            overflow="hidden"
                            wrapMode="none"
                            fg={
                              active()
                                ? props.theme.text.action.secondary.focused
                                : props.theme.text.muted
                            }
                          >
                            {ref}
                          </text>
                        </Show>
                      </box>
                    )
                  }}
                </For>
              </box>
            )}
          </For>
        </scrollbox>
      </Show>
    </box>
  )
}

function VariantPane(props: {
  readonly theme: Theme
  readonly model?: ModelInfo
  readonly variants: readonly VariantOption[]
  readonly cursor: number
  readonly pending: string
  readonly focused: boolean
  readonly width?: number
  readonly saving: boolean
  readonly failed: boolean
  readonly onSelect: (index: number) => void
  readonly onRef: (index: number, node: Renderable) => void
  readonly onScrollRef: (value: ScrollBoxRenderable) => void
}) {
  const hasChoices = () => props.variants.length > 1
  return (
    <box
      width={props.width}
      flexGrow={props.width === undefined ? 1 : undefined}
      minHeight={0}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      border={["top", "bottom", "left", "right"]}
      borderColor={
        props.focused ? props.theme.text.action.primary.focused : props.theme.border.base
      }
      backgroundColor={props.theme.background.raised.base}
    >
      <Show
        when={props.model}
        fallback={
          <box paddingTop={1}>
            <text fg={props.theme.text.muted}>从左侧选择模型。</text>
          </box>
        }
      >
        {(model) => (
          <>
            <box paddingTop={1} flexShrink={0}>
              <text fg={props.theme.text.base} attributes={TextAttributes.BOLD} wrapMode="word">
                {model().name || model().id}
              </text>
              <text fg={props.theme.text.faint} wrapMode="none" overflow="hidden">
                {modelRefOf(model())}
              </text>
            </box>
            <BoxDivider theme={props.theme} />
            <text fg={props.theme.text.faint} attributes={TextAttributes.BOLD}>
              推理等级 / Variant
            </text>
            <Show
              when={hasChoices()}
              fallback={
                <text fg={props.theme.text.muted} wrapMode="word">
                  该模型不提供 Variant；保存时只写模型引用。
                </text>
              }
            >
              <scrollbox
                flexGrow={1}
                minHeight={0}
                scrollbarOptions={{ visible: false }}
                ref={props.onScrollRef}
              >
                <For each={props.variants}>
                  {(option, index) => {
                    const active = () => index() === props.cursor
                    return (
                      <box
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={
                          active() ? props.theme.background.action.primary.focused : undefined
                        }
                        onMouseUp={() => props.onSelect(index())}
                        ref={(node: Renderable) => props.onRef(index(), node)}
                      >
                        <text
                          fg={
                            active()
                              ? props.theme.text.action.primary.focused
                              : props.theme.text.base
                          }
                          attributes={active() ? TextAttributes.BOLD : undefined}
                        >
                          {option.label}
                        </text>
                      </box>
                    )
                  }}
                </For>
              </scrollbox>
            </Show>
            <BoxDivider theme={props.theme} />
            <text fg={props.theme.text.muted} wrapMode="word">
              待保存 <span style={{ fg: props.theme.text.base }}>{props.pending}</span>
            </text>
            <Show when={props.saving}>
              <text fg={props.theme.text.feedback.warning.base}>保存中…</text>
            </Show>
            <Show when={props.failed}>
              <text fg={props.theme.text.feedback.error.base}>保存失败，可重试。</text>
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}

function BoxDivider(props: { readonly theme: Theme }) {
  return <box height={1} flexShrink={0} border={["bottom"]} borderColor={props.theme.border.base} />
}

function Foot(props: {
  readonly theme: Theme
  readonly minimal: boolean
  readonly focus: Focus
  readonly saving: boolean
}) {
  const hints = (): Hint[] => {
    if (props.minimal) {
      return [
        { key: "↑↓", label: "选择" },
        { key: "Tab", label: "切换" },
        { key: "Enter", label: props.saving ? "保存中…" : "保存" },
        { key: "Esc", label: "返回" },
      ]
    }
    if (props.focus === "search") {
      return [
        { key: "输入", label: "筛选" },
        { key: "Tab", label: "切换" },
        { key: "Enter", label: props.saving ? "保存中…" : "保存" },
        { key: "Esc", label: "退出搜索" },
      ]
    }
    if (props.focus === "variants") {
      return [
        { key: "↑↓", label: "Variant" },
        { key: "Tab", label: "切换" },
        { key: "Enter", label: props.saving ? "保存中…" : "保存" },
        { key: "R", label: "恢复原生" },
        { key: "Esc", label: "返回" },
      ]
    }
    return [
      { key: "↑↓", label: "模型" },
      { key: "Tab", label: "切换" },
      { key: "Enter", label: props.saving ? "保存中…" : "保存" },
      { key: "/", label: "搜索" },
      { key: "R", label: "恢复原生" },
      { key: "Esc", label: "返回" },
    ]
  }
  return (
    <box
      flexShrink={0}
      border={["top"]}
      borderColor={props.theme.border.base}
      paddingTop={1}
    >
      <Hints theme={props.theme} hints={hints()} />
    </box>
  )
}
