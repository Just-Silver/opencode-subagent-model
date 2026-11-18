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
  firstVisibleRef,
  modelConfigLayoutFor,
  modelGroups,
  modelRefOf,
  nextRegion,
  parseModelRef,
  resolveModel,
  roleLabel,
  variantsFor,
  type ConfigRegion,
  type DashboardAgent,
  type Feedback,
} from "./model.ts"
import type { ModelSelectionResult } from "./team.ts"
import {
  Badge,
  ConfirmBar,
  Divider,
  FeedbackBar,
  Hints,
  providerTitleColor,
  rowBackground,
  rowForeground,
  rowMarker,
  rowSecondary,
  scrollbarOptions,
  selectedRowAccent,
  statusTone,
  type Hint,
  type KeymapLayer,
  type Theme,
} from "./ui.tsx"

type Focus = ConfigRegion

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
  readonly favorites: readonly string[]
  readonly toggleFavorite: (ref: string) => Promise<{ readonly ok: boolean; readonly error?: string }>
  readonly theme: Theme
  readonly layer: (factory: () => KeymapLayer) => void
  readonly feedback?: Feedback
  readonly onClose: () => void
  readonly onSave: (model: string) => Promise<ModelSelectionResult>
  readonly onRestore: () => Promise<ModelSelectionResult>
  readonly notify: (feedback: Feedback) => void
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

  const initialGroups = modelGroups(
    props.models,
    props.providers,
    "",
    props.favorites,
    current()?.baseRef,
  )
  const initialVisible = initialGroups.flatMap((group) => group.models)
  const firstModel = initialVisible[0]
  const initialCurrent = current()
  const initialModel =
    initialCurrent === undefined
      ? firstModel
      : (initialVisible.find((model) => modelRefOf(model) === initialCurrent.baseRef) ?? firstModel)
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
  const [pendingRestore, setPendingRestore] = createSignal(false)
  let disposed = false

  const groups = createMemo(() =>
    modelGroups(props.models, props.providers, query(), props.favorites, current()?.baseRef),
  )
  const flatModels = createMemo(() => groups().flatMap((group) => group.models))
  // 选中项必须仍在过滤后的列表里；搜索无结果时不能继续对旧模型执行保存。
  const selectedModel = createMemo(() =>
    flatModels().find((model) => modelRefOf(model) === selectedRef()),
  )
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
    const next = firstVisibleRef(list, selectedRef())
    if (next !== undefined && next !== selectedRef()) setSelectedRef(next)
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

  createEffect(() => {
    // 当前模型没有 Variant 时，不把焦点留在无法操作的第二栏。
    if (focus() === "variants" && variants().length === 0) setFocus("models")
  })

  createEffect(on(selectedRef, (ref) => ensureModelVisible(ref)))
  createEffect(on(query, () => ensureModelVisible(selectedRef())))
  createEffect(on(variantCursor, (index) => ensureVariantVisible(index)))
  // 收藏切换会把选中行移到 FAVORITES 或移回 Provider 组；选中项没变，但位置可能已在视口外。
  createEffect(
    on(
      () => props.favorites,
      (next, prev) => {
        if (
          prev !== undefined &&
          next.length === prev.length &&
          next.every((ref, index) => ref === prev[index])
        ) {
          return
        }
        ensureModelVisible(selectedRef())
      },
      { defer: true },
    ),
  )
  onCleanup(() => {
    disposed = true
    if (focusTimer !== undefined) clearTimeout(focusTimer)
    if (scrollTimer !== undefined) clearTimeout(scrollTimer)
  })

  /** 搜索框始终保持焦点，输入即过滤，与 /model 一致；确认恢复时临时失焦。 */
  function focusSearchInput(): void {
    if (searchInput === undefined || searchInput.isDestroyed) return
    searchInput.focus()
    searchInput.cursorOffset = searchInput.value.length
  }

  function scheduleFocusSearch(): void {
    if (focusTimer !== undefined) clearTimeout(focusTimer)
    focusTimer = setTimeout(focusSearchInput, 1)
  }

  function ensureModelVisible(ref: string): void {
    ensureVisible(modelScroll, () => modelNodes.get(ref))
  }

  function ensureVariantVisible(index: number): void {
    ensureVisible(variantScroll, () => variantNodes.get(index))
  }

  // 分组重算会销毁并重建行节点，调用时捕获的 node 到定时器触发时已失效；必须惰性查找。
  // 首次挂载时滚动容器与行节点都比 effect 晚就绪，因此缺节点或高度未布局时有限重试。
  const VISIBLE_RETRIES = 5
  function ensureVisible(
    scroll: ScrollBoxRenderable | undefined,
    nodeOf: () => Renderable | undefined,
  ): void {
    if (scroll === undefined || scroll.isDestroyed) return
    if (scrollTimer !== undefined) clearTimeout(scrollTimer)
    const attempt = (retries: number): void => {
      scrollTimer = setTimeout(
        () => {
          if (scroll.isDestroyed) return
          if (scroll.height <= 0) {
            if (retries > 0) attempt(retries - 1)
            return
          }
          const node = nodeOf()
          if (node === undefined || node.isDestroyed) {
            if (retries > 0) attempt(retries - 1)
            return
          }
          const top = node.y - scroll.y
          if (top < 0) scroll.scrollBy(top - 1)
          else if (top + node.height > scroll.height) {
            scroll.scrollBy(top + node.height - scroll.height + 1)
          }
        },
        retries === VISIBLE_RETRIES ? 0 : 16,
      )
    }
    attempt(VISIBLE_RETRIES)
  }

  function cycleRegion(): void {
    setFocus(nextRegion(focus(), variants().length > 0))
  }

  function focusModels(): void {
    setFocus("models")
  }

  function focusVariants(): void {
    if (variants().length > 0) setFocus("variants")
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

  function enter(): void {
    if (pendingRestore()) {
      void restore()
      return
    }
    // 有 Variant 时，先在模型列表按 Enter 进入思考等级面板，确认等级后再保存。
    if (focus() === "models" && variants().length > 0) {
      setFocus("variants")
      return
    }
    void save()
  }

  async function save(): Promise<void> {
    if (saving() || pendingRestore()) return
    const model = selectedModel()
    if (model === undefined) {
      props.notify({
        tone: "warning",
        message: query().trim() !== "" ? "没有匹配的模型，无法保存。" : "请选择一个模型。",
      })
      return
    }
    setSaving(true)
    setSaveFailed(false)
    props.notify({ tone: "info", message: "正在保存模型配置…" })
    if (searchInput !== undefined && !searchInput.isDestroyed) searchInput.blur()
    try {
      const result = await props.onSave(buildModelRef(selectedRef(), variant()))
      if (disposed) return
      setSaving(false)
      if (result.saved) {
        setSaveFailed(false)
        scheduleFocusSearch()
      } else {
        setSaveFailed(true)
        scheduleFocusSearch()
      }
    } catch (error) {
      if (disposed) return
      setSaving(false)
      setSaveFailed(true)
      scheduleFocusSearch()
      props.notify({
        tone: "error",
        message: `保存模型失败：${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  function requestRestore(): void {
    if (saving() || pendingRestore()) return
    if (props.currentOverride === undefined) {
      props.notify({
        tone: "info",
        message: `${props.agent.name} 没有团队模型覆盖，无需恢复。`,
      })
      return
    }
    setSaveFailed(false)
    setPendingRestore(true)
    if (searchInput !== undefined && !searchInput.isDestroyed) searchInput.blur()
  }

  async function restore(): Promise<void> {
    if (saving()) return
    setPendingRestore(false)
    setSaving(true)
    setSaveFailed(false)
    props.notify({ tone: "info", message: "正在恢复原生模型选择…" })
    try {
      const result = await props.onRestore()
      if (disposed) return
      setSaving(false)
      if (result.saved) {
        setSaveFailed(false)
        scheduleFocusSearch()
      } else {
        setSaveFailed(true)
        scheduleFocusSearch()
      }
    } catch (error) {
      if (disposed) return
      setSaving(false)
      setSaveFailed(true)
      scheduleFocusSearch()
      props.notify({
        tone: "error",
        message: `恢复原生模型失败：${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  let toggling = false

  async function toggleFavoriteCurrent(): Promise<void> {
    if (toggling || saving() || pendingRestore()) return
    const model = selectedModel()
    if (model === undefined) {
      props.notify({
        tone: "warning",
        message: query().trim() !== "" ? "没有匹配的模型，无法收藏。" : "请选择一个模型。",
      })
      return
    }
    const ref = modelRefOf(model)
    const wasFavorite = props.favorites.includes(ref)
    toggling = true
    try {
      const result = await props.toggleFavorite(ref)
      if (disposed) return
      props.notify(
        result.ok
          ? {
              tone: "success",
              message: wasFavorite
                ? `已取消收藏 ${model.name || model.id}`
                : `已收藏 ${model.name || model.id}`,
            }
          : {
              tone: "error",
              message: `收藏操作失败：${result.error ?? "未知错误"}`,
            },
      )
    } catch (error) {
      if (disposed) return
      props.notify({
        tone: "error",
        message: `收藏操作失败：${error instanceof Error ? error.message : String(error)}`,
      })
    } finally {
      toggling = false
      scheduleFocusSearch()
    }
  }

  function escape(): void {
    if (saving()) return
    if (pendingRestore()) {
      setPendingRestore(false)
      scheduleFocusSearch()
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
        enabled: () => !pendingRestore(),
        run: () => {
          if (focus() === "variants") moveVariant(-1)
          else moveModel(-1)
        },
      },
      {
        id: "opencode-team.model.down",
        bind: "down",
        enabled: () => !pendingRestore(),
        run: () => {
          if (focus() === "variants") moveVariant(1)
          else moveModel(1)
        },
      },
      {
        id: "opencode-team.model.tab",
        bind: "tab",
        enabled: () => !pendingRestore(),
        run: () => cycleRegion(),
      },
      {
        id: "opencode-team.model.shift_tab",
        bind: "shift+tab",
        enabled: () => !pendingRestore(),
        run: () => cycleRegion(),
      },
      {
        id: "opencode-team.model.left",
        bind: "left",
        enabled: () => !pendingRestore(),
        run: focusModels,
      },
      {
        id: "opencode-team.model.right",
        bind: "right",
        enabled: () => !pendingRestore(),
        run: focusVariants,
      },
      {
        id: "opencode-team.model.enter",
        bind: "enter",
        run: enter,
      },
      {
        id: "opencode-team.model.restore",
        bind: "ctrl+r",
        enabled: () => !pendingRestore(),
        run: requestRestore,
      },
      {
        id: "opencode-team.model.favorite",
        bind: "ctrl+f",
        enabled: () => !pendingRestore() && !saving(),
        run: () => void toggleFavoriteCurrent(),
      },
      {
        id: "opencode-team.model.home",
        bind: "home",
        enabled: () => !pendingRestore(),
        run: first,
      },
      {
        id: "opencode-team.model.end",
        bind: "end",
        enabled: () => !pendingRestore(),
        run: last,
      },
      {
        id: "opencode-team.model.page_up",
        bind: "pageup",
        enabled: () => !pendingRestore(),
        run: () => page(-1),
      },
      {
        id: "opencode-team.model.page_down",
        bind: "pagedown",
        enabled: () => !pendingRestore(),
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
  const showModels = () => split() || focus() !== "variants"
  const showVariants = () => split() || focus() === "variants"

  return (
    <box flexGrow={1} minHeight={0} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between" gap={2} flexShrink={0}>
        <box flexDirection="row" gap={1}>
          <text fg={theme().text.base} attributes={TextAttributes.BOLD}>
            Agent Team
          </text>
          <text fg={theme().text.muted}>›</text>
          <text fg={theme().text.base}>模型配置</text>
        </box>
        <text fg={theme().text.muted}>
          {pendingRestore() ? "ESC 取消" : "ESC 返回"}
        </text>
      </box>

      <box paddingTop={1} flexShrink={0}>
        <AgentCard theme={theme()} agent={props.agent} compact={layout().compact} />
      </box>

      <box paddingTop={1} flexShrink={0}>
        <SearchBox
          theme={theme()}
          query={query()}
          focused={!pendingRestore()}
          onFocus={() => {
            if (!pendingRestore()) focusSearchInput()
          }}
          onInput={(value) => {
            setQuery(value)
            if (focus() === "variants") setFocus("models")
          }}
          inputRef={(value) => {
            searchInput = value
            scheduleFocusSearch()
          }}
        />
      </box>

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
              if (pendingRestore()) return
              setSelectedRef(ref)
              setFocus("models")
            }}
            onRef={(ref, node) => modelNodes.set(ref, node)}
            onScrollRef={(value) => {
              modelScroll = value
              ensureModelVisible(selectedRef())
            }}
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
            empty={flatModels().length === 0}
            width={split() ? layout().variantWidth : undefined}
            saving={saving()}
            failed={saveFailed()}
            onSelect={(index) => {
              if (pendingRestore()) return
              setVariantAt(index)
              setFocus("variants")
            }}
            onRef={(index, node) => variantNodes.set(index, node)}
            onScrollRef={(value) => {
              variantScroll = value
              ensureVariantVisible(variantCursor())
            }}
          />
        </Show>
      </box>

      <Show when={pendingRestore()}>
        <ConfirmBar
          theme={theme()}
          message={
            props.agent.hostModel === undefined
              ? `清除 ${props.agent.name} 的团队模型覆盖并恢复 OpenCode 原生选择？`
              : `清除 ${props.agent.name} 的团队模型覆盖，回到 Agent 配置的 ${props.agent.hostModel}？`
          }
        />
      </Show>
      <Show when={props.feedback}>
        {(value) => <FeedbackBar theme={theme()} feedback={value()} />}
      </Show>

      <Foot
        theme={theme()}
        minimal={layout().minimal}
        focus={focus()}
        saving={saving()}
        confirming={pendingRestore()}
        hasVariants={variants().length > 0}
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
      backgroundColor={props.theme.background.raised.high}
      border={["left"]}
      borderColor={selectedRowAccent(props.theme)}
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
            <text flexGrow={1} overflow="hidden" wrapMode="none">
              <span style={{ fg: props.theme.text.muted }}>当前：</span><span style={{ fg: props.theme.text.base }}>{props.agent.modelLabel}</span>
            </text>
          </Show>
        </box>
        <Show when={!props.compact}>
          <text overflow="hidden" wrapMode="none">
            <span style={{ fg: props.theme.text.muted }}>当前模型：</span><span style={{ fg: props.theme.text.base }}>{props.agent.modelLabel}</span><span style={{ fg: props.theme.text.muted }}> · {props.agent.sourceLabel}</span>
          </text>
        </Show>
      </box>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <Badge theme={props.theme} text={roleLabel(props.agent.mode)} tone="neutral" />
        <Badge
          theme={props.theme}
          text={props.agent.statusLabel}
          tone={statusTone(props.agent.status)}
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
        placeholder="输入以搜索模型 / Provider / ID…"
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
          verticalScrollbarOptions={scrollbarOptions(props.theme)}
          horizontalScrollbarOptions={{ visible: false }}
          ref={props.onScrollRef}
        >
          <For each={props.groups}>
            {(group, index) => (
              <box flexDirection="column">
                <Show when={index() > 0}>
                  <box paddingTop={1}>
                    <Divider theme={props.theme} />
                  </box>
                </Show>
                <box
                  flexDirection="row"
                  justifyContent="space-between"
                  gap={2}
                  paddingLeft={1}
                  paddingRight={1}
                >
                  <text
                    flexGrow={1}
                    overflow="hidden"
                    wrapMode="none"
                    fg={providerTitleColor(props.theme)}
                    attributes={TextAttributes.BOLD}
                  >
                    {group.providerName.toUpperCase()}
                  </text>
                  <text flexShrink={0} fg={props.theme.text.muted}>
                    {group.models.length}
                  </text>
                </box>
                <For each={group.models}>
                  {(model) => {
                    const ref = modelRefOf(model)
                    const active = () => ref === props.selectedRef
                    const current = () => ref === props.currentBase
                    return (
                      <box
                        flexDirection="column"
                        paddingLeft={2}
                        paddingRight={1}
                        backgroundColor={rowBackground(props.theme, active())}
                        onMouseUp={() => props.onSelect(ref)}
                        ref={(node: Renderable) => props.onRef(ref, node)}
                      >
                        <box flexDirection="row" gap={1}>
                          <text
                            flexShrink={0}
                            fg={rowMarker(props.theme, active())}
                          >
                            {active() ? "▌" : " "}
                          </text>
                          <text
                            flexGrow={1}
                            overflow="hidden"
                            wrapMode="none"
                            fg={rowForeground(props.theme)}
                            attributes={active() ? TextAttributes.BOLD : undefined}
                          >
                            {model.name || model.id}
                          </text>
                          <Show when={current()}>
                            <text
                              flexShrink={0}
                              fg={selectedRowAccent(props.theme)}
                            >
                              当前
                            </text>
                          </Show>
                        </box>
                        <Show when={!props.compact}>
                          <text
                            paddingLeft={2}
                            wrapMode="word"
                            fg={rowSecondary(props.theme, active())}
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
  readonly empty: boolean
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
      border={["left"]}
      borderColor={
        props.focused ? selectedRowAccent(props.theme) : props.theme.border.base
      }
      backgroundColor={props.theme.background.raised.base}
    >
      <Show
        when={props.model}
        fallback={
          <box paddingTop={1}>
            <text fg={props.theme.text.muted}>
              {props.empty ? "没有匹配的模型。" : "从左侧选择模型。"}
            </text>
          </box>
        }
      >
        {(model) => (
          <>
            <box flexShrink={0}>
              <text fg={props.theme.text.base} attributes={TextAttributes.BOLD} wrapMode="word">
                {model().name || model().id}
              </text>
              <text fg={props.theme.text.muted} wrapMode="none" overflow="hidden">
                {modelRefOf(model())}
              </text>
            </box>
            <Divider theme={props.theme} />
            <text fg={props.theme.text.muted} attributes={TextAttributes.BOLD}>
              思考等级 / Variant
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
                verticalScrollbarOptions={scrollbarOptions(props.theme)}
                horizontalScrollbarOptions={{ visible: false }}
                ref={props.onScrollRef}
              >
                <For each={props.variants}>
                  {(option, index) => {
                    const active = () => index() === props.cursor
                    return (
                      <box
                        flexDirection="row"
                        gap={1}
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={rowBackground(props.theme, active())}
                        onMouseUp={() => props.onSelect(index())}
                        ref={(node: Renderable) => props.onRef(index(), node)}
                      >
                        <text
                          flexShrink={0}
                          fg={rowMarker(props.theme, active())}
                        >
                          {active() ? "▌" : " "}
                        </text>
                        <text
                          flexGrow={1}
                          overflow="hidden"
                          wrapMode="none"
                          fg={rowForeground(props.theme)}
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
            <Divider theme={props.theme} />
            <text fg={props.theme.text.muted} wrapMode="word">
              待保存 <span style={{ fg: props.theme.text.base }}>{props.pending}</span>
            </text>
            <Show when={props.saving}>
              <text fg={props.theme.text.feedback.warning.base}>处理中…</text>
            </Show>
            <Show when={props.failed}>
              <text fg={props.theme.text.feedback.error.base}>操作失败，可重试。</text>
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}

function Foot(props: {
  readonly theme: Theme
  readonly minimal: boolean
  readonly focus: Focus
  readonly saving: boolean
  readonly confirming: boolean
  readonly hasVariants: boolean
}) {
  const enterLabel = () => {
    if (props.saving) return "处理中…"
    if (props.confirming) return "确认"
    if (props.focus === "models" && props.hasVariants) return "思考等级"
    return "保存"
  }
  const hints = (): Hint[] => {
    if (props.confirming) {
      return [
        { key: "Enter", label: "确认" },
        { key: "ESC", label: "取消" },
      ]
    }
    if (props.minimal) {
      return [
        { key: "↑↓", label: "选择" },
        { key: "←→", label: "切换" },
        { key: "输入", label: "搜索" },
        { key: "Enter", label: enterLabel() },
        { key: "ESC", label: "返回" },
      ]
    }
    if (props.focus === "variants") {
      return [
        { key: "↑↓", label: "思考等级" },
        { key: "←→", label: "切换" },
        { key: "输入", label: "搜索" },
        { key: "Enter", label: enterLabel() },
        { key: "Ctrl+F", label: "收藏" },
        { key: "Ctrl+R", label: "恢复原生" },
        { key: "ESC", label: "返回" },
      ]
    }
    return [
      { key: "↑↓", label: "模型" },
      { key: "←→", label: "切换" },
      { key: "输入", label: "搜索" },
      { key: "Enter", label: enterLabel() },
      { key: "Ctrl+F", label: "收藏" },
      { key: "Ctrl+R", label: "恢复原生" },
      { key: "ESC", label: "返回" },
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
