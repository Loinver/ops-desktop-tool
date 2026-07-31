---
name: app-page-layout
description: Standardize and audit Ops Desktop Vue renderer page layouts, headers, panels, forms, tables, empty states, scrolling, and responsive behavior. Use when creating or modifying any renderer view, page-level component, layout, card, toolbar, data list, or responsive CSS in this repository.
---

# Ops Desktop 通用页面布局

本 Skill 约束 `src/renderer` 中的页面结构与样式。创建页面、修改现有页面布局、卡片、筛选工具栏、表单、表格、空状态或响应式样式前，先阅读本文件和 [布局约定](references/layout-contract.md)。

## 强制工作流

1. **先复用，再新增。** 先检查 `src/renderer/assets/styles/base.css` 中的 token 和公共类，以及 `src/renderer/components/common/PageHeader.vue`。共享结构必须沉淀到公共样式或组件，不能在单页复制 `.page`、`.page-header`、`.page-title`、`.page-desc`。
2. **保持业务边界。** 仅迁移页面框架、间距、标题、操作区和面板外观；不要顺带改 IPC、数据流、权限、发布逻辑或业务状态。
3. **只保留一个页面级滚动容器。** `AppLayout.vue` 的 `.workspace` 是应用工作区的纵向滚动容器。页面根节点不得再创建同层纵向滚动；数据表、日志、代码编辑器等局部区域可按需使用有限高度的局部滚动。
4. **使用布局合约。** 采用下方 DOM 结构或语义等价结构；新增 CSS 使用已有 `var(--...)` token，避免无理由的像素魔数。
5. **验证。** 完成后至少执行 `git diff --check`、`pnpm test`、`pnpm build`。涉及滚动、长列表或窄窗口时，额外手工确认没有双滚动、内容截断或操作区溢出。

## 页面 DOM 合约

```vue
<div class="page">
  <header class="page-header">
    <div class="page-heading">
      <div v-if="eyebrow" class="page-eyebrow">可选分类</div>
      <h2 class="page-title">页面标题</h2>
      <p class="page-desc">简短说明页面用途或当前状态。</p>
    </div>
    <div class="page-actions">
      <!-- 页面级操作：刷新、创建、保存等 -->
    </div>
  </header>

  <main class="page-content">
    <section class="surface-panel page-section">
      <div class="section-heading">
        <h3 class="section-title">区块标题</h3>
        <p class="section-desc">可选说明</p>
      </div>
      <!-- 业务内容 -->
    </section>
  </main>
</div>
```

- `.page`：只提供页面内边距与最小尺寸；不承担页面级 `overflow-y: auto`。
- `.page-header`：标题区与页面级操作区。窄屏下自动纵向排列。
- `.page-heading`：标题、说明的容器；需允许文本收缩，避免长标题挤压操作区。
- `.page-actions`：使用 `flex` 自动换行；按钮高度与间距使用全局 token。
- `.page-content`：页面内容的统一垂直节奏。所有主区块均放在此容器中。
- `.surface-panel`：白色内容面板的基础外观；需要内边距时叠加 `page-section` 或页面业务类。

## 视觉与响应式规则

- 页面统一使用 `--page-padding-*`、`--page-header-gap`、`--content-gap`、`--panel-padding`、`--header-control-height` 等 token。
- 页面标题统一使用 `.page-title`，描述使用 `.page-desc`；不要为普通页面标题重设不同字号、字重或行高。
- 筛选、搜索和主操作放在标题右侧的 `.page-actions` 或首个内容区的工具栏；不要把同一类页面操作分散到多个位置。
- 卡片与区块优先使用 `.surface-panel`。仅当有明确的语义（危险操作、运行状态、日志终端等）时再添加页面私有变体。
- 表格、代码、日志等数据密集内容必须允许横向/局部滚动，且不能突破页面内容宽度。
- 在小于约 `760px` 的窗口中，页头、操作区、筛选工具栏必须能换行或纵向排列；不要依赖固定宽度使按钮或输入框溢出。
- 需要视觉差异时，优先使用修饰类（如 `.page--workspace`、`.surface-panel--warning`），不要覆盖公共基础类。

## 迁移检查清单

- [ ] 页面根节点使用 `.page`，内容已放入 `.page-content`（允许明确说明的例外）。
- [ ] 复用了公共页头类或 `PageHeader.vue`，未在 scoped CSS 中重复定义基础页头规则。
- [ ] 共享卡片、间距和控件高度使用全局 token。
- [ ] 页面没有与 `.workspace` 竞争的纵向滚动。
- [ ] 长标题、长标签、空状态、大表格与窄窗口可用。
- [ ] 未改变业务逻辑，并已通过格式、测试和构建校验。
