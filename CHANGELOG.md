<!-- 职责：用户可见版本变更历史；不写：完整实现、安装与发版流程。 -->

# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
