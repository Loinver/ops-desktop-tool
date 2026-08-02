# Ops Desktop Changelog

## [1.0.2] - 2026-08-02
### Added
- 应用图标（icns / ico / png）
- CI/CD 流水线修复（pnpm/action-setup）
- 404 catch-all 路由
- 渲染层全局错误处理与错误边界
- 主进程结构化日志（logs/ 目录）
- 主进程 uncaughtException / unhandledRejection 捕获
- ESLint + Prettier 代码规范配置
- 暗色模式

### Fixed
- keepAlive 组件名不匹配导致 OpsControlCenter / AiOps / AiChat 缓存失效
- README.md 混入 AI 对话残留
- CI workflow 缺少 pnpm 安装步骤
- code-signing workflow 在每次 push main 时触发
- monitoring workflow 引用不存在的 test:performance 脚本
- CONTRIBUTING.md 虚假声明 ESLint + Prettier
- CHANGELOG.md 误将测试数量描述为覆盖率

## [1.0.1] - 2026-08-02
### Added
- 完整发布 Checklist
- Windows / Linux 安装说明

### Changed
- 版本号升级到 1.0.1

## [1.0.0] - 2026-07-31
### Added
- 核心运维功能（系统发布、模型可靠性、Node 服务）
- AI 能力中心
- 本机工具（快捷启动、剪贴板、备份恢复）
- 严格的安全沙箱模型

### Changed
- 架构文档完善

### Fixed
- 核心安全闭环与 IPC 边界
- 测试用例覆盖 99 项

## [0.1.0] - 2026-07-28
### Added
- Electron + Vue 3 + Vite 基础框架
- 初始版本发布
