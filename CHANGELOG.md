# Ops Desktop Changelog

## [1.0.2] - 2026-08-03
### Added
- 应用图标（icns / ico / png）
- CI/CD 流水线修复（pnpm/action-setup）
- 404 catch-all 路由
- 渲染层全局错误处理与错误边界
- 主进程结构化日志（logs/ 目录）
- 主进程 uncaughtException / unhandledRejection 捕获
- ESLint + Prettier 代码规范配置
- 暗色模式

### Changed
- 统一质量门禁：Prettier、ESLint、Node / Renderer 测试与 Playwright Electron E2E
- Renderer IPC 统一经由 `opsApi` 适配层访问，并增加静态边界检查
- 拆分系统发布、AI 运维、AI 图像页面样式，以及模型测试的持久化与快捷键逻辑
- TDesign 消息组件改为按需导入，生产 CSS 从约 448 KB 降至约 4 KB

### Fixed
- 修复 Windows 默认缺少 `sqlite3` 时无法读取 cc-switch 配置的问题，并兼容 APPDATA 与自定义数据目录
- 修复 Electron E2E 在首次进入系统发布页时被 SFTP 配置引导遮挡导航的问题
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
