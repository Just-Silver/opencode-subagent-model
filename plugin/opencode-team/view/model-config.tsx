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
  clipModelName,
  clipText,
  displayWidth,
  firstVisibleRef,
  formatContextWindow,
  formatModelPrice,
  modelConfigLayoutFor,
  modelGroups,
  modelRefOf,
  nextRegion,
  parseModelRef,
  providerLabel,
  resolveModel,
  roleLabel,
  selectionState,
  variantForSelection,
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
  GroupHeader,
  Hints,
  Legend,
  panelRowBackground,
  panelRowMarker,
  rowForeground,
  rowSecondary,
  scrollbarOptions,
  SearchBar,
  selectedRowAccent,
  ViewHeader,
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
  const [dirty, setDirty] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [focus, setFocus] = createSignal<Focus>("models")
  const [saving, setSaving] = createSignal(false)
  const [saveFailed, setSaveFailed] = createSignal(false)
  const [action, setAction] = createSignal<"save" | "restore">("save")
  const [searchFocused, setSearchFocused] = createSignal(true)
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

  const currentBase = () => current()?.baseRef
  const selection = createMemo(() =>
    selectionState({
      ...(currentBase() === undefined ? {} : { currentBase: currentBase()! }),
      ...(current()?.variant === undefined ? {} : { currentVariant: current()!.variant! }),
      selectedRef: selectedRef(),
      ...(variant() === undefined ? {} : { variant: variant()! }),
      dirty: dirty(),
    }),
  )
  const hasCurrent = () => selection().hasCurrent
  const modelIsCurrent = () => hasCurrent() && selectedRef() === currentBase()
  const pending = () => selection().pending
  const differs = () => selection().modelChanged || selection().variantChanged
  const currentVariantLabel = () => current()?.variant ?? "默认"

  const pendingLabel = () => {
    const model = selectedModel()
    if (model === undefined) return "-"
    return variant() === undefined ? `${model.name} · 默认` : `${model.name} · ${variant()}`
  }

  const listWidth = () =>
    layout().split
      ? layout().contentWidth - 1 - layout().variantWidth
      : layout().contentWidth
  const listContentWidth = () => listWidth() - 2

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
    if (next !== undefined && next !== selectedRef()) {
      // 搜索过滤导致原选择不可见时的自动落点不是用户选择，不应继承待保存标记。
      setSelectedRef(next)
      setDirty(false)
    }
  })

  createEffect(
    on(
      selectedRef,
      (ref) => {
        const model = resolveModel(props.models, ref)
        const currentValue = current()
        const next = variantForSelection(
          model,
          currentValue?.baseRef,
          currentValue?.variant,
          ref,
        )
        setVariant(next)
        setVariantCursor(next === undefined ? 0 : variantsFor(model).indexOf(next) + 1)
        setSaveFailed(false)
      },
      { defer: true },
    ),
  )

  createEffect(on(selectedRef, (ref) => ensureModelVisible(ref)))
  createEffect(
    on(selectedRef, () => {
      if (variantScroll !== undefined && !variantScroll.isDestroyed) variantScroll.scrollTo(0)
    }),
  )
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
    setSearchFocused(true)
  }

  function blurSearchInput(): void {
    if (searchInput !== undefined && !searchInput.isDestroyed) searchInput.blur()
    setSearchFocused(false)
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
    setFocus(nextRegion(focus()))
  }

  function focusModels(): void {
    setFocus("models")
  }

  function focusVariants(): void {
    setFocus("variants")
  }

  /** 保存/恢复后当前值可能在同一基础模型下换了 Variant，需要回填本地选择。 */
  function syncVariantToCurrent(): void {
    const value = current()
    if (value?.baseRef !== selectedRef()) return
    const model = resolveModel(props.models, selectedRef())
    const next = variantForSelection(model, value.baseRef, value.variant, selectedRef())
    setVariant(next)
    setVariantCursor(next === undefined ? 0 : variantsFor(model).indexOf(next) + 1)
  }

  function selectModel(ref: string): void {
    if (ref !== selectedRef()) setDirty(true)
    setSelectedRef(ref)
  }

  function moveModel(delta: number): void {
    const list = flatModels()
    if (list.length === 0) return
    const index = list.findIndex((model) => modelRefOf(model) === selectedRef())
    const next = index < 0 ? 0 : (index + delta + list.length) % list.length
    selectModel(modelRefOf(list[next]!))
  }

  function setVariantAt(index: number): void {
    const rows = variantRows()
    const row = rows[index]
    if (row === undefined) return
    setVariantCursor(index)
    if (row.id !== variant()) setDirty(true)
    setVariant(row.id)
    setSaveFailed(false)
    ensureVariantVisible(index)
  }

  function moveVariant(delta: number): void {
    // 无 Variant 时右侧是只读详情；↑↓ 继续在模型间移动，避免焦点卡住。
    if (variants().length === 0) {
      moveModel(delta)
      return
    }
    const rows = variantRows()
    const next = (variantCursor() + delta + rows.length) % rows.length
    setVariantAt(next)
  }

  function first(): void {
    if (focus() === "variants" && variants().length > 0) setVariantAt(0)
    else {
      const list = flatModels()
      if (list.length > 0) selectModel(modelRefOf(list[0]!))
    }
  }

  function last(): void {
    if (focus() === "variants" && variants().length > 0) setVariantAt(variantRows().length - 1)
    else {
      const list = flatModels()
      if (list.length > 0) selectModel(modelRefOf(list[list.length - 1]!))
    }
  }

  function page(delta: number): void {
    if (focus() === "variants" && variants().length > 0) {
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
    // 单栏时先进入右侧查看模型信息/Variant；双栏有 Variant 时也先聚焦 Variant。
    if (focus() === "models" && (!split() || variants().length > 0)) {
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
    setAction("save")
    props.notify({ tone: "info", message: "正在保存模型配置…" })
    blurSearchInput()
    try {
      const result = await props.onSave(buildModelRef(selectedRef(), variant()))
      if (disposed) return
      setSaving(false)
      if (result.saved) {
        setSaveFailed(false)
        setDirty(false)
        syncVariantToCurrent()
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
    blurSearchInput()
  }

  async function restore(): Promise<void> {
    if (saving()) return
    setPendingRestore(false)
    setSaving(true)
    setSaveFailed(false)
    setAction("restore")
    props.notify({ tone: "info", message: "正在恢复原生模型选择…" })
    try {
      const result = await props.onRestore()
      if (disposed) return
      setSaving(false)
      if (result.saved) {
        setSaveFailed(false)
        setDirty(false)
        syncVariantToCurrent()
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
      <ViewHeader
        theme={theme()}
        section="模型配置"
        right={pendingRestore() ? "ESC 取消" : "ESC 返回"}
      />

      <Show when={!layout().minimal}>
        <box paddingTop={layout().dense ? 0 : 1} flexShrink={0}>
          <AgentCard
            theme={theme()}
            agent={props.agent}
            compact={layout().compact || layout().dense}
          />
        </box>
      </Show>

      <box paddingTop={layout().minimal || layout().dense ? 0 : 1} flexShrink={0}>
        <SearchBar
          theme={theme()}
          value={query()}
          focused={searchFocused() && !pendingRestore()}
          placeholder="模型 / Provider / ID…"
          right={`共 ${flatModels().length} 个模型`}
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

      <box flexGrow={1} minHeight={0} paddingTop={layout().dense ? 0 : 1} flexDirection="row">
        <Show when={showModels()}>
          <box
            width={split() ? listWidth() : undefined}
            flexGrow={split() ? undefined : 1}
            flexShrink={0}
            minWidth={0}
            minHeight={0}
            flexDirection="column"
            border={true}
            borderStyle="rounded"
            borderColor={
              focus() === "models" ? selectedRowAccent(theme()) : theme().border.base
            }
            backgroundColor={
              focus() === "models"
                ? theme().background.raised.base
                : theme().background.base
            }
            title={focus() === "models" ? "› 模型列表" : "模型列表"}
            titleColor={
              focus() === "models" ? selectedRowAccent(theme()) : theme().text.muted
            }
          >
            <ModelList
              theme={theme()}
              groups={groups()}
              providers={props.providers}
              selectedRef={selectedRef()}
              currentBase={currentBase()}
              pending={pending()}
              focused={focus() === "models"}
              width={listContentWidth()}
              onSelect={(ref) => {
                if (pendingRestore()) return
                selectModel(ref)
                setFocus("models")
              }}
              onRef={(ref, node) => modelNodes.set(ref, node)}
              onScrollRef={(value) => {
                modelScroll = value
                ensureModelVisible(selectedRef())
              }}
            />
          </box>
        </Show>
        <Show when={split()}>
          <box width={1} flexShrink={0} />
        </Show>
        <Show when={showVariants()}>
          <VariantPane
            theme={theme()}
            model={selectedModel()}
            variants={variantRows()}
            cursor={variantCursor()}
            variant={variant()}
            currentVariant={current()?.variant}
            modelIsCurrent={modelIsCurrent()}
            hasCurrent={hasCurrent()}
            pending={pending()}
            differs={differs()}
            pendingLabel={pendingLabel()}
            currentLabel={currentVariantLabel()}
            currentModelLabel={props.agent.modelLabel}
            focused={focus() === "variants"}
            empty={flatModels().length === 0}
            width={split() ? layout().variantWidth : undefined}
            saving={saving()}
            failed={saveFailed()}
            action={action()}
            canRestore={props.currentOverride !== undefined}
            tight={layout().dense}
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
        dense={layout().dense}
        wide={layout().contentWidth >= 106}
        split={layout().split}
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
      backgroundColor={props.theme.background.raised.base}
      border={["left"]}
      borderColor={selectedRowAccent(props.theme)}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={props.compact ? 0 : 1}
      paddingBottom={props.compact ? 0 : 1}
      flexDirection="column"
    >
      <box flexDirection="row" justifyContent="space-between" gap={2}>
        <text
          flexGrow={1}
          overflow="hidden"
          wrapMode="none"
          fg={props.theme.text.base}
          attributes={TextAttributes.BOLD}
        >
          {props.agent.name}
        </text>
        <box flexDirection="row" gap={1} flexShrink={0}>
          <Badge theme={props.theme} text={roleLabel(props.agent.mode)} tone="neutral" />
          <Badge
            theme={props.theme}
            text={props.agent.configBadge}
            tone={props.agent.configTone}
          />
        </box>
      </box>
      <text overflow="hidden" wrapMode="none">
        <span style={{ fg: props.theme.text.muted }}>当前：</span>
        <span style={{ fg: props.theme.text.base }}>{props.agent.modelLabel}</span>
        <span style={{ fg: props.theme.text.muted }}> · {props.agent.sourceLabel}</span>
      </text>
    </box>
  )
}

function ModelList(props: {
  readonly theme: Theme
  readonly groups: readonly { providerID: string; providerName: string; models: readonly ModelInfo[]; favoriteGroup?: boolean }[]
  readonly providers: readonly ProviderInfo[]
  readonly selectedRef: string
  readonly currentBase?: string
  readonly pending: boolean
  readonly focused: boolean
  readonly width: number
  readonly onSelect: (ref: string) => void
  readonly onRef: (ref: string, node: Renderable) => void
  readonly onScrollRef: (value: ScrollBoxRenderable) => void
}) {
  const providerOf = (model: ModelInfo, group: { favoriteGroup?: boolean }) =>
    group.favoriteGroup === true
      ? clipText(providerLabel(props.providers, model.providerID), 14)
      : undefined

  const stateOf = (ref: string) => {
    if (ref === props.currentBase) return { text: "当前", color: selectedRowAccent(props.theme) }
    if (ref === props.selectedRef && props.pending) {
      return { text: "待保存", color: props.theme.text.feedback.warning.base }
    }
    return undefined
  }

  const nameWidth = (model: ModelInfo, group: { favoriteGroup?: boolean }) => {
    const provider = providerOf(model, group)
    const state = stateOf(modelRefOf(model))
    let used = 0
    if (provider !== undefined) used += 1 + displayWidth(provider)
    if (state !== undefined) used += 1 + displayWidth(state.text)
    return Math.max(6, props.width - 5 - used)
  }

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
                  <box height={1} />
                </Show>
                <GroupHeader
                  theme={props.theme}
                  title={group.favoriteGroup === true ? "FAVORITES" : group.providerName.toUpperCase()}
                  count={group.models.length}
                  accent
                />
                <For each={group.models}>
                  {(model) => {
                    const ref = modelRefOf(model)
                    const active = () => ref === props.selectedRef
                    const state = () => stateOf(ref)
                    const provider = () => providerOf(model, group)
                    return (
                      <box
                        flexDirection="row"
                        gap={1}
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={panelRowBackground(
                          props.theme,
                          active(),
                          props.focused,
                        )}
                        onMouseUp={() => props.onSelect(ref)}
                        ref={(node: Renderable) => props.onRef(ref, node)}
                      >
                        <text
                          flexShrink={0}
                          fg={panelRowMarker(props.theme, active(), props.focused)}
                        >
                          {active() ? "|" : " "}
                        </text>
                        <text
                          flexGrow={1}
                          overflow="hidden"
                          wrapMode="none"
                          fg={rowForeground(props.theme)}
                          attributes={
                            active() && props.focused ? TextAttributes.BOLD : undefined
                          }
                        >
                          {clipModelName(model.name || model.id, nameWidth(model, group))}
                        </text>
                        <Show when={provider()}>
                          {(value) => (
                            <text flexShrink={0} fg={rowSecondary(props.theme, active())}>
                              {value()}
                            </text>
                          )}
                        </Show>
                        <Show when={state()}>
                          {(value) => (
                            <text flexShrink={0} fg={value().color}>
                              {value().text}
                            </text>
                          )}
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
  readonly variant?: string
  readonly currentVariant?: string
  readonly modelIsCurrent: boolean
  readonly hasCurrent: boolean
  readonly pending: boolean
  readonly differs: boolean
  readonly pendingLabel: string
  readonly currentLabel: string
  readonly currentModelLabel: string
  readonly focused: boolean
  readonly empty: boolean
  readonly width?: number
  readonly saving: boolean
  readonly failed: boolean
  readonly action: "save" | "restore"
  readonly canRestore: boolean
  readonly tight: boolean
  readonly onSelect: (index: number) => void
  readonly onRef: (index: number, node: Renderable) => void
  readonly onScrollRef: (value: ScrollBoxRenderable) => void
}) {
  const hasChoices = () => props.variants.length > 1
  const price = () => formatModelPrice(props.model)

  const currentState = (option: VariantOption) =>
    props.modelIsCurrent && (option.id ?? undefined) === (props.currentVariant ?? undefined)

  const pendingState = (option: VariantOption) =>
    props.pending &&
    (option.id ?? undefined) === (props.variant ?? undefined) &&
    !currentState(option)

  return (
    <box
      width={props.width}
      flexGrow={props.width === undefined ? 1 : undefined}
      minHeight={0}
      flexDirection="column"
      border={true}
      borderStyle="rounded"
      borderColor={
        props.focused ? selectedRowAccent(props.theme) : props.theme.border.base
      }
      backgroundColor={
        props.focused ? props.theme.background.raised.base : props.theme.background.base
      }
      title={props.focused ? "› 思考等级" : "思考等级"}
      titleColor={
        props.focused ? selectedRowAccent(props.theme) : props.theme.text.muted
      }
    >
      <Show
        when={props.model}
        fallback={
          <box paddingLeft={1} paddingTop={1}>
            <text fg={props.theme.text.muted}>
              {props.empty ? "没有匹配的模型。" : "从左侧选择模型。"}
            </text>
          </box>
        }
      >
        {(model) => (
          <scrollbox
            flexGrow={1}
            minHeight={0}
            verticalScrollbarOptions={scrollbarOptions(props.theme)}
            horizontalScrollbarOptions={{ visible: false }}
            ref={props.onScrollRef}
          >
            <box flexDirection="column" paddingLeft={1} paddingRight={1}>
              <box flexShrink={0} flexDirection="column">
                <text
                  fg={props.focused ? props.theme.text.base : props.theme.text.muted}
                  attributes={props.focused ? TextAttributes.BOLD : undefined}
                  wrapMode="word"
                >
                  {model().name || model().id}
                </text>
                <text fg={props.theme.text.muted} wrapMode="char">
                  {modelRefOf(model())}
                </text>
                <Show when={!props.tight}>
                  <text fg={props.theme.text.muted} wrapMode="word">
                    上下文 {formatContextWindow(model().limit?.context ?? 0)}
                  </text>
                  <Show when={price()}>
                    {(value) => (
                      <text fg={props.theme.text.muted} wrapMode="word">
                        {value()}
                      </text>
                    )}
                  </Show>
                </Show>
              </box>

              <Divider theme={props.theme} />

              <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
                <text fg={props.theme.text.muted} attributes={TextAttributes.BOLD}>
                  Variant
                </text>
                <text
                  flexShrink={0}
                  fg={
                    props.modelIsCurrent
                      ? selectedRowAccent(props.theme)
                      : props.theme.text.muted
                  }
                >
                  {props.modelIsCurrent
                    ? `当前 ${props.currentLabel}`
                    : props.hasCurrent
                      ? "未生效"
                      : "未设置"}
                </text>
              </box>

              <Show
                when={hasChoices()}
                fallback={
                  <text fg={props.theme.text.muted} wrapMode="word">
                    该模型不提供 Variant；保存时只写模型引用。
                  </text>
                }
              >
                <box flexDirection="column">
                  <For each={props.variants}>
                    {(option, index) => {
                      const active = () => index() === props.cursor
                      const current = () => currentState(option)
                      const pending = () => pendingState(option)
                      return (
                        <box
                          flexDirection="row"
                          gap={1}
                          paddingLeft={1}
                          paddingRight={1}
                          backgroundColor={panelRowBackground(
                            props.theme,
                            active(),
                            props.focused,
                          )}
                          onMouseUp={() => props.onSelect(index())}
                          ref={(node: Renderable) => props.onRef(index(), node)}
                        >
                          <text
                            flexShrink={0}
                            fg={panelRowMarker(props.theme, active(), props.focused)}
                          >
                            {active() ? "|" : " "}
                          </text>
                          <text
                            flexGrow={1}
                            overflow="hidden"
                            wrapMode="none"
                            fg={rowForeground(props.theme)}
                            attributes={
                              active() && props.focused ? TextAttributes.BOLD : undefined
                            }
                          >
                            {option.label}
                          </text>
                          <Show when={current() || pending()}>
                            <text
                              flexShrink={0}
                              fg={
                                current()
                                  ? selectedRowAccent(props.theme)
                                  : props.theme.text.feedback.warning.base
                              }
                            >
                              {current() ? "当前" : "待保存"}
                            </text>
                          </Show>
                        </box>
                      )
                    }}
                  </For>
                </box>
              </Show>

              <Divider theme={props.theme} />
              <text
                fg={
                  props.pending || !props.hasCurrent
                    ? props.theme.text.feedback.warning.base
                    : props.theme.text.muted
                }
                attributes={TextAttributes.BOLD}
              >
                {props.pending
                  ? "待应用"
                  : !props.hasCurrent
                    ? "未设置覆盖"
                    : props.differs
                      ? "当前生效"
                      : "当前配置"}
              </text>
              <text fg={props.theme.text.base} wrapMode="word">
                {props.pending
                  ? props.pendingLabel
                  : !props.hasCurrent
                    ? "选择模型后按 Enter 保存"
                    : props.differs
                      ? props.currentModelLabel
                      : "已与当前生效配置一致"}
              </text>
              <Show when={props.pending || !props.hasCurrent || props.differs}>
                <text fg={props.theme.text.muted} wrapMode="word">
                  Enter 保存{props.canRestore ? " · Ctrl+R 恢复原生" : ""}
                </text>
              </Show>
              <Show when={props.saving}>
                <text fg={props.theme.text.feedback.warning.base}>
                  {props.action === "restore" ? "正在恢复…" : "正在保存…"}
                </text>
              </Show>
              <Show when={props.failed}>
                <text fg={props.theme.text.feedback.error.base}>
                  {props.action === "restore" ? "恢复失败，可重试。" : "保存失败，可重试。"}
                </text>
              </Show>
            </box>
          </scrollbox>
        )}
      </Show>
    </box>
  )
}

function Foot(props: {
  readonly theme: Theme
  readonly minimal: boolean
  readonly dense: boolean
  readonly wide: boolean
  readonly split: boolean
  readonly focus: Focus
  readonly saving: boolean
  readonly confirming: boolean
  readonly hasVariants: boolean
}) {
  const enterLabel = () => {
    if (props.saving) return "处理中…"
    if (props.confirming) return "确认"
    if (props.focus === "models" && props.hasVariants) return "思考等级"
    if (props.focus === "models" && !props.split) return "详情"
    return "保存"
  }
  const hints = (): Hint[] => {
    if (props.confirming) {
      return [
        { key: "Enter", label: "确认", emphasis: true },
        { key: "ESC", label: "取消" },
      ]
    }
    if (props.minimal) {
      return [
        { key: "↑↓", label: "选择" },
        { key: "←→", label: "切换" },
        { key: "Enter", label: enterLabel(), emphasis: true },
        { key: "ESC", label: "返回" },
      ]
    }
    if (props.focus === "variants") {
      return [
        ...(props.hasVariants
          ? [{ key: "↑↓", label: "思考等级" }]
          : [{ key: "↑↓", label: "模型" }]),
        { key: "←→", label: "切换" },
        { key: "Enter", label: enterLabel(), emphasis: true },
        { key: "Ctrl+F", label: "收藏" },
        { key: "Ctrl+R", label: "恢复原生" },
        { key: "ESC", label: "返回" },
      ]
    }
    return [
      { key: "↑↓", label: "模型" },
      { key: "←→", label: "切换" },
      { key: "Enter", label: enterLabel(), emphasis: true },
      { key: "Ctrl+F", label: "收藏" },
      { key: "Ctrl+R", label: "恢复原生" },
      { key: "ESC", label: "返回" },
    ]
  }
  return (
    <box
      flexShrink={0}
      border={props.minimal || props.dense ? undefined : ["top"]}
      borderColor={props.theme.border.base}
      paddingTop={props.minimal || props.dense ? 0 : 1}
      flexDirection="row"
      justifyContent="space-between"
      gap={2}
      flexWrap="wrap"
    >
      <Hints theme={props.theme} hints={hints()} />
      <Show when={props.wide && !props.minimal && !props.confirming}>
        <Legend
          theme={props.theme}
          items={[
            { value: "当前", label: "生效", tone: "accent" },
            { value: "|", label: "选中", tone: "neutral" },
            { value: "待保存", label: "未提交", tone: "warning" },
          ]}
        />
      </Show>
    </box>
  )
}
