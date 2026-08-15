<div align="center">

# 🖥️ DeepSeek Harness Desktop

**把 DeepSeek Harness AI 助手装进原生 Windows 桌面应用**
*Turn the DeepSeek Harness AI agent into a native Windows desktop app*

[![Version](https://img.shields.io/badge/version-0.1.2-4D6BFE)](package.json)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue)](https://github.com/LTX888888/deepseek-harness-desktop/releases)
[![Electron](https://img.shields.io/badge/Electron-38-47848F)](https://www.electronjs.org/)
[![Node](https://img.shields.io/badge/Node-22.19-339933)](https://nodejs.org/)

</div>

---

## ✨ 为什么用桌面版？ / Why a desktop app?

| 🪟 原生窗口 | 告别浏览器标签页，独立窗口 + 专属图标 + 任务栏常驻 |
|---|---|
| 🚀 开箱即用 | **完全自包含**——内置 AI 引擎和 Node 运行时，装完即用，零依赖 |
| 🌐 中英一键切换 | 菜单栏「语言」实时切换 中文/English，无需重启 |
| ⚡ 增量更新 | 以后改功能**只传几十 KB 的代码**，不再重新下载几百 MB 框架 |
| 🔄 一键覆盖更新 | 新版安装包双击即覆盖，无需卸载旧版 |
| 🗑️ 独立卸载程序 | 附赠正规卸载器，随时干净卸载 |
| 🔒 数据安全 | 所有会话、设置、凭据留在本机 `$DSH_HOME`，绝不打包上传 |

## 📸 截图 / Screenshot

![DeepSeek Harness Desktop](assets/screenshot.png)

## 🚀 快速开始 / Quick Start

**方式一：安装版（推荐）** —— 双击 `DeepSeek-Harness-Setup-*.exe`，一键覆盖安装，自动建桌面/开始菜单快捷方式。

**方式二：便携版** —— 下载 `DeepSeek-Harness-Portable-*.exe`，双击即用，无需安装。

> 首次启动自动内置引擎，之后每次打开就是你的 AI 工作台。

## 🧠 技术亮点 / Tech Highlights

- **自包含引擎**：内置 npm 发布的 `@deepseek-ai/dsh` 全量运行时（约 250MB 依赖），用 Electron 自带 Node 22.19 直接运行，无需系统 Node、无需检出仓库
- **端口智能复用**：检测到已有 harness 实例（3080）自动复用，避免多实例冲突
- **实时语言切换**：菜单写 `settings.yaml` → harness 热发布（chokidar watch）→ 前端即时切换
- **增量补丁机制**：`asarUnpack` 把代码解包成普通文件，`npm run patch` 秒级覆盖更新
- **覆盖式安装器**：NSIS oneClick，同 appId 自动覆盖、保留用户数据

## 🔧 开发者 / For Developers

```bash
npm install              # 安装构建依赖
npm run prepare-runtime  # 拉取内置 harness 运行时（npm @deepseek-ai/dsh）
npm start                # 开发模式启动

npm run patch            # 增量更新已安装应用（只传改动的代码）
npm run dist             # 完整打包（自动 bump 版本 + 安装/便携/卸载三件套）
npm run dist:minor       # minor 版本打包
npm run dist:major       # major 版本打包
```

产物（`release/`）：
- `DeepSeek-Harness-Setup-<version>.exe` — 一键覆盖安装器
- `DeepSeek-Harness-Portable-<version>.exe` — 免安装便携版
- `DeepSeek-Harness-Uninstall-<version>.exe` — 独立卸载程序

## 🏗️ 架构 / Architecture

```
src/
├── main.cjs             # Electron 主进程（窗口、菜单、生命周期、日志）
├── harness.cjs          # harness 服务管理（定位、选端口、就绪等待、清理）
├── settings.cjs         # settings.yaml 读写（语言偏好等）
├── preload.cjs          # 安全渲染桥（contextIsolation）
scripts/
├── bump-version.cjs     # 版本自动递增（patch/minor/major）
├── post-dist.cjs        # 打包后自动清理 + 刷新卸载程序
├── patch.cjs            # 增量更新：覆盖代码到已安装应用
├── prepare-runtime.cjs  # 拉取内置 harness 运行时
└── gen-icon.cjs         # 从 favicon 渲染应用图标
```

## 🔒 数据安全 / Privacy

应用**只读取、从不打包**你的数据：
- 会话、设置、API 凭据都存放在 `$DSH_HOME`（默认 `~/.dsh`）——完全本机、项目之外
- 打包产物和代码中**不含任何用户数据或密钥**
- 代码中零硬编码路径，可放心审计

## 📄 License

[MIT](LICENSE)

---

<div align="center">
⭐ 如果这个项目对你有帮助，欢迎 Star！ · 用 ❤️ 和 DeepSeek Harness 构建
</div>
