/** @jsxImportSource @opentui/solid */
import { TextAttributes, type InputRenderable } from "@opentui/core"
import type { Plugin } from "@opencode/plugin/tui"
import { For, Show, type JSX } from "solid-js"

import type { Feedback, Tone } from "./model.ts"

export type { Tone } from "./model.ts"
export { effectTone } from "./model.ts"

export type Theme = Plugin.Context["theme"]
export type KeymapLayer = ReturnType<Parameters<Plugin.Context["keymap"]["layer"]>[0]>
export type Hint = {
  readonly key: string
  readonly label: string
  /** 当前面板的主要操作：用强调色与加粗，让它在快捷键列表里优先被看到。 */
  readonly emphasis?: boolean
}

export function toneColor(theme: Theme, tone: Tone) {
  if (tone === "neutral") return theme.text.muted
  if (tone === "accent") return theme.text.action.primary.selected
  return theme.text.feedback[tone].base
}

/**
 * 原生选择器用 accent 色阶做分组标题（默认主题是紫色），这里沿用同一来源，
 * 不另造强调色，浅色/深色都由主题解析。
 */
export function providerTitleColor(theme: Theme) {
  return theme.hue.accent[200]
}

/**
 * 选中行统一使用抬升表面和强调色指示条，不再用整行主操作色填充；
 * 当前操作区域由面板边框或标题表示，避免多个区域同时高饱和。
 */
export function rowBackground(theme: Theme, selected: boolean) {
  return selected ? theme.background.raised.high : undefined
}

export function rowForeground(theme: Theme) {
  return theme.text.base
}

export function rowSecondary(theme: Theme, selected: boolean) {
  return selected ? theme.text.base : theme.text.muted
}

export function rowMarker(theme: Theme, selected: boolean) {
  // 指示条统一使用宿主选中强调色；强选中背景本身就是该强调色时自然融入原生选中态。
  return selected ? theme.text.action.primary.selected : theme.text.faint
}

export function selectedRowAccent(theme: Theme) {
  return theme.text.action.primary.selected
}

/**
 * 模型配置的两层面板：聚焦面板用抬升表面，失焦面板回到对话背景。
 * 行选中再单独用 selected/focused 决定强弱，避免与“当前生效”的文字标记混用。
 */
export function panelRowBackground(theme: Theme, selected: boolean, focused: boolean) {
  if (!selected) return undefined
  return focused ? theme.background.raised.high : theme.background.raised.base
}

export function panelRowMarker(theme: Theme, selected: boolean, focused: boolean) {
  if (!selected) return theme.text.faint
  return focused ? theme.text.base : theme.text.muted
}

export function Divider(props: { readonly theme: Theme }) {
  return <box height={1} flexShrink={0} border={["bottom"]} borderColor={props.theme.border.base} />
}

/**
 * 两个视图共用同一标题结构：App 名 + 当前页 + 右侧退出提示。
 * 标题只保留一级层级，不再重复副标题。
 */
export function ViewHeader(props: {
  readonly theme: Theme
  readonly section: string
  readonly right: string
}) {
  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" justifyContent="space-between" gap={2}>
        <box flexDirection="row" gap={1}>
          <text fg={props.theme.text.base} attributes={TextAttributes.BOLD}>
            Agent Team
          </text>
          <text fg={props.theme.text.faint}>/</text>
          <text fg={props.theme.text.base}>{props.section}</text>
        </box>
        <text fg={props.theme.text.muted} flexShrink={0}>
          {props.right}
        </text>
      </box>
      <Divider theme={props.theme} />
    </box>
  )
}

/** 分组标题统一右侧计数，避免把数量塞进标题文本后难以对齐。 */
export function GroupHeader(props: {
  readonly theme: Theme
  readonly title: string
  readonly count?: number
  readonly accent?: boolean
}) {
  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      gap={2}
      paddingLeft={1}
      paddingRight={1}
      flexShrink={0}
    >
      <text
        flexGrow={1}
        overflow="hidden"
        wrapMode="none"
        fg={props.accent === true ? providerTitleColor(props.theme) : props.theme.text.muted}
        attributes={TextAttributes.BOLD}
      >
        {props.title}
      </text>
      <Show when={props.count !== undefined}>
        <text flexShrink={0} fg={props.theme.text.muted}>
          {props.count}
        </text>
      </Show>
    </box>
  )
}

/** 详情区分节：分隔线 + 标题，标题可选右侧状态。 */
export function SectionHeading(props: {
  readonly theme: Theme
  readonly title: string
  readonly right?: JSX.Element
  readonly first?: boolean
}) {
  return (
    <box flexDirection="column" flexShrink={0}>
      <Show when={props.first !== true}>
        <Divider theme={props.theme} />
      </Show>
      <box flexDirection="row" justifyContent="space-between" gap={2}>
        <text fg={props.theme.text.muted} attributes={TextAttributes.BOLD}>
          {props.title}
        </text>
        {props.right}
      </box>
    </box>
  )
}

/** 搜索框常驻：左侧标签表示用途，右侧可放数量或范围提示。 */
export function SearchBar(props: {
  readonly theme: Theme
  readonly value: string
  readonly placeholder: string
  readonly focused: boolean
  readonly right?: string
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
      flexShrink={0}
      backgroundColor={
        props.focused ? props.theme.background.formfield.focused : props.theme.background.raised.base
      }
      onMouseDown={props.onFocus}
    >
      <text
        flexShrink={0}
        fg={props.focused ? props.theme.text.formfield.focused : props.theme.text.muted}
      >
        搜索
      </text>
      <input
        flexGrow={1}
        value={props.value}
        onInput={props.onInput}
        placeholder={props.placeholder}
        placeholderColor={props.theme.text.muted}
        focusedBackgroundColor={props.theme.background.formfield.focused}
        focusedTextColor={props.theme.text.formfield.focused}
        cursorColor={props.theme.text.formfield.focused}
        ref={props.inputRef}
      />
      <Show when={props.right !== undefined}>
        <text flexShrink={0} fg={props.theme.text.muted}>
          {props.right}
        </text>
      </Show>
    </box>
  )
}

/** 开关状态用文本芯片表达，避免依赖圆点字符宽度和主题对比度假设。 */
export function ToggleChip(props: { readonly theme: Theme; readonly on: boolean }) {
  return (
    <box
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={
        props.on
          ? props.theme.background.feedback.success.base
          : props.theme.background.raised.max
      }
    >
      <text
        fg={props.on ? props.theme.text.feedback.success.base : props.theme.text.muted}
        attributes={TextAttributes.BOLD}
      >
        {props.on ? "开启" : "关闭"}
      </text>
    </box>
  )
}

export interface LegendItem {
  readonly value: string
  readonly label: string
  readonly tone: Tone
}

/** 底部状态图例：颜色只负责语义，文字负责解释，避免只靠颜色传达状态。 */
export function Legend(props: { readonly theme: Theme; readonly items: readonly LegendItem[] }) {
  return (
    <box flexDirection="row" gap={2} flexWrap="wrap">
      <For each={props.items}>
        {(item) => (
          <text>
            <span style={{ fg: toneColor(props.theme, item.tone) }}>{item.value}</span>
            <span style={{ fg: props.theme.text.muted }}> {item.label}</span>
          </text>
        )}
      </For>
    </box>
  )
}


/**
 * 面板内滚动条放在右侧预留列，使用主题 scrollbar 色，常驻显示以提示内容可滚动。
 * 绝对定位避免出现/消失时改变内容宽度。
 */
export function scrollbarOptions(theme: Theme) {
  return {
    position: "absolute" as const,
    right: 0,
    top: 0,
    width: 1,
    height: "100%" as const,
    trackOptions: {
      backgroundColor: theme.background.raised.base,
      foregroundColor: theme.scrollbar.base,
    },
  }
}

export function Badge(props: {
  readonly theme: Theme
  readonly text: string
  readonly tone: Tone
}) {
  return (
    <box
      // 用主题自身的高低阶推导 chip 背景，深色/浅色都不需要硬编码。
      backgroundColor={props.theme.decrease(props.theme.background.base)}
      paddingLeft={1}
      paddingRight={1}
      flexShrink={0}
    >
      <text fg={toneColor(props.theme, props.tone)}>{props.text}</text>
    </box>
  )
}

export function Hints(props: { readonly theme: Theme; readonly hints: readonly Hint[] }) {
  return (
    <box flexDirection="row" gap={2} flexWrap="wrap">
      <For each={props.hints}>
        {(hint) => (
          <Show
            when={hint.emphasis === true}
            fallback={
              <text fg={props.theme.text.muted}>
                <span style={{ fg: props.theme.text.base }}>{hint.key}</span> {hint.label}
              </text>
            }
          >
            <text fg={selectedRowAccent(props.theme)} attributes={TextAttributes.BOLD}>
              {hint.key} {hint.label}
            </text>
          </Show>
        )}
      </For>
    </box>
  )
}

/**
 * Modal 内状态栏：普通状态紧凑一行，错误可换行展示完整内容。
 * 作为独立布局行放在快捷键栏上方，不覆盖模型列表、搜索或 Variant。
 */
export function FeedbackBar(props: { readonly theme: Theme; readonly feedback: Feedback }) {
  const color = () => toneColor(props.theme, props.feedback.tone)
  const marker = () => {
    if (props.feedback.tone === "success") return "✓"
    if (props.feedback.tone === "info") return "·"
    return "!"
  }
  return (
    <box
      flexShrink={0}
      flexDirection="row"
      gap={1}
      border={["top"]}
      borderColor={color()}
    >
      <text flexShrink={0} fg={color()} attributes={TextAttributes.BOLD}>
        {marker()}
      </text>
      <text flexGrow={1} fg={color()} wrapMode="word">
        {props.feedback.message}
      </text>
    </box>
  )
}

/** 需要确认的破坏性操作留在当前 Modal，不打开第二个宿主弹窗。 */
export function ConfirmBar(props: { readonly theme: Theme; readonly message: string }) {
  return (
    <box
      flexShrink={0}
      border={["top"]}
      borderColor={props.theme.text.feedback.warning.base}
    >
      <text fg={props.theme.text.feedback.warning.base} wrapMode="word">
        {props.message}
      </text>
    </box>
  )
}
