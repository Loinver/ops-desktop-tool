# Contributing Guide

## 贡献指南

### 1. 代码风格
- 使用 ESLint + Prettier（已在项目中配置）
- 遵循 `ARCHITECTURE.md` 中的分层架构
- 严格遵守 IPC 白名单与安全校验

### 2. 开发流程
1. 拉取最新 `main` 分支
2. 创建功能分支 `feature/xxx` 或 `bugfix/xxx`
3. 编写对应单元测试
4. 运行 `pnpm check`（包含 Prettier、lint、Node/Renderer 测试、Electron E2E 和生产构建）
5. 提交时附带描述性 commit message

### 3. 构建与测试
```bash
pnpm install
pnpm test          # Node、Renderer 与边界检查
pnpm test:e2e      # Playwright Electron 冒烟测试
pnpm verify        # Prettier + ESLint + 全部测试
pnpm check         # verify + 生产构建
pnpm electron:build:mac
```

Linux CI 通过 `xvfb-run` 运行 Electron E2E；本地无图形会话时也应使用等效的虚拟显示环境。

### 4. 文档要求
- 新功能必须更新 `README.md` 或 `ARCHITECTURE.md`
- 新增功能必须有对应测试用例
- 更新 `CHANGELOG.md`

### 5. 提交 PR
- PR 必须通过所有 CI 检查
- 描述必须包含：
  - 问题描述
  - 解决方案
  - 影响范围
  - 测试用例

### 6. 代码审查
PR 必须至少由 1 人审查通过后才能合并。
