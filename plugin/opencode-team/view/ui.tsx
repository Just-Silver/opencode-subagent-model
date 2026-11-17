/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import type { Plugin } from "@opencode/plugin/tui"
import { For, type JSX } from "solid-js"

export type Theme = Plugin.Context["theme"]
export type KeymapLayer = ReturnType<Parameters<Plugin.Context["keymap"]["layer"]>[0]>
export type Hint = { readonly key: string; readonly label: string }

export function Divider(props: { readonly theme: Theme }) {
  return <box height={1} border={["bottom"]} borderColor={props.theme.border.base} />
}

export function Section(props: {
  readonly theme: Theme
  readonly title: string
  readonly children: JSX.Element
}) {
  return (
    <box flexDirection="column">
      <text fg={props.theme.text.faint} attributes={TextAttributes.BOLD}>
        {props.title}
      </text>
      {props.children}
    </box>
  )
}

export function Badge(props: {
  readonly theme: Theme
  readonly text: string
  readonly tone: "neutral" | "success" | "warning" | "info"
}) {
  const color = () => {
    if (props.tone === "neutral") return props.theme.text.muted
    return props.theme.text.feedback[props.tone].base
  }
  return (
    <box
      backgroundColor={props.theme.background.raised.high}
      paddingLeft={1}
      paddingRight={1}
      flexShrink={0}
    >
      <text fg={color()}>{props.text}</text>
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
