# Ops Desktop

面向本机开发与运维场景的 Electron 桌面工具，基于 Vue 3 + Vite 构建。应用把端口管理、快捷启动、剪贴板、系统信息、SFTP 发布、AI 生图和模型连通性测试集中到一个本地客户端中。

## 功能模块

| 模块 | 能力 |
| --- | --- |
| Node 服务 | 扫描本机 Node.js 监听端口，按端口、PID、命令和地址筛选，支持正常结束或强制结束进程 |
| 快捷启动 | 保存常用应用、文件、目录或网页入口，并从桌面端安全启动 |
| 剪贴板历史 | 记录文本和图片历史，支持筛选、搜索、复制、删除与清空 |
| 系统信息 | 查看操作系统、CPU、内存、磁盘和运行环境信息 |
| 运维仪表盘 | 汇总发布成功率、模型可用率、最近活动与巡检状态 |
| 系统发布 | 发布前预检、忽略规则、多环境 Profile、发布历史、远端备份与一键回滚；浏览本地和远程目录，通过 SFTP 上传、续传、比较、删除、创建目录或 ZIP 部署 |
| AI 生图 | 对接 OpenAI 兼容的模型与图片生成接口，保存配置、生成记录和图片文件 |
| 模型测试 | 检测 cc-switch 中转模型可用性，保存历史与趋势，支持定时巡检和异常桌面通知 |

## 环境要求

- Node.js `>= 18`
- pnpm（项目声明版本为 `11.5.2`）
- 模型测试模块需要系统可执行文件 `sqlite3`
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
# Node 测试 + 端口解析检查
pnpm test

# 完整检查：测试后执行生产构建
pnpm check

# 仅运行 SFTP 部署安全测试
pnpm test:sftp
```

测试覆盖安全凭证迁移、IPC 通道一致性、路径边界、SFTP 部署安全、AI 图片文件处理和端口解析。

## 构建与打包

```bash
# 构建渲染进程到 dist/renderer
pnpm build

# 当前平台安装包
pnpm electron:build

# 指定平台
pnpm electron:build:mac
pnpm electron:build:win
pnpm electron:build:linux
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

| 文件 | 内容 |
| --- | --- |
| `quick-launch.json` | 快捷启动项 |
| `clipboard-history.json` | 剪贴板历史 |
| `sftp-config.json` | SFTP 连接配置，密码为加密字段 |
| `sftp-paths.json` | 旧版默认本地和远程发布目录 |
| `release-profiles.json` | 多环境发布 Profile、目录与忽略规则，密码仍为加密字段 |
| `release-history.json` | 发布、失败和回滚历史 |
| `model-test-history.json` | 手动测试与定时巡检历史 |
| `model-monitor-settings.json` | 巡检间隔、通知开关和巡检目标 |
| `gpt-image-config.json` | AI 生图配置，API Key 为加密字段 |
| `gpt-image-history.json` | AI 生图历史 |

SFTP 密码和 AI API Key 使用 Electron `safeStorage` 加密后保存。渲染进程只能获得 `hasPassword`、`passwordMasked`、`hasApiKey`、`apiKeyMasked` 等状态，不会获得完整凭证。旧版本遗留的明文字段会在可用时自动迁移为加密字段；系统安全存储不可用时，应用拒绝把新的敏感凭证明文写入磁盘。

JSON 数据采用临时文件加原子替换方式写入，并尽量将文件权限设置为仅当前用户可读写。

## 发布安全闭环

每个发布任务在上传前都会由主进程重新执行预检：校验本地路径、应用忽略规则、统计文件数量与体积、测试 SFTP 连接并检查远端目录。发布环境使用独立 Profile 保存服务器、账号、本地目录、远端目录和忽略规则。

ZIP 部署成功后，旧版本按发布记录保留在远端目标目录父级的 `.ops-release-backups/<release-id>` 下；发布历史页可将对应第一层条目恢复，并把回滚前版本另存为恢复快照。

## 模型监控

模型测试完成后会保存最小化结果快照（状态、耗时、HTTP 状态与诊断，不保存 API Key 和真实回复正文）。当前测试范围可一键设为巡检目标；Electron 主进程按配置间隔执行巡检，失败时可发送系统桌面通知。首页运维仪表盘展示最近发布、模型可用率与趋势。

## 安全边界

- Electron Renderer 启用 `sandbox` 和 `contextIsolation`
- 禁用 `nodeIntegration`、不安全内容和生产 DevTools
- Renderer 只能通过冻结的 `window.opsApi` 调用白名单 IPC
- 阻止页面跳转、`webview` 和新窗口；外链仅允许 `http:`、`https:`、`mailto:`
- CSP 禁止 `unsafe-eval`、对象嵌入和 frame
- 文件路径、远程路径、对话框输入和外部 URL 均在主进程校验
- 页面路由懒加载，TDesign 仅保留消息插件，图标使用本地 sprite，不依赖远程 CDN

更详细的模块边界、数据流和目录说明见 [ARCHITECTURE.md](./ARCHITECTURE.md)。
