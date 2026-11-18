/** @jsxImportSource @opentui/solid */
import { TextAttributes, type InputRenderable, type Renderable, type ScrollBoxRenderable } from "@opentui/core"
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
  buildDashboardGroups,
  feedbackDismissMs,
  filterDashboardGroups,
  fitModelParts,
  layoutFor,
  roleLabel,
  SETTINGS_ID,
  settingsRowVisible,
  type DashboardAgent,
  type DashboardAgentInput,
  type DashboardGroup,
  type Feedback,
  type PermissionEffect,
} from "./model.ts"
import { ModelConfigView } from "./model-config.tsx"
import type { ModelSelectionResult } from "./team.ts"
import {
  Badge,
  ConfirmBar,
  effectTone,
  FeedbackBar,
  GroupHeader,
  Hints,
  rowBackground,
  rowForeground,
  rowMarker,
  rowSecondary,
  scrollbarOptions,
  SearchBar,
  SectionHeading,
  selectedRowAccent,
  ToggleChip,
  toneColor,
  ViewHeader,
  type KeymapLayer,
  type Theme,
} from "./ui.tsx"

export interface TeamDashboardProps {
  readonly agents: readonly DashboardAgentInput[]
  readonly overrides: Readonly<Record<string, string>>
  readonly models: readonly ModelInfo[]
  readonly providers: readonly ProviderInfo[]
  readonly modelError?: string
  readonly warning?: string
  readonly agentsSupported: boolean
  readonly agentsError?: string
  readonly defaultAgent: boolean
  readonly toggleDefaultAgent: (enabled: boolean) => Promise<ModelSelectionResult>
  readonly refreshModels: () => Promise<{
    readonly models: readonly ModelInfo[]
    readonly error?: string
  }>
  readonly favorites: readonly string[]
  readonly toggleFavorite: (ref: string) => Promise<{ readonly ok: boolean; readonly error?: string }>
  readonly theme: Theme
  readonly layer: (factory: () => KeymapLayer) => void
  readonly clearDialog: () => void
  readonly saveModel: (
    agent: DashboardAgent,
    model: string | null,
  ) => Promise<ModelSelectionResult>
  readonly restoreModel: (agent: DashboardAgent) => Promise<ModelSelectionResult>
  readonly close: () => void
}

export function TeamDashboard(props: TeamDashboardProps) {
  const theme = () => props.theme.surface("dialog")
  const dimensions = useTerminalDimensions()
  const layout = createMemo(() => layoutFor(dimensions().width, dimensions().height))

  const [overrides, setOverrides] = createSignal(props.overrides)
  const [models, setModels] = createSignal(props.models)
  const [modelError, setModelError] = createSignal(props.modelError)
  const [refreshingModels, setRefreshingModels] = createSignal(false)
  const initialGroups = buildDashboardGroups(props.agents, props.overrides, props.models, props.providers)
  const initialRows = initialGroups.flatMap((group) => group.agents)
  const initialID = initialRows[0]?.id ?? ""
  const [selectedID, setSelectedID] = createSignal(initialID)
  const [defaultAgent, setDefaultAgent] = createSignal(props.defaultAgent)
  const [query, setQuery] = createSignal("")
  const [pane, setPane] = createSignal<"list" | "detail">("list")
  const [modelOpen, setModelOpen] = createSignal(false)
  const [configAgentID, setConfigAgentID] = createSignal<string>()
  const [feedback, setFeedback] = createSignal<Feedback>()
  const [pendingRestore, setPendingRestore] = createSignal<DashboardAgent>()
  const [restoring, setRestoring] = createSignal(false)
  const [searchFocused, setSearchFocused] = createSignal(true)
  let disposed = false
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined

  function showFeedback(next: Feedback): void {
    if (disposed) return
    setFeedback(next)
    if (feedbackTimer !== undefined) clearTimeout(feedbackTimer)
    feedbackTimer = undefined
    const delay = feedbackDismissMs(next.tone)
    if (delay === 0) return
    feedbackTimer = setTimeout(() => {
      if (!disposed) setFeedback(undefined)
    }, delay)
  }

  const allGroups = () => buildDashboardGroups(props.agents, overrides(), models(), props.providers)
  const groups = () => filterDashboardGroups(allGroups(), query())
  const agentRows = () => groups().flatMap((group) => group.agents)
  const settingsVisible = () =>
    settingsRowVisible(query(), { hasAgents: agentRows().length > 0 })
  const rowIDs = () => [
    ...(settingsVisible() ? [SETTINGS_ID] : []),
    ...agentRows().map((agent) => agent.id),
  ]
  const selected = () => agentRows().find((agent) => agent.id === selectedID())

  // 配置视图跟着 overrides 重新计算，保存/恢复后顶部状态与“当前模型”立即更新。
  const configAgent = createMemo(() => {
    const id = configAgentID()
    if (id === undefined) return undefined
    return allGroups()
      .flatMap((group) => group.agents)
      .find((agent) => agent.id === id)
  })

  createEffect(() => {
    const ids = rowIDs()
    if (ids.includes(selectedID())) return
    // 过滤/清空搜索后优先落回 Agent 行，避免直接停在设置行上误触空格。
    setSelectedID(agentRows()[0]?.id ?? ids[0] ?? "")
  })

  let listScroll: ScrollBoxRenderable | undefined
  let detailScroll: ScrollBoxRenderable | undefined
  let searchInput: InputRenderable | undefined
  let focusTimer: ReturnType<typeof setTimeout> | undefined
  let scrollTimer: ReturnType<typeof setTimeout> | undefined
  const rowNodes = new Map<string, Renderable>()

  // 设置行选中时空格同时被输入框接收；切换后恢复进入设置行前的查询，避免留下空格。
  let settingsQuery = ""

  function focusSearch(): void {
    if (pendingRestore() !== undefined || restoring()) return
    if (searchInput === undefined || searchInput.isDestroyed) return
    // 搜索框获得焦点时把选中移回 Agent 行，避免“空格 切换”提示与实际输入冲突。
    if (selectedID() === SETTINGS_ID) setSelectedID(agentRows()[0]?.id ?? "")
    searchInput.focus()
    searchInput.cursorOffset = searchInput.value.length
    setSearchFocused(true)
  }

  function blurSearch(): void {
    if (searchInput !== undefined && !searchInput.isDestroyed) searchInput.blur()
    setSearchFocused(false)
  }

  function scheduleFocusSearch(): void {
    if (focusTimer !== undefined) clearTimeout(focusTimer)
    focusTimer = setTimeout(focusSearch, 1)
  }

  createEffect(
    on(
      selectedID,
      (id) => {
        if (id !== undefined && id !== SETTINGS_ID) ensureVisible(id)
        if (detailScroll !== undefined && !detailScroll.isDestroyed) detailScroll.scrollTo(0)
        // 设置行选中时移走搜索焦点，空格才是开关而不是空白字符。
        if (id === SETTINGS_ID) {
          settingsQuery = query()
          blurSearch()
        } else if (pendingRestore() === undefined && !restoring()) {
          scheduleFocusSearch()
        }
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    disposed = true
    if (focusTimer !== undefined) clearTimeout(focusTimer)
    if (scrollTimer !== undefined) clearTimeout(scrollTimer)
    if (feedbackTimer !== undefined) clearTimeout(feedbackTimer)
  })

  function ensureVisible(id: string): void {
    const scroll = listScroll
    const node = rowNodes.get(id)
    if (scroll === undefined || node === undefined || node.isDestroyed) return
    if (scrollTimer !== undefined) clearTimeout(scrollTimer)
    scrollTimer = setTimeout(() => {
      if (scroll.isDestroyed || node.isDestroyed) return
      const top = node.y - scroll.y
      if (top < 0) scroll.scrollBy(top - 1)
      else if (top + node.height > scroll.height) {
        scroll.scrollBy(top + node.height - scroll.height + 1)
      }
    }, 0)
  }

  function move(delta: number): void {
    const list = rowIDs()
    if (list.length === 0) return
    const index = list.indexOf(selectedID())
    const next = index < 0 ? 0 : (index + delta + list.length) % list.length
    setSelectedID(list[next]!)
  }

  function first(): void {
    const list = rowIDs()
    if (list.length > 0) setSelectedID(list[0]!)
  }

  function last(): void {
    const list = rowIDs()
    if (list.length > 0) setSelectedID(list[list.length - 1]!)
  }

  function page(delta: number): void {
    const target = layout().split || pane() === "detail" ? detailScroll : listScroll
    if (target !== undefined && !target.isDestroyed) target.scrollBy(delta * 10)
  }

  async function choose(): Promise<void> {
    const agent = selected()
    if (agent === undefined) {
      if (selectedID() === SETTINGS_ID) {
        showFeedback({ tone: "info", message: "按空格切换默认代理。" })
      }
      return
    }
    if (!layout().split && pane() === "list") {
      setPane("detail")
      return
    }
    if (!agent.known) {
      showFeedback({ tone: "warning", message: "该 Agent 当前目录不可用，只能清除旧覆盖。" })
      return
    }
    if (agent.mode === "primary") {
      showFeedback({
        tone: "info",
        message: "主代理模型由 OpenCode 会话选择，团队策略只覆盖子代理。",
      })
      return
    }
    if (!refreshingModels() && (modelError() !== undefined || models().length === 0)) {
      setRefreshingModels(true)
      showFeedback({ tone: "info", message: "正在重新读取模型目录…" })
      try {
        const next = await props.refreshModels()
        if (disposed) return
        setModels(next.models)
        setModelError(next.error)
      } catch (error) {
        if (disposed) return
        showFeedback({
          tone: "warning",
          message: `模型目录刷新失败：${error instanceof Error ? error.message : String(error)}`,
        })
      } finally {
        if (!disposed) setRefreshingModels(false)
      }
    }
    setConfigAgentID(agent.id)
    setModelOpen(true)
  }

  function requestRestore(): void {
    if (selectedID() === SETTINGS_ID) return
    const agent = selected()
    if (agent === undefined) return
    if (!agent.canRestore) {
      showFeedback({ tone: "info", message: `${agent.name} 没有团队模型覆盖，无需恢复。` })
      return
    }
    if (restoring()) return
    setFeedback(undefined)
    setPendingRestore(agent)
    blurSearch()
  }

  async function confirmRestoreNow(): Promise<void> {
    const agent = pendingRestore()
    if (agent === undefined || restoring()) return
    setPendingRestore(undefined)
    setRestoring(true)
    showFeedback({ tone: "info", message: `正在恢复 ${agent.name}…` })
    try {
      const result = await props.restoreModel(agent)
      if (disposed) return
      setRestoring(false)
      showFeedback({ tone: result.tone, message: result.message })
      if (result.saved && result.models !== undefined) setOverrides(result.models)
    } catch (error) {
      if (disposed) return
      setRestoring(false)
      showFeedback({
        tone: "error",
        message: `恢复原生模型失败：${error instanceof Error ? error.message : String(error)}`,
      })
    }
    scheduleFocusSearch()
  }

  let togglingDefault = false

  async function toggleDefaultAgentNow(): Promise<void> {
    if (togglingDefault || pendingRestore() !== undefined || restoring()) return
    blurSearch()
    setQuery(settingsQuery)
    if (searchInput !== undefined && !searchInput.isDestroyed) {
      searchInput.value = settingsQuery
      searchInput.cursorOffset = settingsQuery.length
    }
    togglingDefault = true
    showFeedback({ tone: "info", message: "正在保存默认代理设置…" })
    try {
      const result = await props.toggleDefaultAgent(!defaultAgent())
      if (disposed) return
      if (result.defaultAgent !== undefined) setDefaultAgent(result.defaultAgent)
      showFeedback({ tone: result.tone, message: result.message })
    } catch (error) {
      if (disposed) return
      showFeedback({
        tone: "error",
        message: `保存默认代理设置失败：${error instanceof Error ? error.message : String(error)}`,
      })
    } finally {
      togglingDefault = false
      if (!disposed) {
        setQuery(settingsQuery)
        if (searchInput !== undefined && !searchInput.isDestroyed) {
          searchInput.value = settingsQuery
          searchInput.cursorOffset = settingsQuery.length
        }
        blurSearch()
      }
    }
  }

  function close(): void {
    props.close()
    props.clearDialog()
  }

  props.layer(() => ({
    mode: "modal",
    priority: 10,
    enabled: () => !modelOpen(),
    commands: [
      {
        id: "opencode-team.dashboard.up",
        bind: "up",
        enabled: () => pendingRestore() === undefined,
        run: () => move(-1),
      },
      {
        id: "opencode-team.dashboard.down",
        bind: "down",
        enabled: () => pendingRestore() === undefined,
        run: () => move(1),
      },
      {
        id: "opencode-team.dashboard.first",
        bind: "home",
        enabled: () => pendingRestore() === undefined,
        run: first,
      },
      {
        id: "opencode-team.dashboard.last",
        bind: "end",
        enabled: () => pendingRestore() === undefined,
        run: last,
      },
      {
        id: "opencode-team.dashboard.page_up",
        bind: "pageup",
        enabled: () => pendingRestore() === undefined,
        run: () => page(-1),
      },
      {
        id: "opencode-team.dashboard.page_down",
        bind: "pagedown",
        enabled: () => pendingRestore() === undefined,
        run: () => page(1),
      },
      {
        id: "opencode-team.dashboard.choose",
        bind: "enter",
        run: () => {
          if (pendingRestore() !== undefined) void confirmRestoreNow()
          else if (selectedID() === SETTINGS_ID) {
            showFeedback({ tone: "info", message: "按空格切换默认代理。" })
          } else void choose()
        },
      },
      {
        id: "opencode-team.dashboard.default_agent",
        bind: "space",
        enabled: () =>
          selectedID() === SETTINGS_ID &&
          !searchFocused() &&
          pendingRestore() === undefined &&
          !restoring(),
        run: () => void toggleDefaultAgentNow(),
      },
      {
        id: "opencode-team.dashboard.restore",
        bind: "ctrl+r",
        enabled: () => pendingRestore() === undefined,
        run: requestRestore,
      },
      {
        id: "opencode-team.dashboard.escape",
        bind: "escape",
        run: () => {
          if (pendingRestore() !== undefined) {
            setPendingRestore(undefined)
            scheduleFocusSearch()
            return
          }
          if (!layout().split && pane() === "detail") {
            setPane("list")
            return
          }
          close()
        },
      },
    ],
  }))

  const split = () => layout().split
  const showList = () => split() || pane() === "list"
  const showDetail = () => split() || pane() === "detail"
  const agent = () => selected()
  const escapeLabel = () => {
    if (pendingRestore() !== undefined) return "ESC 取消"
    if (!split() && pane() === "detail") return "ESC 返回"
    return "ESC 关闭"
  }
  const modelLineWidth = () =>
    (split() ? layout().listWidth : layout().contentWidth) - 7

  return (
    <box
      width="100%"
      height={layout().dialogHeight}
      flexDirection="column"
      paddingLeft={2}
      paddingRight={2}
      paddingBottom={1}
    >
      <Show
        when={!modelOpen()}
        fallback={
          <Show when={configAgent()}>
            {(agent) => (
              <ModelConfigView
                agent={agent()}
                models={models()}
                providers={props.providers}
                currentOverride={overrides()[agent().id]}
                {...(modelError() === undefined ? {} : { modelError: modelError() })}
                favorites={props.favorites}
                toggleFavorite={props.toggleFavorite}
                theme={theme()}
                layer={props.layer}
                feedback={feedback()}
                onClose={() => {
                  setModelOpen(false)
                  setConfigAgentID(undefined)
                }}
                onSave={async (model) => {
                  const result = await props.saveModel(agent(), model)
                  if (disposed) return result
                  if (result.saved && result.models !== undefined) setOverrides(result.models)
                  showFeedback({ tone: result.tone, message: result.message })
                  return result
                }}
                onRestore={async () => {
                  const result = await props.restoreModel(agent())
                  if (disposed) return result
                  if (result.saved && result.models !== undefined) setOverrides(result.models)
                  showFeedback({ tone: result.tone, message: result.message })
                  return result
                }}
                notify={showFeedback}
              />
            )}
          </Show>
        }
      >
        <ViewHeader
          theme={theme()}
          section="团队管理"
          right={escapeLabel()}
        />

        <Banners
          theme={theme()}
          agentsSupported={props.agentsSupported}
          {...(props.agentsError === undefined ? {} : { agentsError: props.agentsError })}
          modelError={modelError()}
          warning={props.warning}
        />

        <Show when={settingsVisible()}>
          <box paddingTop={layout().dense ? 0 : 1} flexShrink={0}>
            <DefaultAgentBar
              theme={theme()}
              selected={selectedID() === SETTINGS_ID}
              enabled={defaultAgent()}
              compact={layout().minimal || layout().compact}
              onToggle={() => void toggleDefaultAgentNow()}
            />
          </box>
        </Show>

        <box paddingTop={layout().minimal || layout().dense ? 0 : 1} flexShrink={0}>
          <SearchBar
            theme={theme()}
            value={query()}
            focused={searchFocused()}
            placeholder="Agent 名称 / 角色 / 模型…"
            right={`${agentRows().length} 个 Agent`}
            inputRef={(value) => {
              searchInput = value
              scheduleFocusSearch()
            }}
            onFocus={focusSearch}
            onInput={(value) => setQuery(value)}
          />
        </box>

        <box flexGrow={1} minHeight={0} flexDirection="row" paddingTop={layout().dense ? 0 : 1}>
          <Show when={showList()}>
            <ListPane
              theme={theme()}
              groups={groups()}
              selectedID={selectedID()}
              width={split() ? layout().listWidth : undefined}
              modelLineWidth={modelLineWidth()}
              compact={layout().compact}
              onSelect={(id) => {
                if (pendingRestore() !== undefined) return
                setSelectedID(id)
                scheduleFocusSearch()
              }}
              onRef={(id, node) => rowNodes.set(id, node)}
              onScrollRef={(value) => (listScroll = value)}
            />
          </Show>
          <Show when={split()}>
            <box width={1} flexShrink={0} backgroundColor={theme().border.base} />
          </Show>
          <Show when={showDetail()}>
            <DetailPane
              theme={theme()}
              agent={agent()}
              settingsSelected={selectedID() === SETTINGS_ID}
              defaultAgent={defaultAgent()}
              compact={layout().compact}
              onScrollRef={(value) => (detailScroll = value)}
            />
          </Show>
        </box>

        <Show when={pendingRestore()}>
          {(pending) => (
            <ConfirmBar
              theme={theme()}
              message={
                pending().hostModel === undefined
                  ? `清除 ${pending().name} 的团队模型覆盖并恢复 OpenCode 原生选择？`
                  : `清除 ${pending().name} 的团队模型覆盖，回到 Agent 配置的 ${pending().hostModel}？`
              }
            />
          )}
        </Show>
        <Show when={feedback()}>
          {(value) => <FeedbackBar theme={theme()} feedback={value()} />}
        </Show>

        <Footer
          theme={theme()}
          minimal={layout().minimal}
          dense={layout().dense}
          split={split()}
          pane={pane()}
          agent={agent()}
          settingsSelected={selectedID() === SETTINGS_ID}
          defaultAgent={defaultAgent()}
          confirming={pendingRestore() !== undefined}
        />
      </Show>
    </box>
  )
}

/** 顶部的独立设置行：只影响新会话默认主代理，不改变 Orchestrator 本身。 */
function DefaultAgentBar(props: {
  readonly theme: Theme
  readonly selected: boolean
  readonly enabled: boolean
  readonly compact: boolean
  readonly onToggle: () => void
}) {
  return (
    <box
      flexDirection="column"
      flexShrink={0}
      backgroundColor={
        props.selected ? props.theme.background.raised.high : props.theme.background.raised.base
      }
      border={["left"]}
      borderColor={props.selected ? selectedRowAccent(props.theme) : props.theme.border.base}
      paddingLeft={1}
      paddingRight={1}
      onMouseUp={props.onToggle}
    >
      <box flexDirection="row" justifyContent="space-between" gap={2}>
        <box flexDirection="row" gap={1} minWidth={0}>
          <text
            flexShrink={0}
            fg={rowForeground(props.theme)}
            attributes={TextAttributes.BOLD}
          >
            默认代理
          </text>
          <text flexShrink={0} fg={props.theme.text.muted}>
            Orchestrator
          </text>
        </box>
        <ToggleChip theme={props.theme} on={props.enabled} />
      </box>
      <Show when={!props.compact}>
        <text
          fg={props.selected ? props.theme.text.base : props.theme.text.muted}
          overflow="hidden"
          wrapMode="none"
        >
          {props.enabled ? "新会话默认使用 Orchestrator" : "新会话默认代理跟随 OpenCode 配置"}
          <span style={{ fg: props.theme.text.muted }}>
            {props.selected ? " · 空格 切换" : " · 选中后空格切换"}
          </span>
        </text>
      </Show>
    </box>
  )
}

function Banners(props: {
  readonly theme: Theme
  readonly agentsSupported: boolean
  readonly agentsError?: string
  readonly modelError?: string
  readonly warning?: string
}) {
  const messages = () => {
    const list: string[] = []
    if (!props.agentsSupported) {
      list.push(
        props.agentsError === undefined
          ? "宿主不能动态注册团队 Agent；Orchestrator、QA、Reviewer 可能不可用。"
          : `团队 Agent 注册失败：${props.agentsError}`,
      )
    }
    if (props.warning !== undefined) list.push(props.warning)
    if (props.modelError !== undefined) {
      list.push(`${props.modelError}；模型名称回退为引用，打开模型配置时会重试。`)
    }
    return list
  }
  return (
    <Show when={messages().length > 0}>
      <box flexDirection="column" flexShrink={0} paddingTop={1}>
        <For each={messages()}>
          {(message) => (
            <text fg={props.theme.text.feedback.warning.base} wrapMode="word">
              ! {message}
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}

function ListPane(props: {
  readonly theme: Theme
  readonly groups: readonly DashboardGroup[]
  readonly selectedID?: string
  readonly width?: number
  readonly modelLineWidth: number
  readonly compact: boolean
  readonly onSelect: (id: string) => void
  readonly onRef: (id: string, node: Renderable) => void
  readonly onScrollRef: (value: ScrollBoxRenderable) => void
}) {
  return (
    <box
      width={props.width}
      flexGrow={props.width === undefined ? 1 : undefined}
      flexShrink={0}
      minWidth={0}
      backgroundColor={props.theme.background.raised.base}
      paddingLeft={1}
      paddingRight={1}
    >
      <Show
        when={props.groups.length > 0}
        fallback={
          <box paddingTop={1}>
            <text fg={props.theme.text.muted}>没有匹配的 Agent。</text>
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
                <GroupHeader theme={props.theme} title={group.title} count={group.count} />
                <For each={group.agents}>
                  {(agent) => {
                    const active = () => agent.id === props.selectedID
                    const parts = () => fitModelParts(agent.modelParts, props.modelLineWidth)
                    return (
                      <box
                        flexDirection="column"
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={rowBackground(props.theme, active())}
                        onMouseUp={() => props.onSelect(agent.id)}
                        ref={(node: Renderable) => props.onRef(agent.id, node)}
                      >
                        <box flexDirection="row" gap={1}>
                          <text flexShrink={0} fg={rowMarker(props.theme, active())}>
                            {active() ? "|" : " "}
                          </text>
                          <text
                            flexGrow={1}
                            overflow="hidden"
                            wrapMode="none"
                            fg={rowForeground(props.theme)}
                            attributes={active() ? TextAttributes.BOLD : undefined}
                          >
                            {agent.name}
                          </text>
                          <text
                            flexShrink={0}
                            fg={toneColor(props.theme, agent.configTone)}
                          >
                            {agent.configTag}
                          </text>
                        </box>
                        <Show when={!props.compact}>
                          <box flexDirection="row" gap={1} paddingLeft={2}>
                            <Show when={parts().provider !== undefined}>
                              <text flexShrink={0} fg={rowSecondary(props.theme, active())}>
                                {parts().provider}
                              </text>
                              <text flexShrink={0} fg={props.theme.text.faint}>
                                ·
                              </text>
                            </Show>
                            <text
                              flexGrow={1}
                              overflow="hidden"
                              wrapMode="none"
                              fg={rowSecondary(props.theme, active())}
                            >
                              {parts().model}
                            </text>
                            <Show when={parts().variant !== undefined}>
                              <text flexShrink={0} fg={props.theme.text.faint}>
                                ·
                              </text>
                              <text flexShrink={0} fg={rowSecondary(props.theme, active())}>
                                {parts().variant}
                              </text>
                            </Show>
                          </box>
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

function DetailPane(props: {
  readonly theme: Theme
  readonly agent?: DashboardAgent
  readonly settingsSelected: boolean
  readonly defaultAgent: boolean
  readonly compact: boolean
  readonly onScrollRef: (value: ScrollBoxRenderable) => void
}) {
  return (
    <box flexGrow={1} minWidth={0} minHeight={0} paddingLeft={2}>
      <Show when={props.settingsSelected} fallback={<AgentDetail {...props} />}>
        <scrollbox
          flexGrow={1}
          minHeight={0}
          verticalScrollbarOptions={scrollbarOptions(props.theme)}
          horizontalScrollbarOptions={{ visible: false }}
          ref={props.onScrollRef}
        >
          <box flexDirection="column" gap={1} paddingTop={1} paddingRight={1}>
            <box flexDirection="row" justifyContent="space-between" gap={2}>
              <box flexDirection="column">
                <text fg={props.theme.text.muted}>默认代理</text>
                <text fg={props.theme.text.base} attributes={TextAttributes.BOLD}>
                  Orchestrator
                </text>
              </box>
              <ToggleChip theme={props.theme} on={props.defaultAgent} />
            </box>
            <box
              flexDirection="column"
              backgroundColor={props.theme.background.raised.base}
              border={["left"]}
              borderColor={selectedRowAccent(props.theme)}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={props.theme.text.base} attributes={TextAttributes.BOLD}>
                {props.defaultAgent ? "新会话默认使用 Orchestrator" : "新会话默认代理跟随 OpenCode 配置"}
              </text>
              <text fg={props.theme.text.muted} wrapMode="word">
                开启后，新会话默认代理为 Orchestrator；已有会话的代理保持不变。
              </text>
            </box>
            <text fg={props.theme.text.muted} wrapMode="word">
              该开关不会删除或禁用 Orchestrator：它仍在 PRIMARY 分组中，可以继续查看角色、配置模型。
            </text>
            <text fg={props.theme.text.muted} wrapMode="word">
              用户配置了 default_agent 时，以该配置为准。
            </text>
            <text fg={props.theme.text.base} wrapMode="word">
              空格 切换 · 当前：
              <span style={{ fg: props.defaultAgent ? toneColor(props.theme, "success") : props.theme.text.muted }}>
                {props.defaultAgent ? "开启" : "关闭"}
              </span>
            </text>
          </box>
        </scrollbox>
      </Show>
    </box>
  )
}

function AgentDetail(props: {
  readonly theme: Theme
  readonly agent?: DashboardAgent
  readonly settingsSelected: boolean
  readonly defaultAgent: boolean
  readonly compact: boolean
  readonly onScrollRef: (value: ScrollBoxRenderable) => void
}) {
  return (
    <Show
      when={props.agent}
      fallback={
        <box paddingTop={1}>
          <text fg={props.theme.text.muted}>没有可显示的 Agent。</text>
        </box>
      }
    >
      {(agent) => (
        <scrollbox
          flexGrow={1}
          minHeight={0}
          verticalScrollbarOptions={scrollbarOptions(props.theme)}
          horizontalScrollbarOptions={{ visible: false }}
          ref={props.onScrollRef}
        >
          <box flexDirection="column" gap={1} paddingRight={1}>
            <box flexDirection="column">
              <box flexDirection="row" justifyContent="space-between" gap={2}>
                <text
                  flexGrow={1}
                  overflow="hidden"
                  wrapMode="none"
                  fg={props.theme.text.base}
                  attributes={TextAttributes.BOLD}
                >
                  {agent().name}
                </text>
                <box flexDirection="row" gap={1} flexShrink={0}>
                  <Badge theme={props.theme} text={roleLabel(agent().mode)} tone="neutral" />
                  <Badge
                    theme={props.theme}
                    text={agent().configBadge}
                    tone={agent().configTone}
                  />
                </box>
              </box>
              <text fg={props.theme.text.muted} overflow="hidden" wrapMode="none">
                {agent().id}
              </text>
            </box>

            <box
              flexDirection="column"
              backgroundColor={props.theme.background.raised.base}
              border={["left"]}
              borderColor={selectedRowAccent(props.theme)}
              paddingLeft={1}
              paddingRight={1}
              paddingTop={1}
              paddingBottom={1}
            >
              <text fg={props.theme.text.muted} attributes={TextAttributes.BOLD}>
                当前模型
              </text>
              <text fg={props.theme.text.base} attributes={TextAttributes.BOLD} wrapMode="word">
                {agent().modelLabel}
              </text>
              <text fg={props.theme.text.muted} wrapMode="word">
                来源：{agent().sourceLabel} · 变体：{agent().variantLabel}
              </text>
              <Show when={agent().source !== "none" && agent().effectiveModel !== undefined}>
                <text fg={props.theme.text.muted} wrapMode="word">
                  {agent().effectiveModel} ·{" "}
                  {agent().source === "team" ? "团队覆盖优先于 Agent 配置" : "来自 Agent 配置"}
                </text>
              </Show>
              <Show when={agent().mode === "primary"}>
                <text fg={props.theme.text.muted} wrapMode="word">
                  主代理模型由 OpenCode 会话选择，团队策略不能覆盖；此处只读展示。
                </text>
              </Show>
            </box>

            <SectionHeading theme={props.theme} title="角色职责" first />
            <text fg={props.theme.text.muted} wrapMode="word">
              {agent().description ?? "宿主未提供角色说明。"}
            </text>

            <SectionHeading theme={props.theme} title="权限 / PERMISSIONS" />
            <text fg={props.theme.text.muted} wrapMode="word">
              允许 <span style={{ fg: toneColor(props.theme, "neutral") }}>{agent().permissions.allow}</span>
              {" · "}询问{" "}
              <span style={{ fg: props.theme.text.feedback.warning.base }}>
                {agent().permissions.ask}
              </span>
              {" · "}拒绝{" "}
              <span style={{ fg: props.theme.text.feedback.error.base }}>
                {agent().permissions.deny}
              </span>
              {"（共 "}
              {agent().permissions.total} 条生效规则）
            </text>
            <text fg={props.theme.text.muted} wrapMode="word">
              默认：
              {agent().permissions.defaultEffect === undefined
                ? "未设置（宿主按 ask 处理）"
                : `*/* ${effectLabel(agent().permissions.defaultEffect!)}`}
            </text>
            <For each={agent().permissions.highlights}>
              {(rule) => (
                <text fg={toneColor(props.theme, effectTone(rule.effect))} wrapMode="word">
                  {effectLabel(rule.effect)} {rule.action} {rule.resource}
                </text>
              )}
            </For>
            <Show when={!props.compact}>
              <text fg={props.theme.text.muted} wrapMode="word">
                规则效果摘要，不代表沙箱；Shell 仍可能写文件。完整合并顺序见宿主策略。
              </text>
            </Show>

            <SectionHeading theme={props.theme} title="System Prompt（只读）" />
            <Show
              when={agent().prompt.available}
              fallback={
                <text fg={props.theme.text.feedback.warning.base} wrapMode="word">
                  {agent().prompt.reason}
                </text>
              }
            >
              <box
                border={["left"]}
                borderColor={props.theme.border.base}
                paddingLeft={1}
                paddingRight={1}
                flexDirection="column"
              >
                <text fg={props.theme.text.base} wrapMode="word">
                  {agent().prompt.text}
                </text>
              </box>
            </Show>
          </box>
        </scrollbox>
      )}
    </Show>
  )
}

function Footer(props: {
  readonly theme: Theme
  readonly minimal: boolean
  readonly dense: boolean
  readonly split: boolean
  readonly pane: "list" | "detail"
  readonly agent?: DashboardAgent
  readonly settingsSelected: boolean
  readonly defaultAgent: boolean
  readonly confirming: boolean
}) {
  const enter = () => (props.agent?.canConfigure === true ? "模型" : "说明")
  const hints = () => {
    if (props.confirming) {
      return [
        { key: "Enter", label: "确认" },
        { key: "ESC", label: "取消" },
      ]
    }
    // 单栏详情页的 ESC 是返回列表；设置行在详情页中选中时优先给出空格提示。
    if (!props.split && props.pane === "detail" && props.settingsSelected) {
      return [
        { key: "空格", label: props.defaultAgent ? "关闭默认代理" : "开启默认代理" },
        { key: "↑↓", label: "选择" },
        { key: "ESC", label: "返回" },
      ]
    }
    if (!props.split && props.pane === "detail") {
      return [
        { key: "Enter", label: enter() },
        { key: "Ctrl+R", label: "恢复原生" },
        { key: "ESC", label: "返回" },
      ]
    }
    if (props.settingsSelected) {
      return [
        { key: "↑↓", label: "选择" },
        { key: "空格", label: props.defaultAgent ? "关闭默认代理" : "开启默认代理" },
        { key: "ESC", label: "关闭" },
      ]
    }
    if (props.minimal) {
      return [
        { key: "↑↓", label: "选择" },
        { key: "ESC", label: "关闭" },
      ]
    }
    if (!props.split) {
      return [
        { key: "↑↓", label: "选择" },
        { key: "Enter", label: "详情" },
        { key: "ESC", label: "关闭" },
      ]
    }
    return [
      { key: "↑↓", label: "选择" },
      { key: "Enter", label: enter() },
      { key: "Ctrl+R", label: "恢复原生" },
      { key: "ESC", label: "关闭" },
    ]
  }
  return (
    <box
      flexShrink={0}
      border={props.minimal || props.dense ? undefined : ["top"]}
      borderColor={props.theme.border.base}
      paddingTop={props.minimal || props.dense ? 0 : 1}
    >
      <Hints theme={props.theme} hints={hints()} />
    </box>
  )
}

function effectLabel(effect: PermissionEffect): string {
  if (effect === "allow") return "允许"
  if (effect === "deny") return "拒绝"
  return "询问"
}
