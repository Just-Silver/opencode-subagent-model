<!-- 职责：用户可见版本变更历史；不写：完整实现、安装与发版流程。 -->

# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.2] - 2026-11-11

### Changed

- 弹窗标题改为两行：第一行说明这是全局的当前选择，第二行单独显示当前模型与变体，
  不再把信息挤在一行里。

## [0.1.1] - 2026-11-10

### Fixed

- 选择弹窗标题不再重复显示同一模型（可读名称与 `provider/model#variant` 同时出现），
  模型不可用时才回显原引用。
- 选择弹窗加宽，标题与「名称 — 完整引用」不再挤成多行。

## [0.1.0] - 2026-11-10

### Added

- 独立插件：`/subagent-model` 全局模型与变体选择、持久策略、执行前强制覆盖。
- 工具成功返回末尾告知本次强制模型，保留前台/后台、并发与失败边界。
- server / TUI / RPC 三入口与 npm 包形态，无运行时依赖。

### Migration

- 从 providers 迁移时不自动继承旧设置：先停用旧覆盖，再在本插件重新选择一次模型，
  见 [README](README.md#从-providers-迁移)。

## [0.1.0-beta.0] - 2026-11-10

### Added

- 从 providers 中独立出 `/subagent-model`：全局模型与变体选择、持久策略、执行前强制覆盖。
- 工具成功返回末尾告知本次强制模型，保留前台/后台、并发与失败边界。
- 独立 server / TUI / RPC 入口与 npm 包形态，无运行时依赖。
