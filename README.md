# Ops Desktop

面向开发者和小团队的本机优先 AI 运维桌面工作台，基于 Electron、Vue 3 与 Vite 构建。应用围绕“发现问题、分析问题、执行处理、验证恢复”组织系统发布、模型可靠性、自动化巡检、运维事件和本机服务能力；快捷启动、剪贴板等效率工具作为辅助能力，AI 图像生成归入实验功能。

## 功能架构

| 分组      | 模块         | 能力                                                                                                                                |
| --------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 总览      | 运维仪表盘   | 汇总发布状态、模型可用率、巡检状态、趋势与最近活动                                                                                  |
| 总览      | 运维中心     | 按来源与稳定指纹聚合运维事件，记录重复发生、确认、解决和自动恢复时间线；运行 HTTP/TCP 自动化巡检，并使用 AI Copilot 辅助排障        |
| 核心运维  | 系统发布     | 发布前预检、忽略规则、多环境 Profile、发布历史、远端备份、健康检查与一键回滚；通过 SFTP 上传、续传、比较、删除、创建目录或 ZIP 部署 |
| 核心运维  | 模型可靠性   | 检测 cc-switch 中转模型可用性，管理测试范围、历史趋势、定时巡检和异常桌面通知                                                       |
| 核心运维  | Node 服务    | 扫描本机 Node.js 监听端口，按端口、PID、命令和地址筛选，支持正常结束或强制结束进程                                                  |
| AI 与知识 | AI 能力中心  | 统一管理 OpenAI 兼容 Provider、模型语义评测、脱敏日志分析、本地知识库、确认式安全工作流与只读 MCP 服务                              |
| 本机工具  | 快捷启动     | 保存常用应用、文件、目录或网页入口，并从桌面端安全启动                                                                              |
| 本机工具  | 剪贴板历史   | 记录文本和图片历史，支持筛选、搜索、复制、删除与清空                                                                                |
| 本机工具  | 系统信息     | 查看操作系统、CPU、内存和运行环境信息                                                                                               |
| 本机工具  | 本地数据管理 | 按功能分类导出 AES-256-GCM 加密备份，支持定时保留、执行历史和本机恢复点回滚                                                         |
| 实验功能  | AI 图像实验  | 对接 OpenAI 兼容的模型与图片生成接口，保存配置、生成记录和图片文件                                                                  |

## 环境要求

- Node.js `>= 22.12`（CI 使用 Node.js 24）
- pnpm（项目声明版本为 `11.5.2`）
- 模型可靠性会直接读取 CC Switch 的 SQLite 配置；应用优先使用 Electron 内置 `node:sqlite`，不可用时自动回退到随包内置的 `sql.js`，无需额外安装系统 `sqlite3`。
- ZIP 远程部署要求目标服务器支持 SSH 命令，并安装 `unzip`

## 开发

```bash
pnpm install
```

同时启动 Vite 和 Electron：

```bash
pnpm dev:all
```

也可以分两个终端启动，便于分别查看日志：

```bash
# 终端 1：Vite 开发服务器，默认 http://localhost:5173
pnpm dev

# 终端 2：Electron
pnpm start
```

开发模式默认打开 DevTools。如需关闭：

```bash
OPEN_DEVTOOLS=false pnpm start
```

## 测试与检查

```bash
# Node / Renderer 测试、端口解析与 Renderer IPC 边界检查
pnpm test

# Electron 桌面壳与关键路由 Playwright 冒烟测试
pnpm test:e2e

# 质量检查：Prettier、ESLint、全部测试与 Electron E2E
pnpm verify

# 完整检查：质量检查后执行生产构建
pnpm check

# 仅运行 SFTP 部署安全测试
pnpm test:sftp

# 从源码以 stdio 方式启动只读 MCP 服务
pnpm mcp
```

测试覆盖安全凭证迁移、IPC 通道一致性、Renderer IPC 边界、路径边界、SFTP 部署安全、AI 图片文件处理、AI 运维核心能力和端口解析；`pnpm test:e2e` 会启动临时 Vite 服务与 Electron，验证桌面壳及关键路由可用。

## 构建与打包

```bash
# 构建渲染进程到 dist/renderer
pnpm build

# 构建指定平台安装包
pnpm electron:build:mac
pnpm electron:build:mac:arm64
pnpm electron:build:mac:x64
pnpm electron:build:win
pnpm electron:build:win:x64
pnpm electron:build:win:arm64
```

所有打包命令都会显式使用 `--publish never`，因此普通构建只生成本地安装包；GitHub Release 资产由 CI 最后的发布步骤统一上传。

Windows CI 会分别在原生 x64 与 ARM64 Runner 上生成 NSIS 安装包和 ZIP，并验证解压版与安装版均可启动、读取 CC Switch SQLite/WAL 配置、创建任务栏未读角标以及调用 Windows 系统通知。安装生命周期 smoke 会静默安装、运行、卸载，并确认安装目录已清理。

Windows 版本会自动查找 CC Switch 默认目录、自定义 `app_paths.json` 目录和 `%USERPROFILE%\.cc-switch\cc-switch.db`。配置中的密钥只在主进程使用，Renderer 不会收到 API Key。

正式分发建议进行 Authenticode 签名：本仓库的 Windows CI 会在配置 `WINDOWS_CSC_LINK` 与 `WINDOWS_CSC_KEY_PASSWORD` Secrets 后自动传递给 electron-builder，并校验应用与安装包的签名；未配置证书时仍会构建与执行功能 smoke，但安装包会是未签名状态，可能触发 SmartScreen 提示。

项目已在 `electron-builder.env` 中配置 Electron 与 electron-builder 二进制镜像，避免访问 GitHub Releases 超时。外部环境变量的优先级更高；若需要改回官方源，可在执行命令时临时覆盖：

```bash
ELECTRON_MIRROR=https://github.com/electron/electron/releases/download/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://github.com/electron-userland/electron-builder-binaries/releases/download/ \
  pnpm electron:build:win
```

安装包输出目录为 `release/`。源码目录中的 `pnpm start` 属于开发模式，会加载本地 Vite 服务；安装后的生产应用才会加载 `dist/renderer/index.html`。

## SFTP 配置

SFTP 配置优先级如下：

1. 环境变量
2. 应用内保存的用户配置

支持的环境变量：

```bash
export SFTP_HOST=example.com
export SFTP_PORT=22
export SFTP_USERNAME=deploy
export SFTP_PASSWORD='your-password'
```

环境变量和应用内保存的配置会作为运行时配置来源，不会在设置页回显完整密码。远程路径必须为绝对路径；应用拒绝路径穿越以及对远程根目录 `/` 的上传、部署、删除和创建目录等破坏性操作。

## 本地数据与凭证安全

应用数据写入 Electron 的 `app.getPath('userData')` 目录，主要文件包括：

| 文件                            | 内容                                                      |
| ------------------------------- | --------------------------------------------------------- |
| `quick-launch.json`             | 快捷启动项                                                |
| `clipboard-history.json`        | 剪贴板历史                                                |
| `sftp-config.json`              | SFTP 连接配置，密码为加密字段                             |
| `sftp-paths.json`               | 旧版默认本地和远程发布目录                                |
| `release-profiles.json`         | 多环境发布 Profile、目录与忽略规则，密码仍为加密字段      |
| `release-history.json`          | 发布、失败和回滚历史                                      |
| `model-test-history.json`       | 手动测试与定时巡检历史                                    |
| `model-monitor-settings.json`   | 巡检间隔、通知开关和巡检目标                              |
| `gpt-image-config.json`         | AI 图像实验配置，API Key 为加密字段                       |
| `gpt-image-history.json`        | AI 图像实验历史                                           |
| `ai-providers.json`             | AI Provider 配置，API Key 为加密字段                      |
| `ai-evaluations.json`           | 模型语义评测用例与运行结果，回答会先脱敏                  |
| `ai-log-analysis.json`          | 脱敏日志的本地规则分析和可选 AI 总结                      |
| `ai-knowledge.json`             | 本地运维知识库，保存前会脱敏                              |
| `ai-workflows.json`             | 自然语言工作流预览历史                                    |
| `ops-backup-restore-points/`    | 导入或回滚前自动保留的本机恢复点，最多保留最近 3 次       |
| `ops-auto-backup-settings.json` | 自动备份的目录、周期、保留策略与 safeStorage 加密后的密码 |
| `ops-auto-backup-history.json`  | 自动备份成功或失败的本机执行历史（最多 50 条）            |

SFTP 密码和 AI API Key 使用 Electron `safeStorage` 加密后保存。渲染进程只能获得 `hasPassword`、`passwordMasked`、`hasApiKey`、`apiKeyMasked` 等状态，不会获得完整凭证。旧版本遗留的明文字段会在可用时自动迁移为加密字段；系统安全存储不可用时，应用拒绝把新的敏感凭证明文写入磁盘。

JSON 数据采用临时文件加原子替换方式写入，并尽量将文件权限设置为仅当前用户可读写。

## 本地数据备份与恢复

在 **本地数据管理** 中可按运维、发布、模型可靠性、AI 与知识、本机工具和实验功能分类导出 `.opsbackup` 加密备份。备份使用用户设置的密码和 AES-256-GCM 加密，应用不会保存或找回手动备份密码。恢复前会验证密码、加密完整性、文件白名单和 JSON 格式；恢复仅覆盖备份中已有的文件，未包含的数据不会被删除，并会在本机创建恢复点后重启应用。

也可指定专用目录，启用每日或每周自动备份，设置保留 1–30 个自动备份文件，并在页面查看最近执行历史。页面提供健康检查，可核验计划状态、目录读写权限、最近执行结果、缺失备份文件和可用磁盘空间。自动备份密码仅通过 Electron `safeStorage` 加密保存在本机；页面只显示是否已保存。每条成功历史会保留当次受系统安全存储保护的密码引用，因此即使后来更换计划密码，仍可直接校验或一键恢复旧备份；密码及其密文都不会传给渲染层。历史条目还可打开所在目录、删除备份；外部删除的文件会标记为缺失并可清理记录。保留策略仅会清理本应用创建的 `ops-desktop-auto-*.opsbackup` 文件。任意恢复点回滚前都会再创建当前数据的恢复点，因此回滚操作本身可撤销。

已保存的 SFTP 密码与 AI API Key 仍由系统 `safeStorage` 单独加密。跨设备恢复时，如目标系统无法解密原设备写入的凭证，请在相应页面重新填写密码或 API Key。

## 发布安全闭环

每个发布任务在上传前都会由主进程重新执行预检：校验本地路径、应用忽略规则、统计文件数量与体积、测试 SFTP 连接并检查远端目录。发布环境使用独立 Profile 保存服务器、账号、本地目录、远端目录和忽略规则。

ZIP 部署成功后，旧版本按发布记录保留在远端目标目录父级的 `.ops-release-backups/<release-id>` 下；发布历史页可将对应第一层条目恢复，并把回滚前版本另存为恢复快照。

## 模型监控

模型可靠性测试完成后会保存最小化结果快照（状态、耗时、HTTP 状态与诊断，不保存 API Key 和真实回复正文）。当前测试范围可一键设为巡检目标；Electron 主进程按配置间隔执行巡检，失败时可发送系统桌面通知。定时巡检会按 Provider、协议与模型生成稳定事件指纹，重复异常累计到同一事件，检测恢复正常时自动关闭并保留恢复时间线。首页运维仪表盘展示最近发布、模型可用率与趋势。

## 安全边界

- Electron Renderer 启用 `sandbox` 和 `contextIsolation`
- 禁用 `nodeIntegration`、不安全内容和生产 DevTools
- Renderer 只能通过冻结的 `window.opsApi` 调用白名单 IPC
- 阻止页面跳转、`webview` 和新窗口；外链仅允许 `http:`、`https:`、`mailto:`
- CSP 禁止 `unsafe-eval`、对象嵌入和 frame
- 文件路径、远程路径、对话框输入和外部 URL 均在主进程校验
- 页面路由懒加载，TDesign 仅保留消息插件，图标使用本地 sprite，不依赖远程 CDN

更详细的模块边界、数据流和目录说明见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## AI 能力中心与 MCP

AI 能力中心当前统一接入 OpenAI 兼容的 Chat Completions 接口，可用于公司网关、本地模型或兼容服务。Provider 的 API Key 使用系统安全存储加密；评测结果、日志和知识文档在持久化前均会进行基础敏感信息脱敏。

自然语言工作流只生成预览：页面导航属于低风险操作，外部网站打开必须由用户确认；发布、删除、回滚和任何 shell 命令都不会由 AI 自动执行。

MCP 服务通过 stdio 提供严格只读的 `get_release_history`、`get_model_health` 和 `search_ops_knowledge` 工具，不返回 Provider/SFTP 凭证，也不提供发布写操作。源码环境可运行 `pnpm mcp`；安装包环境可在 AI 能力中心的 **MCP** 页复制当前应用生成的命令与配置示例。

## 发布与安装指南

### 版本管理

先使用 `npm version patch/minor/major` 或手动修改 `package.json` 中的版本，再创建与版本完全一致的 `v*` tag。例如版本为 `1.0.4` 时，推送 `v1.0.4`：

```bash
git tag v1.0.4
git push origin v1.0.4
```

推送匹配 `package.json` 版本的 `v*` tag 会触发完整 CI，并自动创建或更新对应的 GitHub Release，上传现有的 macOS `.dmg`/`.zip` 和 Windows `.exe`/`.zip` 产物。`main` push 和针对 `main` 的 PR 只构建与验证，不发布 Release；tag 与 `package.json` 版本不一致时，CI 会直接失败。

### macOS 未签名发布

v* tag 发布会分别生成 `arm64` 和 `x64` 的 DMG/ZIP，但当前产物不使用 Apple Developer ID 证书签名，也不会提交 Apple 公证，因此不需要配置 `CSC_LINK`、`APPLE_ID` 等 Apple Actions Secrets。

CI 仍会检查每个安装包的目标架构，并直接启动打包后的 `.app` 验证主进程与渲染页面能够正常加载。由于产物未经过 Developer ID 签名和公证，macOS 可能显示无法验证开发者或安全风险提示；用户需要在确认下载来源可信后，通过系统设置手动允许首次打开。

CI 分别使用 `macos-15`（Apple Silicon）和 `macos-15-intel`（Intel）Runner 构建，并在每个架构上直接启动打包后的 `.app`，确认主进程与渲染页面能够正常加载后才上传产物。

Windows CI 也会在构建完成后直接启动 `win-unpacked/Ops Desktop.exe`，在隔离的临时 Windows 用户目录中生成处于 WAL 模式、且 WAL 内容未 checkpoint 的真实 SQLite CC Switch 配置，并从渲染页面通过 preload/IPC 验证应用能读取最新快照、自动发现 Provider、模型和端点，同时确认 API Key 不会返回渲染层；全部通过后才上传 NSIS/ZIP 产物。

### 发布验收步骤

每次版本发布均按以下门禁执行：

1. 运行 `pnpm verify`，通过 Prettier、lint、单元/Renderer 测试与 Electron E2E。
2. 运行 `pnpm check`，完成全量验证与构建。
3. 检查 `release/` 产物；macOS 同时包含 arm64/x64 的 `.dmg` 与 `.zip`。
4. 在 macOS Release 说明中明确产物不使用 Developer ID 签名和 Apple 公证。
5. 更新 `CHANGELOG.md` 后创建与 `package.json` 版本一致的 Tag。

### 安装与使用

1. 下载对应平台的 `.dmg`（macOS）或 `.exe`（Windows）
2. 运行安装程序或将应用拖入「应用程序」文件夹
3. 首次运行时配置 AI Provider（OpenAI 兼容）和 SFTP（可选）

### macOS

双击 `.dmg` 文件，拖拽到「应用程序」文件夹后启动。

### Windows

运行 `.exe` 安装程序，或解压 `.zip` 后直接运行。
