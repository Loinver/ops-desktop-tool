# Ops Desktop 架构文档

## 1. 总览

Ops Desktop 采用标准 Electron 三层结构：

```text
Vue Renderer
    │ window.opsApi（冻结的白名单 API）
    ▼
Sandbox Preload
    │ ipcRenderer.invoke
    ▼
Electron Main / IPC handlers
    │
    ├─ 本机进程、系统、剪贴板和文件系统
    ├─ JSON 用户数据与 safeStorage
    ├─ SFTP / SSH
    └─ cc-switch SQLite（只读）与模型 HTTP 探测
```

核心原则：Renderer 不直接访问 Node.js、文件系统或 Electron 高权限 API；所有高权限操作都由主进程完成并校验输入。

## 2. 目录结构

```text
ops-desktop-tool/
├── src/
│   ├── main/
│   │   ├── ipc/
│   │   │   ├── app.js             # 应用信息、确认框、文件选择
│   │   │   ├── clipboard.js       # 剪贴板读取、写入和历史
│   │   │   ├── data-backup.js     # 加密备份、恢复、自动计划与恢复点
│   │   │   ├── gpt-image.js       # AI 生图配置、模型、生成、历史、保存
│   │   │   ├── model-test.js      # cc-switch 供应商读取和模型探测
│   │   │   ├── ports.js           # 端口扫描和进程结束
│   │   │   ├── quicklaunch.js     # 快捷启动项和安全外部启动
│   │   │   ├── sftp.js            # SFTP 浏览、比较、上传和 ZIP 部署
│   │   │   └── system.js          # 系统信息
│   │   ├── utils/
│   │   │   ├── app-data-backup.js # 加密数据备份、自动备份与恢复点
│   │   │   ├── ccswitch.js        # 只读解析 cc-switch SQLite 配置
│   │   │   ├── format.js          # 文件大小、时间、权限等格式化
│   │   │   ├── gpt-image-file.js  # 生图响应和文件名处理
│   │   │   ├── json-store.js      # JSON 原子读写和文件权限
│   │   │   ├── path-security.js   # 本地/远程路径边界校验
│   │   │   └── secure-secret.js   # safeStorage 加解密、迁移和掩码
│   │   ├── main.js                # 生命周期与 IPC 注册入口
│   │   ├── ops-auto-backup-scheduler.js # 自动数据备份的主进程调度
│   │   ├── port-manager.js        # 跨平台端口解析和进程操作
│   │   ├── preload.js             # sandbox 兼容的 IPC 白名单桥接
│   │   └── window.js              # BrowserWindow 与导航安全策略
│   ├── renderer/
│   │   ├── assets/styles/base.css # 主题变量和全局基础样式
│   │   ├── public/assets/icons/   # 构建时原样复制的本地图标 sprite
│   │   ├── components/
│   │   │   ├── common/            # 通用页面组件
│   │   │   └── layout/            # 主布局与侧边栏
│   │   ├── composables/           # Renderer 组合式逻辑
│   │   ├── router/index.js        # Hash 路由和页面懒加载
│   │   ├── stores/                # Pinia 状态模块
│   │   ├── views/
│   │   │   ├── clipboard-history/
│   │   │   ├── data-management/
│   │   │   ├── gpt-image/
│   │   │   ├── model-test/
│   │   │   ├── node-services/
│   │   │   ├── quick-launch/
│   │   │   ├── system-info/
│   │   │   └── system-release/
│   │   ├── App.vue
│   │   ├── index.html             # CSP 与 Renderer HTML 入口
│   │   └── main.js                # Vue、路由、Pinia、本地图标注册
│   └── shared/ipc-channels.js     # 主进程 IPC 通道的唯一共享定义
├── scripts/
│   ├── check-port-parser.js
│   ├── gpt-image-file.test.cjs
│   ├── ipc-channels.test.cjs
│   ├── path-security.test.cjs
│   ├── secure-secret.test.cjs
│   ├── sftp-deploy-safety.test.cjs
│   └── verify-model-test.js
├── package.json
├── vite.config.mjs
├── README.md
└── ARCHITECTURE.md
```

## 3. 进程职责

### 3.1 Main Process

主进程拥有所有高权限能力：

- 创建和管理主窗口
- 扫描端口、结束本机进程、读取系统信息
- 读取和写入剪贴板、用户数据与本地文件
- 建立 SFTP/SSH 连接并执行发布流程
- 调用 AI 服务与保存生成图片
- 只读加载 cc-switch 数据库并执行模型探测
- 使用 `safeStorage` 加密敏感凭证

所有 IPC handler 在 `app.whenReady()` 后注册，确保 `safeStorage` 已进入可用生命周期。

### 3.2 Preload

`preload.js` 在 Electron sandbox 中运行，因此只依赖 Electron 内建模块，不加载项目本地 CommonJS 模块。它通过 `contextBridge` 暴露冻结的 `window.opsApi`，每个方法只能调用固定 IPC 通道。

由于 sandbox preload 不能复用 `src/shared/ipc-channels.js`，通道字符串在 preload 内维护一份镜像；`scripts/ipc-channels.test.cjs` 自动检查两份定义是否一致，并禁止 preload 引入本地模块。

### 3.3 Renderer

Renderer 是普通 Vue Web 应用：

- 不启用 Node.js 集成
- 通过 Pinia 管理页面状态
- 通过 Vue Router Hash History 切换模块
- 页面使用动态 `import()` 懒加载
- 只通过 `window.opsApi` 请求高权限操作
- 使用本地图标 sprite；TDesign 只按需使用消息插件

应用版本由 `app:info` IPC 返回 `app.getVersion()`，侧边栏不再硬编码版本号。

## 4. IPC 设计

IPC 通道按功能域命名：

| 前缀 | 功能域 |
| --- | --- |
| `app:*` | 应用信息、确认和文件浏览 |
| `ports:*` | 端口和进程 |
| `system:*` | 系统信息 |
| `quicklaunch:*` | 快捷启动 |
| `clipboard:*` | 剪贴板 |
| `dataBackup:*` | 加密备份、自动备份、历史与恢复点 |
| `sftp:*` | 发布和远程文件 |
| `gptImage:*` | AI 生图 |
| `modelTest:*` | 模型测试 |

主进程以 `ipcMain.handle` 提供 Promise 风格接口，Preload 以 `ipcRenderer.invoke` 调用。完整名称定义见 `src/shared/ipc-channels.js`。

输入边界主要在主进程执行：

- 确认框文本和文件过滤器限制类型、数量与长度
- 外部 URL 仅允许 `http:`、`https:`、`mailto:`
- 本地路径拒绝空字节、非法类型和超长输入
- SFTP 远程路径必须为绝对路径，拒绝 `..`、空字节和超长输入
- 上传、部署、删除和创建目录拒绝远程根目录 `/`
- 部署前验证本地条目存在

## 5. 数据与凭证

### 5.1 用户数据

持久化文件位于 Electron `app.getPath('userData')`：

```text
quick-launch.json
clipboard-history.json
sftp-config.json
sftp-paths.json
gpt-image-config.json
gpt-image-history.json
ops-backup-restore-points/
ops-auto-backup-settings.json
ops-auto-backup-history.json
```

`json-store.js` 的写入流程为：创建父目录 → 写入同目录临时文件 → 尽量设置 `0600` → 原子 `rename` 覆盖目标文件。这样可降低进程中断造成半文件或敏感配置权限过宽的风险。

### 5.2 敏感凭证

`secure-secret.js` 统一处理：

- Electron `safeStorage` 加密与解密
- `safe-storage:v1:` 存储格式版本
- 旧明文 `password` / `apiKey` 字段自动迁移
- 仅向 Renderer 返回是否存在和掩码值
- 安全存储不可用时拒绝新明文凭证落盘

保存设置时，空密码或空 API Key 表示保留已有值；只有显式 `clearPassword` / `clearApiKey` 才清除凭证。自动备份密码也遵循这一边界：Renderer 只会得到 `hasPassword`，实际密文由 Main Process 用 `safeStorage` 保存和使用。

### 5.3 本地数据自动备份

`ops-auto-backup-scheduler.js` 在 `app.whenReady()` 后读取自动备份设置，并以单个 `setTimeout` 调度每日或每周任务。每次运行都在 Main Process 解密自动备份密码、调用与手动导出相同的 AES-256-GCM 归档逻辑、写入执行历史，并按配置保留数量清理仅由应用生成的自动备份文件。成功历史会保存当次 `safeStorage` 密文引用，供 Main Process 在旧备份校验和一键恢复时使用；Renderer 仅获得可用/缺失状态和安全摘要，不能提供路径或读取密码。任务失败同样写入历史，并重新计算下次执行时间。

自动备份恢复、外部备份恢复与恢复点回滚均先将当前同名 JSON 文件原子写入 `ops-backup-restore-points/`，该目录最多保留 3 个恢复点；因此恢复点回滚也可以继续回滚。自动备份操作会按历史 ID 严格校验受控目录、文件名、常规文件状态和大小；删除操作只会删除对应的受控自动备份文件和历史记录。

### 5.4 SFTP 配置优先级

```text
环境变量
  > 当前 release Profile
  > userData/sftp-config.json
```

环境变量为 `SFTP_HOST`、`SFTP_PORT`、`SFTP_USERNAME`、`SFTP_PASSWORD`。非用户配置来源的完整凭证不会回传给 Renderer。

## 6. SFTP 发布安全

系统发布包含两类路径：

- `release-profiles.json` 保存多环境连接、目录和忽略规则
- `sftp-paths.json` 仅作为旧版默认目录兼容
- 每次 IPC 请求的路径仍重新校验，不能只信任已保存配置

ZIP 部署流程：

1. 主进程执行发布前预检并应用忽略规则
2. 收集本地文件并拒绝非法压缩包路径
3. 在本机临时目录创建 ZIP
4. 上传到服务器 `/tmp`
5. 在远端 staging 目录解压
6. 逐个备份并替换压缩包第一层条目，不整体替换目标目录
7. 失败时通过 shell trap 自动恢复
8. 成功时保留带 release id 的远端备份并写入发布历史
9. 回滚时恢复旧条目，同时保留回滚前快照
10. 清理本地和远端临时文件

部署任务通过串行队列执行，避免多个发布请求交错覆盖 staging、备份或目标文件。


## 7. 模型监控与仪表盘

模型测试编排仍在 Renderer 完成并发队列，但每轮结束后通过 IPC 把最小结果快照写入 `model-test-history.json`。定时巡检由 Main 进程的单实例定时器触发：重新读取 cc-switch 配置、在主进程内使用真实密钥发起测试、保存历史，并在失败时使用 Electron `Notification` 通知。

`ops:getDashboard` 只聚合发布历史、模型历史与巡检设置，不返回密码、API Key 或模型真实回复。首页使用这些聚合数据展示发布统计、可用率和最近 20 次测试趋势。

## 8. Electron 与 Web 安全

BrowserWindow 固定启用：

```js
sandbox: true
contextIsolation: true
nodeIntegration: false
webSecurity: true
allowRunningInsecureContent: false
```

其他策略：

- 生产环境禁用 DevTools
- `ready-to-show` 后显示窗口
- 拦截 Renderer 导航和新窗口
- 禁止附加 `webview`
- 合法外链交给系统浏览器打开
- CSP 禁止 `unsafe-eval`、对象资源、frame 和任意 base URL
- 保留 `style-src 'unsafe-inline'`，用于 Vue/TDesign 的动态样式

## 9. 构建与性能

Vite 只构建 Renderer 到 `dist/renderer`，Electron Main 和 Shared 源文件由 electron-builder 按 `package.json#build.files` 打包。

页面路由按模块拆分。UI 不再全量注册 TDesign：简单表格、图片和页头采用原生 Vue/HTML，TDesign 仅保留消息插件，图标使用本地 sprite。这样避免把完整组件库打入入口 chunk，也消除了 Vite 的大 chunk 构建告警。

## 10. 测试策略

`pnpm test` 执行：

- Node `node:test` 测试文件
- 端口解析回归脚本

当前重点覆盖：

- AI 生图文件名和响应处理
- Main/Preload IPC 通道一致性
- 本地与远程路径安全
- safeStorage 加密、掩码与旧数据迁移
- SFTP ZIP 发布和根目录保护
- 跨平台端口命令输出解析

`pnpm check` 在测试通过后继续执行生产构建，作为提交前的统一检查入口。

## 11. 后续改进

### P2

- 引入 ESLint、Prettier 和统一代码风格检查
- 为 Main IPC 增加更多错误分支与契约测试
- 为 Renderer 关键流程补充 Playwright Electron 冒烟测试
- 在 CI 中执行 `pnpm check`

### P3

- 评估 TypeScript 渐进迁移
- 增加主进程开发热重载或迁移到 electron-vite
- 为大规模目录比较和上传增加取消、限速与更细粒度进度
