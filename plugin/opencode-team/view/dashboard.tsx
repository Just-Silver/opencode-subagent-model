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
  layoutFor,
  roleLabel,
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
  Divider,
  effectTone,
  FeedbackBar,
  Hints,
  rowBackground,
  rowForeground,
  rowMarker,
  rowSecondary,
  scrollbarOptions,
  Section,
  selectedRowAccent,
  statusTone,
  toneColor,
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
  readonly refreshModels: () => Promise<{
    readonly models: readonly ModelInfo[]
    readonly error?: string
  }>
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
  const [query, setQuery] = createSignal("")
  const [pane, setPane] = createSignal<"list" | "detail">("list")
  const [modelOpen, setModelOpen] = createSignal(false)
  const [configAgentID, setConfigAgentID] = createSignal<string>()
  const [feedback, setFeedback] = createSignal<Feedback>()
  const [pendingRestore, setPendingRestore] = createSignal<DashboardAgent>()
  const [restoring, setRestoring] = createSignal(false)
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
  const rows = () => groups().flatMap((group) => group.agents)
  const selected = () =>
    rows().find((agent) => agent.id === selectedID()) ?? rows()[0]

  // 配置视图跟着 overrides 重新计算，保存/恢复后顶部状态与“当前模型”立即更新。
  const configAgent = createMemo(() => {
    const id = configAgentID()
    if (id === undefined) return undefined
    return allGroups()
      .flatMap((group) => group.agents)
      .find((agent) => agent.id === id)
  })

  createEffect(() => {
    const agent = selected()
    if (agent !== undefined && agent.id !== selectedID()) setSelectedID(agent.id)
  })

  let listScroll: ScrollBoxRenderable | undefined
  let detailScroll: ScrollBoxRenderable | undefined
  let searchInput: InputRenderable | undefined
  let focusTimer: ReturnType<typeof setTimeout> | undefined
  let scrollTimer: ReturnType<typeof setTimeout> | undefined
  const rowNodes = new Map<string, Renderable>()

  function focusSearch(): void {
    if (pendingRestore() !== undefined || restoring()) return
    if (searchInput === undefined || searchInput.isDestroyed) return
    searchInput.focus()
    searchInput.cursorOffset = searchInput.value.length
  }

  function scheduleFocusSearch(): void {
    if (focusTimer !== undefined) clearTimeout(focusTimer)
    focusTimer = setTimeout(focusSearch, 1)
  }

  createEffect(
    on(
      () => selected()?.id,
      (id) => {
        if (id !== undefined) ensureVisible(id)
        detailScroll?.scrollTo(0)
      },
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
    const list = rows()
    if (list.length === 0) return
    const index = list.findIndex((agent) => agent.id === selectedID())
    const next = index < 0 ? 0 : (index + delta + list.length) % list.length
    setSelectedID(list[next]!.id)
  }

  function first(): void {
    const list = rows()
    if (list.length > 0) setSelectedID(list[0]!.id)
  }

  function last(): void {
    const list = rows()
    if (list.length > 0) setSelectedID(list[list.length - 1]!.id)
  }

  function page(delta: number): void {
    const target = layout().split || pane() === "detail" ? detailScroll : listScroll
    target?.scrollBy(delta * 10)
  }

  async function choose(): Promise<void> {
    const agent = selected()
    if (agent === undefined) return
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
    const agent = selected()
    if (agent === undefined) return
    if (!agent.canRestore) {
      showFeedback({ tone: "info", message: `${agent.name} 没有团队模型覆盖，无需恢复。` })
      return
    }
    if (restoring()) return
    setFeedback(undefined)
    setPendingRestore(agent)
    if (searchInput !== undefined && !searchInput.isDestroyed) searchInput.blur()
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
          else void choose()
        },
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
        <Header
          theme={theme()}
          layout={layout()}
          pane={pane()}
          confirming={pendingRestore() !== undefined}
        />
        <Show when={!layout().minimal}>
          <box height={1} />
          <Divider theme={theme()} />
        </Show>

        <Banners
          theme={theme()}
          agentsSupported={props.agentsSupported}
          {...(props.agentsError === undefined ? {} : { agentsError: props.agentsError })}
          modelError={modelError()}
          warning={props.warning}
        />

        <box paddingTop={1} flexShrink={0}>
          <SearchField
            theme={theme()}
            query={query()}
            inputRef={(value) => {
              searchInput = value
              scheduleFocusSearch()
            }}
            onFocus={focusSearch}
            onInput={(value) => setQuery(value)}
          />
        </box>

        <box flexGrow={1} minHeight={0} flexDirection="row">
          <Show when={showList()}>
            <ListPane
              theme={theme()}
              groups={groups()}
              selectedID={selected()?.id}
              compact={layout().compact}
              width={split() ? layout().listWidth : undefined}
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
          split={split()}
          pane={pane()}
          agent={agent()}
          confirming={pendingRestore() !== undefined}
        />
      </Show>
    </box>
  )
}

function Header(props: {
  readonly theme: Theme
  readonly layout: ReturnType<typeof layoutFor>
  readonly pane: "list" | "detail"
  readonly confirming: boolean
}) {
  const escapeLabel = () => {
    if (props.confirming) return "ESC 取消"
    if (!props.layout.split && props.pane === "detail") return "ESC 返回"
    return "ESC 关闭"
  }
  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" justifyContent="space-between" gap={2}>
        <box flexDirection="row" gap={2}>
          <text fg={props.theme.text.base} attributes={TextAttributes.BOLD}>
            Agent Team
          </text>
          <text fg={props.theme.text.muted}>团队管理</text>
        </box>
        <text fg={props.theme.text.muted}>{escapeLabel()}</text>
      </box>
      <Show when={!props.layout.minimal}>
        <text fg={props.theme.text.muted}>模型策略只覆盖子代理</text>
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
  readonly compact: boolean
  readonly width?: number
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
                <box paddingTop={index() === 0 ? 0 : 1} paddingLeft={1}>
                  <text fg={props.theme.text.muted} attributes={TextAttributes.BOLD}>
                    {group.title}
                  </text>
                </box>
                <For each={group.agents}>
                  {(agent) => {
                    const active = () => agent.id === props.selectedID
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
                            {active() ? "▌" : " "}
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
                            fg={
                              active()
                                ? props.theme.text.base
                                : toneColor(props.theme, statusTone(agent.status))
                            }
                          >
                            {agent.statusLabel}
                          </text>
                        </box>
                        <Show when={!props.compact && agent.status === "custom"}>
                          <box flexDirection="row" gap={1} paddingLeft={2}>
                            <text
                              flexGrow={1}
                              wrapMode="word"
                              fg={rowSecondary(props.theme, active())}
                            >
                              {agent.modelLabel}
                            </text>
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
  readonly compact: boolean
  readonly onScrollRef: (value: ScrollBoxRenderable) => void
}) {
  return (
    <box flexGrow={1} minWidth={0} minHeight={0} paddingLeft={2}>
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
                    text={agent().statusLabel}
                    tone={statusTone(agent().status)}
                  />
                </box>
              </box>

              <box
                flexDirection="column"
                backgroundColor={props.theme.background.raised.high}
                border={["left"]}
                borderColor={selectedRowAccent(props.theme)}
                paddingLeft={1}
                paddingRight={1}
                paddingTop={1}
                paddingBottom={1}
              >
                <text fg={selectedRowAccent(props.theme)} attributes={TextAttributes.BOLD}>
                  当前模型
                </text>
                <text fg={props.theme.text.base} attributes={TextAttributes.BOLD} wrapMode="word">
                  {agent().modelLabel}
                </text>
                <text fg={props.theme.text.muted} wrapMode="word">
                  来源：{agent().sourceLabel}
                  {agent().source === "none"
                    ? ""
                    : ` · ${agent().teamModel ?? agent().hostModel ?? ""}`}
                  {" · "}变体：{agent().variantLabel}
                </text>
                <Show when={agent().mode === "primary"}>
                  <text fg={props.theme.text.muted} wrapMode="word">
                    主代理模型由 OpenCode 会话选择，团队策略不能覆盖；此处只读展示。
                  </text>
                </Show>
              </box>

              <Show when={!props.compact}>
                <text fg={props.theme.text.muted} wrapMode="word">
                  {agent().description ?? "宿主未提供角色说明。"}
                </text>
              </Show>

              <Divider theme={props.theme} />

              <Section theme={props.theme} title="权限 / PERMISSIONS">
                <text fg={props.theme.text.muted} wrapMode="word">允许 <span style={{ fg: toneColor(props.theme, "neutral") }}>{agent().permissions.allow}</span> · 询问 <span style={{ fg: props.theme.text.feedback.warning.base }}>{agent().permissions.ask}</span> · 拒绝 <span style={{ fg: props.theme.text.feedback.error.base }}>{agent().permissions.deny}</span>（共 {agent().permissions.total} 条生效规则）</text>
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
                <text fg={props.theme.text.muted} wrapMode="word">
                  规则效果摘要，不代表沙箱；Shell 仍可能写文件。完整合并顺序见宿主策略。
                </text>
              </Section>

              <Section theme={props.theme} title="SYSTEM PROMPT · 只读">
                <Show
                  when={agent().prompt.available}
                  fallback={
                    <text fg={props.theme.text.feedback.warning.base} wrapMode="word">
                      {agent().prompt.reason}
                    </text>
                  }
                >
                  <text fg={props.theme.text.base} wrapMode="word">
                    {agent().prompt.text}
                  </text>
                </Show>
              </Section>
            </box>
          </scrollbox>
        )}
      </Show>
    </box>
  )
}

function Footer(props: {
  readonly theme: Theme
  readonly minimal: boolean
  readonly split: boolean
  readonly pane: "list" | "detail"
  readonly agent?: DashboardAgent
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
    if (props.minimal) {
      return [
        { key: "↑↓", label: "选择" },
        { key: "ESC", label: "关闭" },
      ]
    }
    if (!props.split && props.pane === "list") {
      return [
        { key: "↑↓", label: "选择" },
        { key: "Enter", label: "详情" },
        { key: "ESC", label: "关闭" },
      ]
    }
    if (!props.split) {
      return [
        { key: "Enter", label: enter() },
        { key: "Ctrl+R", label: "恢复原生" },
        { key: "ESC", label: "返回" },
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
      border={["top"]}
      borderColor={props.theme.border.base}
      paddingTop={1}
    >
      <Hints theme={props.theme} hints={hints()} />
    </box>
  )
}

/**
 * 搜索框常驻并默认聚焦，直接输入即过滤；不再有进入/退出搜索的模式，
 * 因此列表导航只保留方向键，单字母按键都作为查询输入。
 */
function SearchField(props: {
  readonly query: string
  readonly theme: Theme
  readonly inputRef: (value: InputRenderable) => void
  readonly onFocus: () => void
  readonly onInput: (value: string) => void
}) {
  return (
    <box
      flexDirection="row"
      gap={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.theme.background.formfield.focused}
      onMouseDown={props.onFocus}
    >
      <text fg={props.theme.text.formfield.focused}>搜索</text>
      <input
        flexGrow={1}
        value={props.query}
        onInput={props.onInput}
        placeholder="Agent 名称 / 角色 / 模型…"
        placeholderColor={props.theme.text.muted}
        focusedBackgroundColor={props.theme.background.formfield.focused}
        focusedTextColor={props.theme.text.formfield.focused}
        cursorColor={props.theme.text.formfield.focused}
        ref={props.inputRef}
      />
    </box>
  )
}

function effectLabel(effect: PermissionEffect): string {
  if (effect === "allow") return "允许"
  if (effect === "deny") return "拒绝"
  return "询问"
}
