// npm 安装的 TUI 插件位于 node_modules 下，宿主不会对这里的 .tsx 应用 Solid 转换
// （anomalyco/opencode#39986），因此发布前把 TUI 依赖图预编译成 .js，让 JSX 运行时
// 导入以普通 import 形式存在，从而被宿主的运行时改写覆盖到。
import { transformSync } from "@babel/core"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const sourceRoot = path.join(root, "plugin", "opencode-team")
const outputRoot = path.join(root, "dist")
const entry = "tui.ts"

const compiled = new Set()

function isRelative(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../")
}

function resolveRelative(from, specifier) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
}

function outputFile(relative) {
  return path.join(outputRoot, relative.replace(/\.tsx?$/, ".js"))
}

function withJsExtension(relative) {
  return relative.replace(/\.tsx?$/, ".js")
}

function compile(relative) {
  if (compiled.has(relative)) return
  compiled.add(relative)

  const filename = path.join(sourceRoot, relative)
  const source = readFileSync(filename, "utf8")
  const jsx = relative.endsWith(".tsx")
  const dependencies = new Set()

  // Solid 的编译产物必须显式引用宿主运行时；相对导入统一改成 .js，避免产物再指向源码。
  const rewriteImports = () => ({
    visitor: {
      ImportDeclaration(nodePath) {
        rewrite(nodePath.node.source)
      },
      ExportNamedDeclaration(nodePath) {
        if (nodePath.node.source) rewrite(nodePath.node.source)
      },
      ExportAllDeclaration(nodePath) {
        rewrite(nodePath.node.source)
      },
    },
  })

  const rewrite = (sourceNode) => {
    const specifier = sourceNode.value
    if (!isRelative(specifier)) return
    const resolved = resolveRelative(relative, specifier)
    dependencies.add(resolved)
    sourceNode.value = withJsExtension(
      path.posix.relative(path.posix.dirname(relative), resolved).startsWith(".")
        ? path.posix.relative(path.posix.dirname(relative), resolved)
        : `./${path.posix.relative(path.posix.dirname(relative), resolved)}`,
    )
  }

  const result = transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    sourceMaps: false,
    presets: [
      ["@babel/preset-typescript", { allExtensions: true, isTSX: jsx }],
      ...(jsx ? [["babel-preset-solid", { moduleName: "@opentui/solid", generate: "universal" }]] : []),
    ],
    plugins: [rewriteImports],
  })

  if (result?.code === undefined) throw new Error(`没有生成编译结果：${relative}`)

  const outfile = outputFile(relative)
  mkdirSync(path.dirname(outfile), { recursive: true })
  writeFileSync(outfile, `${result.code}\n`)

  for (const dependency of dependencies) compile(dependency)
}

rmSync(outputRoot, { recursive: true, force: true })
compile(entry)

const leftovers = [...compiled].filter((file) => !/\.(?:ts|tsx)$/.test(file))
if (leftovers.length > 0) throw new Error(`无法识别的依赖：${leftovers.join(", ")}`)

process.stdout.write(`已编译 ${compiled.size} 个 TUI 模块到 dist/\n`)
