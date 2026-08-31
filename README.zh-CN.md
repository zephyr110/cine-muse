# Cine Muse

> AI 视频生产工作台 —— 从一句创意到一支成片，由一支智能体团队驱动完成。

Cine Muse 是一款桌面端 AI 视频生成客户端，由 **Next.js 静态渲染 + Electron 壳 + 本地 Express/SQLite 服务**三层构成。核心是一条模拟的多智能体流水线：基础链路（剧本 → 分镜 → 视频 → 剪辑），你可以在指定环节挂载可选的"增强"子智能体来强化特定步骤。

[EN](README.md) · 中文

## 功能特性

- **多智能体流水线** —— 基础链路之外，可自由勾选增强子智能体（剧本审查、风格设计、分镜生成、一致性守护、视觉质检），按锚点自动插入对应环节。
- **四种干预模式（L0–L3）** —— 从全自动到手作：全自动、引导式、审查式（关键节点人工确认）、手作式。
- **状态机引擎** —— 每个项目按 排队中 → 执行中 →（待确认 ⇄ 迭代）→ 已完成/已中断 推进，由本地 ticker 模拟门禁、重试与检查点。
- **工作台** —— 可折叠的项目分组块（待处理 / 进行中 / 已完成）、带事件图标的类型化活动时间线、统计卡片。
- **资产库与 RAG 知识库** —— 角色 / 场景 / 道具 / 风格素材；知识库可绑定流水线环节。
- **设置对话框** —— 账号安全（修改密码）与模型服务；模型适配器可插拔（LLM / 视频 / TTS），替换模型无需改动编排逻辑。
- **本地优先** —— 账号（scrypt 哈希）与应用状态全部落在本机 SQLite，数据不出设备。
- **主题切换** —— 浅色 / 深色 / 跟随系统。

## 整体架构

```
┌─────────────────────────────────────────────────────────┐
│  Next.js 静态导出（渲染层）                              │
│  src/app（页面）· src/components · src/lib/store.tsx     │
│  immer 全局状态，每次变更即持久化                        │
└──────────────┬──────────────────────────┬───────────────┘
               │ fetch /api/*             │ window.cineAPI (IPC)
┌──────────────▼────────────┐  ┌──────────▼────────────────┐
│  本地 Express 服务         │  │  Electron 主进程          │
│  server/ · 127.0.0.1:47832│  │  electron/                │
│  scrypt 认证 + token 会话  │  │  单实例锁（防端口冲突）    │
│  SQLite（用户 + 状态 kv）  │  │  窗口生命周期、退出前状态落盘│
└───────────────────────────┘  └───────────────────────────┘
```

三层之间共享同一份数据契约：

1. **渲染层** —— Next.js 16 静态导出（`CINE_RELATIVE_ASSETS=1`）+ React 19 + Base UI（shadcn 风格组件）+ Tailwind v4。UI 状态集中在 immer 全局 store（`src/lib/store.tsx`），每次变更经过归一化并持久化。
2. **本地服务** —— Express 监听 `127.0.0.1:47832`，scrypt 密码哈希、token 会话、better-sqlite3 存储。负责认证（`/api/auth/*`）与状态存储（`/api/state`）。
3. **Electron 壳** —— 主进程带单实例锁（避免端口冲突）、IPC 透传、退出前 300ms 延迟关闭确保最后一次状态落盘。

### 引擎

- `src/lib/engine/reducer.ts` —— 状态机：项目生命周期、环节门禁/重试/检查点、`TICK` 驱动的模拟推进、事件日志（上限 120 条，新在前）。
- `src/lib/engine/templates.ts` —— 环节模板与 `BOOST_SLOTS`：增强智能体按锚点（`after`/`before`）插入流水线，模板中已存在的智能体自动跳过。
- `src/lib/engine/seed.ts` —— 演示种子数据（项目、智能体、资产、知识库）。
- `src/lib/meta.tsx` —— 各类展示元数据的唯一事实来源（项目状态、干预模式、事件时间线图标）。

## 技术栈

| 层 | 技术 |
|---|---|
| UI | Next.js 16（静态导出）、React 19、Base UI、shadcn 组件、Tailwind v4、lucide-react、recharts、sonner |
| 状态 | immer、React context + reducer、zod 校验 |
| 桌面 | Electron 43、electron-builder |
| 服务 | Express、better-sqlite3、scrypt、token 会话 |
| 工具 | TypeScript、ESLint、pnpm |

## 快速开始

需要 Node.js 20+ 与 [pnpm](https://pnpm.io)。

```bash
pnpm install

# 1. 启动本地服务（认证 + 持久化，端口 47832）
pnpm dev:server

# 2. 启动 Web 渲染层
pnpm dev        # → http://localhost:3000
```

在应用内注册账号，或使用登录页的演示账号。创建项目、勾选增强智能体、选择干预模式，观察流水线自动跑完。

### 桌面构建

```bash
# 免安装目录构建（测试用）
pnpm build:desktop:dir

# electron-builder 打包安装程序
pnpm build:desktop
```

## 项目结构

```
├── src/app/          # 页面：/login /register /forgot-password /dashboard /assets /knowledge /agents /projects
├── src/components/   # auth、dashboard、projects、assets、knowledge、agents、settings、ui（shadcn 风格）
├── src/lib/          # store、认证客户端、API 客户端、引擎（reducer/templates/seed）、meta、theme、types
├── electron/         # 主进程、preload、数据库适配
├── server/           # Express 认证 + 状态服务（SQLite）
└── docs/             # 设计文档
```

## 开源协议

见 [LICENSE](LICENSE)。
