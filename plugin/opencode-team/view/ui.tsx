/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import type { Plugin } from "@opencode/plugin/tui"
import { For, type JSX } from "solid-js"

import type { Feedback, Tone } from "./model.ts"

export type { Tone } from "./model.ts"
export { effectTone, statusTone } from "./model.ts"

export type Theme = Plugin.Context["theme"]
export type KeymapLayer = ReturnType<Parameters<Plugin.Context["keymap"]["layer"]>[0]>
export type Hint = { readonly key: string; readonly label: string }

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

export function Divider(props: { readonly theme: Theme }) {
  return <box height={1} flexShrink={0} border={["bottom"]} borderColor={props.theme.border.base} />
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

export function Section(props: {
  readonly theme: Theme
  readonly title: string
  readonly children: JSX.Element
}) {
  return (
    <box flexDirection="column">
      <text fg={props.theme.text.muted} attributes={TextAttributes.BOLD}>
        {props.title}
      </text>
      {props.children}
    </box>
  )
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
          <text fg={props.theme.text.muted}>
            <span style={{ fg: props.theme.text.base }}>{hint.key}</span> {hint.label}
          </text>
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
