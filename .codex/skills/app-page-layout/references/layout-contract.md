# Ops Desktop 页面布局约定参考

## 规范来源

- 全局 token 与基础布局：`src/renderer/assets/styles/base.css`
- 工作区滚动容器：`src/renderer/components/layout/AppLayout.vue`
- 统一页头组件：`src/renderer/components/common/PageHeader.vue`
- 业务页面：`src/renderer/views/**/index.vue`

## 基础职责

| 层级 | 职责 | 不应承担的职责 |
| --- | --- | --- |
| `.workspace` | 应用工作区的唯一页面级纵向滚动 | 单页业务布局、卡片视觉 |
| `.page` | 内边距、页面最小尺寸、透明背景 | 第二个页面级纵向滚动 |
| `.page-header` | 标题、描述、页面级操作的对齐与响应式 | 具体业务的表单/筛选逻辑 |
| `.page-content` | 主区块的统一垂直间距 | 业务卡片的具体网格列数 |
| `.surface-panel` | 标准面板的边框、圆角、背景、阴影 | 特殊业务状态的全部样式 |
| `.page-section` | 标准面板内容的间距 | 复杂业务组件内部布局 |

## 页面变体

### 数据概览页

使用页头 + 统计/筛选区域 + 数据面板。筛选和刷新等全局操作放在 `.page-actions`；表格自身可有横向滚动容器。

### 表单与发布页

使用页头 + 分段面板。主要保存、发布操作既可放 `.page-actions`，也可放在关联表单底部；同一操作不要重复出现。

### 工作区与对话页

保留业务需要的分栏和局部滚动，但外层仍遵守 `.page` / `.page-header` / `.page-content`，不要让业务工作区造成额外的整页纵向滚动。

## 迁移步骤

1. 找到 scoped CSS 中重复的 `.page`、`.page-header`、`.page-title`、`.page-desc`、`.header-actions`。
2. 先在 `base.css` 或 `PageHeader.vue` 中补齐真正公共的能力，再删除单页重复定义。
3. 将页面级操作区统一为 `.page-actions`；若保留旧类，必须同时挂公共类以平滑迁移。
4. 让每个页面的主要区块进入 `.page-content`，并优先复用 `.surface-panel` / `.page-section`。
5. 测试长内容、表格、日志、窄窗口以及路由切换后的滚动行为。

## 验证命令

```bash
git diff --check
pnpm test
pnpm build
```

本规范仅涉及 Renderer 的视觉和 DOM 布局，不放宽 Electron 主进程、preload 或 IPC 安全边界。
