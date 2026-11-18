#!/usr/bin/env node
/**
 * 从 prompts/*.md 生成 prompts.generated.ts（本仓的「提示词单一来源」= Markdown）。
 *
 *   node scripts/build-prompts.mjs gen     # 生成
 *   node scripts/build-prompts.mjs check   # 校验生成物与 Markdown 同步，不写文件
 *
 * 约定：Markdown 以 YAML Frontmatter 开头，只允许 `description`；Frontmatter 之后的内容
 * 原样作为 System Prompt。Frontmatter 内的 `#` 注释只用于文档说明，不进入任何字段。
 */

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SOURCE_DIR = "plugin/opencode-team/prompts"
const OUTPUT = "plugin/opencode-team/prompts.generated.ts"

const ENTRIES = [
  { file: "orchestrator.md", constant: "ORCHESTRATOR_PROMPT" },
  { file: "qa.md", constant: "QA_PROMPT" },
  { file: "reviewer.md", constant: "REVIEWER_PROMPT" },
]

function invalid(file, message) {
  throw new Error(`${file}: ${message}`)
}

function parseValue(raw, file, lineNumber) {
  const value = raw.trim()
  if (value === "") invalid(file, `Frontmatter 第 ${lineNumber} 行的 description 为空`)
  if (value.startsWith('"')) {
    if (value.length < 2 || !value.endsWith('"')) invalid(file, `Frontmatter 第 ${lineNumber} 行的 description 引号未闭合`)
    try {
      return JSON.parse(value)
    } catch {
      invalid(file, `Frontmatter 第 ${lineNumber} 行的 description 双引号格式非法`)
    }
  }
  if (value.startsWith("'")) {
    if (value.length < 2 || !value.endsWith("'")) invalid(file, `Frontmatter 第 ${lineNumber} 行的 description 引号未闭合`)
    return value.slice(1, -1).replace(/''/g, "'")
  }
  return value
}

/** 解析一份角色 Markdown，返回 { description, system }。格式问题一律抛错。 */
export function parsePrompt(source, file = "prompt.md") {
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")
  if (!text.startsWith("---\n")) invalid(file, "缺少 YAML Frontmatter（文件必须以 `---` 开头）")

  const end = text.indexOf("\n---\n", 3)
  if (end === -1) invalid(file, "缺少 Frontmatter 结束标记 `---`")

  const meta = {}
  for (const [index, raw] of text.slice(4, end).split("\n").entries()) {
    const line = raw.trim()
    if (line === "" || line.startsWith("#")) continue
    const match = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line)
    if (match === null) invalid(file, `Frontmatter 第 ${index + 1} 行不是 key: value 格式：${raw}`)
    const [, key, value] = match
    if (key !== "description") invalid(file, `未知 Frontmatter 字段：${key}（只支持 description）`)
    if (key in meta) invalid(file, "Frontmatter 重复定义 description")
    meta[key] = parseValue(value, file, index + 1)
  }

  if (meta.description === undefined) invalid(file, "Frontmatter 缺少 description")
  if (meta.description.trim() === "") invalid(file, "Frontmatter 的 description 为空")

  const system = text.slice(end + 5).trim()
  if (system === "") invalid(file, "Frontmatter 之后的 System Prompt 正文为空")

  return { description: meta.description, system }
}

/** 读取并解析全部角色 Markdown；文件缺失或格式非法时抛错。 */
export function readPrompts() {
  return ENTRIES.map(({ file, constant }) => {
    const relative = `${SOURCE_DIR}/${file}`
    let source
    try {
      source = readFileSync(resolve(ROOT, relative), "utf8")
    } catch (error) {
      throw new Error(`${relative}: 无法读取（${error instanceof Error ? error.message : String(error)}）`)
    }
    const { description, system } = parsePrompt(source, relative)
    return { constant, description, system }
  })
}

function templateLiteral(text) {
  return `\`${text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\``
}

/** 渲染生成文件内容。输入相同时输出逐字节相同。 */
export function renderPrompts(entries) {
  const lines = [
    "// 由 scripts/build-prompts.mjs 从 prompts/*.md 生成，请勿手改；修改内容请改 Markdown 后运行 npm run build:prompts。",
    "",
    "export interface GeneratedTeamPrompt {",
    "  readonly description: string",
    "  readonly system: string",
    "}",
    "",
  ]
  for (const { constant, description, system } of entries) {
    lines.push(`export const ${constant}: GeneratedTeamPrompt = {`)
    lines.push(`  description: ${JSON.stringify(description)},`)
    lines.push(`  system: ${templateLiteral(system)},`)
    lines.push("}")
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

function firstDifference(expected, actual) {
  const left = expected.split("\n")
  const right = actual.split("\n")
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) {
      return `首个差异在第 ${index + 1} 行\n  期望：${left[index] ?? "(文件结束)"}\n  实际：${right[index] ?? "(文件结束)"}`
    }
  }
  return "内容长度不同但未定位到差异"
}

function fail(message) {
  console.error(`::error::${message}`)
  process.exit(1)
}

function main() {
  const [command] = process.argv.slice(2)
  const expected = renderPrompts(readPrompts())
  const path = resolve(ROOT, OUTPUT)

  if (command === "gen") {
    writeFileSync(path, expected)
    console.log(`✓ 已生成 ${OUTPUT}`)
    return
  }

  if (command === "check") {
    let actual
    try {
      actual = readFileSync(path, "utf8")
    } catch {
      fail(`${OUTPUT} 不存在，请先运行 npm run build:prompts`)
    }
    if (actual !== expected) fail(`${OUTPUT} 与 Markdown 不同步，请运行 npm run build:prompts\n${firstDifference(expected, actual)}`)
    console.log(`✓ ${OUTPUT} 与 Markdown 一致`)
    return
  }

  fail(`未知子命令：${command ?? "(空)"}（支持 gen / check）`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}
