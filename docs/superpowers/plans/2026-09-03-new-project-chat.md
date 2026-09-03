# 新建项目对话式向导（聊天壳）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把新建项目 5 步向导（`new-project-wizard.tsx`）替换为「全页聊天 + 成片简报摘要卡」的对话式向导（聊天壳：选项 chips 内嵌系统消息气泡底部 + 底部输入框自由文本通道），字段与 `CREATE_PROJECT` 契约完全不变。

**Architecture:** 纯前端重构。`src/lib/option-match.ts` 提供枚举题自由文本别名归一匹配（纯函数 + vitest）；`src/components/projects/new-project-config.tsx` 集中向导常量（题材/风格/时长/画质/模板/模式）；`src/components/projects/new-project-chat.tsx` 用单组件实现对话流（行式问题列表：完成态派生、当前题 = 首个未完成行、修改 = 回退激活某行）；路由页换组件后删除旧 wizard。reducer/engine/types/seed 零改动。

**Tech Stack:** Next.js 16（static export）、React 18/19 hooks、Tailwind v4 + shadcn tokens（`--radius`、`bg-card`、`border-border` 等）、base-ui Button/Input/Textarea、lucide-react（`*Icon` 后缀导入）、vitest。

## Global Constraints

- 数据契约不变：`CREATE_PROJECT` 的 `input: NewProjectInput` 字段一项不丢（title/premise/genre/style/durationSec/aspectRatio/quality/template/interventionMode/assetIds/boostAgentIds）；**禁止**修改 `src/lib/types.ts`、`src/lib/engine/` 任何文件
- 选项 chips 必须渲染在 assistant 提问气泡**内部底部**（不是输入框上方）；底部输入栏是纯文本框
- 枚举字段 chips-only 语义：自由文本只能命中既有选项（别名归一），**不产生自定义值**；未命中给 system-note「没找到『xx』，点下面选项试试」且不吞掉输入内容
- 输入框 Enter 发送必须做 IME 组合态守卫（`e.nativeEvent.isComposing`），中文输入法回车不误发
- 模板联动规则与旧 Wizard 完全一致：切 `quick` 时从 boostAgentIds 移除 `previs`；切 `full` 时若无则补回 `previs`
- UI 文案中文；颜色/间距用 shadcn token（`bg-primary`/`border-border`/`text-muted-foreground`/`rounded-lg`/`rounded-md`），图标用 lucide `*Icon` 后缀命名
- 不新增任何 npm 依赖
- 工作流目录：`docs/superpowers/plans/` 已存在；本计划在 branch `feat/new-project-chat`（worktree `…/.claude/worktrees/project-chat`）执行
- 提交风格：`feat(project-chat): …`；每 Task 一个提交
- 测试命令：`pnpm exec vitest run <文件>`；全量：`pnpm test`（期望 28 个引擎测试保持全绿）；组件验证：`pnpm build` 必须通过（tsc 0 错误）

---

### Task 1: 自由文本别名归一匹配 lib（TDD）

**Files:**
- Create: `src/lib/option-match.ts`
- Test: `src/lib/option-match.test.ts`

**Interfaces:**
- Produces（后续 Task 依赖的精确签名）:
  - `export interface OptionLike<V extends string> { value: V; label: string; searchText?: string; aliases?: readonly string[] }`
  - `export function normalizeOptionText(raw: string): string` — trim、小写、连续空白折叠为单个空格
  - `export function matchOption<V extends string>(text: string, options: readonly OptionLike<V>[]): V | null` — 语义：归一后空串 → null；严格命中（alias 或 label 全等）优先，严格池唯一才返回；无严格命中时宽松命中（label 双向包含 或 searchText 前向包含），唯一才返回；否则 null

- [ ] **Step 1: 写失败测试**

创建 `src/lib/option-match.test.ts`：

```ts
import { describe, expect, it } from "vitest"
import { matchOption, normalizeOptionText } from "./option-match"
import type { OptionLike } from "./option-match"

const ASPECT: OptionLike<"16:9" | "9:16" | "1:1">[] = [
  { value: "16:9", label: "16:9", aliases: ["横屏", "横向", "16比9", "169"] },
  { value: "9:16", label: "9:16", aliases: ["竖屏", "竖向", "9比16", "916"] },
  { value: "1:1", label: "1:1", aliases: ["方形", "正方形", "1比1"] },
]

const DURATION: OptionLike<"30" | "60" | "120" | "180" | "240">[] = [
  { value: "30", label: "0.5 分钟", aliases: ["30秒", "半分钟", "30s"] },
  { value: "60", label: "1 分钟", aliases: ["1分钟", "一分钟", "1分", "1min", "60秒", "60s"] },
  { value: "120", label: "2 分钟", aliases: ["2分钟", "两分钟", "2分", "2min", "120秒"] },
  { value: "180", label: "3 分钟", aliases: ["3分钟", "三分钟", "3分", "180秒"] },
  { value: "240", label: "4 分钟", aliases: ["4分钟", "四分钟", "4分", "240秒"] },
]

const QUALITY: OptionLike<"draft" | "standard" | "hd">[] = [
  { value: "draft", label: "草稿 (720p)", aliases: ["草稿", "720", "720p", "低清"] },
  { value: "standard", label: "标准 (1080p)", aliases: ["标准", "1080", "1080p", "标清"] },
  { value: "hd", label: "高清 (4K)", aliases: ["高清", "4k", "超清"] },
]

const GENRE: OptionLike<string>[] = [
  { value: "科幻", label: "科幻", searchText: "硬核科幻与人文关怀交织" },
  { value: "悬疑", label: "悬疑", searchText: "层层递进的谜团与反转" },
  { value: "古风", label: "古风", searchText: "水墨质感、低饱和青灰、对称构图" },
]

const STYLE: OptionLike<string>[] = [
  { value: "赛博朋克", label: "赛博朋克", searchText: "霓虹蓝紫高对比、雨夜反光、复古未来主义" },
  { value: "赛博国风", label: "赛博国风", searchText: "霓虹 + 水墨融合、青金配色" },
  { value: "黑色电影", label: "黑色电影", searchText: "低照度硬光、阴影切割、冷峻色调" },
]

const MODE: OptionLike<string>[] = [
  { value: "auto", label: "全自动", aliases: ["自动", "零打断"] },
  { value: "guided", label: "引导式", aliases: ["引导", "前置干预"] },
  { value: "review", label: "审查式", aliases: ["审查", "人工确认"] },
  { value: "manual", label: "手作式", aliases: ["手动", "全程介入"] },
]

describe("normalizeOptionText", () => {
  it("trim + 小写 + 折叠空白", () => {
    expect(normalizeOptionText("  4K  ")).toBe("4k")
    expect(normalizeOptionText("  2 分钟 ")).toBe("2 分钟")
    expect(normalizeOptionText("")).toBe("")
  })
})

describe("matchOption", () => {
  it("alias 全等命中（竖屏→9:16）", () => {
    expect(matchOption("竖屏", ASPECT)).toBe("9:16")
    expect(matchOption("169", ASPECT)).toBe("16:9")
  })

  it("时长自然语言命中", () => {
    expect(matchOption("两分钟", DURATION)).toBe("120")
    expect(matchOption("2min", DURATION)).toBe("120")
    expect(matchOption("3 分钟", DURATION)).toBe("180") // label 全等
    expect(matchOption("3分钟", DURATION)).toBe("180") // 双向包含（"3 分钟" 归一后空白折叠为单空格，仍靠 alias）
  })

  it("画质别名（4k→hd）", () => {
    expect(matchOption("4K", QUALITY)).toBe("hd")
    expect(matchOption("1080", QUALITY)).toBe("standard")
  })

  it("label 全等与 searchText 前向包含", () => {
    expect(matchOption("科幻", GENRE)).toBe("科幻")
    expect(matchOption("水墨", GENRE)).toBe("古风") // 古风 searchText 含「水墨」，唯一
  })

  it("歧义返回 null（赛博朋克/赛博国风都含「赛博」）", () => {
    expect(matchOption("赛博", STYLE)).toBeNull()
    expect(matchOption("电影", STYLE)).toBe("黑色电影") // 唯一含「电影」
  })

  it("空串与未命中返回 null", () => {
    expect(matchOption("", ASPECT)).toBeNull()
    expect(matchOption("   ", ASPECT)).toBeNull()
    expect(matchOption("量子史诗", GENRE)).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/zephyr/Code/cine-muse/.claude/worktrees/project-chat && pnpm exec vitest run src/lib/option-match.test.ts`
Expected: FAIL（`option-match` 模块不存在 / import 报错）

- [ ] **Step 3: 最小实现**

创建 `src/lib/option-match.ts`：

```ts
/**
 * 枚举题自由文本归一匹配（聊天式向导用）。
 * 语义：严格命中（alias/label 全等）优先，唯一才返回；否则宽松命中（label 双向包含、
 * searchText 前向包含），唯一才返回；歧义或未命中返回 null —— 枚举字段保持 chips-only，
 * 绝不产生自定义值。
 */

export interface OptionLike<V extends string> {
  value: V
  label: string
  /** 附加可检索文本（如风格描述），仅做前向包含匹配 */
  searchText?: string
  /** 别名（如「竖屏」→ 9:16），全等命中即严格命中 */
  aliases?: readonly string[]
}

export function normalizeOptionText(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ")
}

interface Hit {
  value: string
  strict: boolean
}

export function matchOption<V extends string>(
  text: string,
  options: readonly OptionLike<V>[],
): V | null {
  const n = normalizeOptionText(text)
  if (!n) return null
  const hits: Hit[] = []
  for (const o of options) {
    const normLabel = normalizeOptionText(o.label)
    const strict = o.aliases?.some((a) => normalizeOptionText(a) === n) || normLabel === n
    if (strict) {
      hits.push({ value: o.value, strict: true })
      continue
    }
    const loose =
      normLabel.includes(n) ||
      n.includes(normLabel) ||
      (o.searchText != null && normalizeOptionText(o.searchText).includes(n))
    if (loose) hits.push({ value: o.value, strict: false })
  }
  if (hits.length === 0) return null
  const pool = hits.some((h) => h.strict) ? hits.filter((h) => h.strict) : hits
  const uniq = [...new Set(pool.map((h) => h.value))]
  return uniq.length === 1 ? (uniq[0] as V) : null
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm exec vitest run src/lib/option-match.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 回归 + 提交**

Run: `pnpm test`
Expected: PASS（28 引擎测试 + 新增用例全绿）

```bash
cd /Users/zephyr/Code/cine-muse/.claude/worktrees/project-chat
git add src/lib/option-match.ts src/lib/option-match.test.ts
git commit -m "feat(project-chat): option alias matching lib with vitest coverage"
```

---

### Task 2: 向导常量抽到独立配置模块（旧 wizard 改为引用，行为不变）

**Files:**
- Create: `src/components/projects/new-project-config.tsx`
- Modify: `src/components/projects/new-project-wizard.tsx`（删除本地常量定义，改为从 config import；逻辑零改动）

**Interfaces:**
- Consumes: `STYLE_LIBRARY`/`GENRE_LIBRARY`/`BOOST_SLOTS` from `@/lib/engine/templates`；`MODE_LABEL`/`ASSET_CATEGORY_LABEL`/`NewProjectInput`/`InterventionMode`/`WorkflowTemplate`/`AssetCategory` from `@/lib/types`
- Produces（Task 3 依赖的精确导出）:
  - `export const GENRES: string[]`
  - `export interface StyleOption { id: string; desc: string; gradient: string }` + `export const STYLES: StyleOption[]`
  - `export const DURATIONS: number[]`、`export const DURATION_ITEMS: { value: string; label: string }[]`
  - `export const QUALITY_ITEMS: { value: NewProjectInput["quality"]; label: string }[]`
  - `export const TEMPLATES: { id: WorkflowTemplate; title: string; desc: string; nodes: { name: string; checkpoint?: boolean }[]; recommended?: boolean }[]`
  - `export const MODES: { id: InterventionMode; title: string; desc: string; badge: string; icon: React.ReactNode; recommended?: boolean }[]`

- [ ] **Step 1: 创建配置模块**

创建 `src/components/projects/new-project-config.tsx`，内容为旧 wizard 文件第 42–128 行常量的原样迁移（`GENRES`、`STYLE_OPTIONS`+`STYLES`、`DURATIONS`、`DURATION_ITEMS`、`QUALITY_ITEMS`、`TEMPLATES`、`MODES`；`STEPS` 不迁移——聊天流不再有步骤头）：

```tsx
"use client"

import * as React from "react"
import { EyeIcon, PenLineIcon, SparklesIcon, Wand2Icon, ZapIcon } from "lucide-react"

import { BOOST_SLOTS, GENRE_LIBRARY, STYLE_LIBRARY } from "@/lib/engine/templates"
import { MODE_LABEL } from "@/lib/types"
import type { InterventionMode, NewProjectInput, WorkflowTemplate } from "@/lib/types"

// 题材/风格列表从模板库派生：新增预设自动出现在向导中，避免双份维护漂移
export const GENRES = Object.keys(GENRE_LIBRARY)

export interface StyleOption {
  id: string
  desc: string
  gradient: string
}

const STYLE_OPTIONS: Record<string, { desc: string; gradient: string }> = {
  赛博朋克: { desc: "霓虹蓝紫 · 雨夜反光 · 复古未来", gradient: "from-violet-500/30 via-fuchsia-500/15 to-cyan-500/30" },
  黑色电影: { desc: "低照度硬光 · 阴影切割 · 冷峻", gradient: "from-slate-600/40 via-zinc-800/30 to-slate-900/40" },
  治愈系: { desc: "暖调柔光 · 自然饱和度 · 留白", gradient: "from-amber-400/30 via-orange-300/20 to-rose-400/30" },
  古风: { desc: "水墨质感 · 低饱和青灰 · 对称", gradient: "from-emerald-600/30 via-teal-500/15 to-lime-500/25" },
  赛博国风: { desc: "霓虹 + 水墨 · 青金配色", gradient: "from-sky-500/30 via-teal-400/15 to-amber-400/30" },
  纪实: { desc: "自然光 · 手持晃动 · 真实颗粒", gradient: "from-stone-500/30 via-amber-600/15 to-stone-700/30" },
  动画: { desc: "高饱和 · 风格化形变 · 夸张透视", gradient: "from-rose-500/30 via-orange-400/20 to-yellow-400/30" },
}

export const STYLES: StyleOption[] = Object.keys(STYLE_LIBRARY).map((id) => ({
  id,
  ...STYLE_OPTIONS[id],
}))

export const DURATIONS = [30, 60, 90, 120, 180, 240]

export const DURATION_ITEMS = DURATIONS.map((d) => ({
  value: String(d),
  label: `${d / 60} 分钟`,
}))

export const QUALITY_ITEMS: { value: NewProjectInput["quality"]; label: string }[] = [
  { value: "draft", label: "草稿 (720p)" },
  { value: "standard", label: "标准 (1080p)" },
  { value: "hd", label: "高清 (4K)" },
]

export const TEMPLATES: {
  id: WorkflowTemplate
  title: string
  desc: string
  nodes: { name: string; checkpoint?: boolean }[]
  recommended?: boolean
}[] = [
  {
    id: "full",
    title: "完整流水线",
    desc: "7 个执行环节全流程协作，含质量门禁与人工确认节点",
    recommended: true,
    nodes: [
      { name: "剧本" }, { name: "门禁" }, { name: "分镜" }, { name: "门禁" },
      { name: "风格设定", checkpoint: true }, { name: "场景" }, { name: "视频" },
      { name: "门禁" }, { name: "配音" }, { name: "剪辑", checkpoint: true },
    ],
  },
  {
    id: "quick",
    title: "快速预览",
    desc: "3 个环节出粗剪样片，适合创意验证与提案",
    nodes: [{ name: "剧本" }, { name: "门禁" }, { name: "视频" }, { name: "门禁" }, { name: "成片", checkpoint: true }],
  },
]

export const MODES: {
  id: InterventionMode
  title: string
  desc: string
  badge: string
  icon: React.ReactNode
  recommended?: boolean
}[] = [
  {
    id: "auto",
    title: MODE_LABEL.auto,
    desc: "零打断跑完全流程，直接交付成片",
    badge: "适合批量出片与复跑",
    icon: <ZapIcon className="size-4" />,
  },
  {
    id: "guided",
    title: MODE_LABEL.guided,
    desc: "流程不打断，agents 消费绑定资产作为强约束",
    badge: "「指定这张脸」式前置干预",
    icon: <Wand2Icon className="size-4" />,
    recommended: true,
  },
  {
    id: "review",
    title: MODE_LABEL.review,
    desc: "关键节点（风格设定、成片前）暂停人工确认",
    badge: "2 个确认点",
    icon: <EyeIcon className="size-4" />,
  },
  {
    id: "manual",
    title: MODE_LABEL.manual,
    desc: "审查式基础上，每个环节产出都可手动改写",
    badge: "全程可介入",
    icon: <PenLineIcon className="size-4" />,
  },
]

// 干预深度谱系（L0 全自动 → L3 手作）说明（聊天气泡内引用）
export const MODE_SPECTRUM = (["auto", "guided", "review", "manual"] as const).map(
  (m, i) => `L${i} ${MODE_LABEL[m]}`,
)

// 增强环节选项（Task 3 聊天气泡用；title/desc 来自 BOOST_SLOTS 防止双份维护）
export interface BoostOption {
  agentId: string
  title: string
  description: string
}

export const BOOST_OPTIONS: BoostOption[] = BOOST_SLOTS.map((b) => ({
  agentId: b.agentId,
  title: b.title,
  description: b.description,
}))
```

注：config 内 `BOOST_SLOTS`/`AssetCategory`/`ASSET_CATEGORY_LABEL` 只在 Task 3 组件用到，不在 config 再导出（组件直接从 `@/lib/engine/templates`、`@/lib/types` 导入）。

- [ ] **Step 2: 旧 wizard 改为引用 config**

修改 `src/components/projects/new-project-wizard.tsx`：
- 删除本地定义：第 42 行 `GENRES`、第 45–56 行 `STYLE_OPTIONS`+`STYLES`、第 58–63 行 `DURATIONS`+`DURATION_ITEMS`、第 65–69 行 `QUALITY_ITEMS`、第 71–89 行 `TEMPLATES`、第 91–128 行 `MODES`
- 删除不再使用的 icon 导入（`EyeIcon`、`PenLineIcon`、`Wand2Icon`、`ZapIcon`），保留 `ArrowLeftIcon`、`ArrowRightIcon`、`CheckIcon`、`RocketIcon`、`SparklesIcon`
- 新增导入：`import { DURATION_ITEMS, GENRES, MODES, QUALITY_ITEMS, STYLES, TEMPLATES } from "./new-project-config"`
- 删除原 `import { BOOST_SLOTS, GENRE_LIBRARY, STYLE_LIBRARY } from "@/lib/engine/templates"`、`import { MODE_LABEL } from "@/lib/types"`（类型导入 `InterventionMode` 等保留）
- 其余 JSX/逻辑**零改动**

- [ ] **Step 3: 构建验证**

Run: `pnpm build`
Expected: 通过（tsc 0 错误；wizard 页面行为与之前一致——本 Task 不改变任何可见行为）

- [ ] **Step 4: 提交**

```bash
git add src/components/projects/new-project-config.tsx src/components/projects/new-project-wizard.tsx
git commit -m "refactor(project-chat): extract wizard constants to shared config module"
```

---

### Task 3: 对话式向导主组件

**Files:**
- Create: `src/components/projects/new-project-chat.tsx`

**Interfaces:**
- Consumes: `GENRES/STYLES/DURATIONS/QUALITY_ITEMS/TEMPLATES/MODES/MODE_SPECTRUM/BOOST_OPTIONS` from `./new-project-config`；`matchOption/OptionLike` from `@/lib/option-match`；`BOOST_SLOTS`（不需要——用 BOOST_OPTIONS）；`ASSET_CATEGORY_LABEL`+类型 from `@/lib/types`；`formatMinutes` from `@/lib/format`
- Produces: `export function NewProjectChat()`（Task 4 由 `src/app/projects/new/page.tsx` 引用）

- [ ] **Step 1: 写组件**

创建 `src/components/projects/new-project-chat.tsx`（完整代码）：

```tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CheckIcon, PencilIcon, RocketIcon, SendIcon, SparklesIcon, Wand2Icon } from "lucide-react"

import { useApp } from "@/lib/store"
import { formatMinutes } from "@/lib/format"
import { ASSET_CATEGORY_LABEL } from "@/lib/types"
import type { AssetCategory, InterventionMode, NewProjectInput, WorkflowTemplate } from "@/lib/types"
import { matchOption } from "@/lib/option-match"
import type { OptionLike } from "@/lib/option-match"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  BOOST_OPTIONS,
  DURATIONS,
  GENRES,
  MODES,
  MODE_SPECTRUM,
  QUALITY_ITEMS,
  STYLES,
  TEMPLATES,
} from "./new-project-config"

type RowId =
  | "title" | "premise" | "genre" | "style" | "duration" | "aspect"
  | "quality" | "template" | "boost" | "mode" | "assets"

type Aspect = NewProjectInput["aspectRatio"]
type Quality = NewProjectInput["quality"]

/** 聊天流草稿态：选项类字段在用户作答前为 null（不沿用旧向导的隐式默认值），提交时回落默认 */
interface Draft {
  title: string
  premise: string
  genre: string | null
  style: string | null
  durationSec: number | null
  aspectRatio: Aspect | null
  quality: Quality | null
  template: WorkflowTemplate | null
  interventionMode: InterventionMode | null
  boostAgentIds: string[]
  assetIds: string[]
}

const EMPTY_DRAFT: Draft = {
  title: "",
  premise: "",
  genre: null,
  style: null,
  durationSec: null,
  aspectRatio: null,
  quality: null,
  template: null,
  interventionMode: null,
  boostAgentIds: [],
  assetIds: [],
}

const TITLE_TEXT: Record<RowId, string> = {
  title: "给这部片子起个名字？",
  premise: "用一句话讲清你的故事——它将作为剧本创作的种子输入",
  genre: "想拍什么题材？",
  style: "想要什么视觉风格？",
  duration: "成片目标时长？（影响渲染成本与节奏）",
  aspect: "画面比例？",
  quality: "画质档位？",
  template: "走哪条工作流？",
  boost: "要不要加装增强环节？",
  mode: "希望智能体团队多自由、还是多受控？（干预深度）",
  assets: "要不要绑定资产卡，让 agents 直接消费你的设定？",
}

/** 各行的「选项卡」：chips 行（单选/多选）与 cards 行（风格/模板/模式）统一为 OptionLike + 附加展示字段 */
function optionsFor(row: RowId, draft: Draft, assets: NewProjectChatAssets): OptionLike<string>[] {
  switch (row) {
    case "genre":
      return GENRES.map((g) => ({ value: g, label: g }))
    case "style":
      return STYLES.map((s) => ({ value: s.id, label: s.id, searchText: s.desc }))
    case "duration":
      return DURATIONS.map((d) => ({
        value: String(d),
        label: `${d / 60} 分钟`,
        aliases: durationAliases(d),
      }))
    case "aspect":
      return [
        { value: "16:9", label: "16:9", aliases: ["横屏", "横向", "16比9", "169"] },
        { value: "9:16", label: "9:16", aliases: ["竖屏", "竖向", "9比16", "916"] },
        { value: "1:1", label: "1:1", aliases: ["方形", "正方形", "1比1"] },
      ]
    case "quality":
      return QUALITY_ITEMS.map((q) => ({
        value: q.value,
        label: q.label,
        aliases: qualityAliases(q.value),
      }))
    case "template":
      return TEMPLATES.map((t) => ({ value: t.id, label: t.title }))
    case "mode":
      return MODES.map((m) => ({ value: m.id, label: m.title }))
    case "boost":
      return BOOST_OPTIONS.map((b) => ({ value: b.agentId, label: b.title }))
    case "assets":
      return assets.map((a) => ({ value: a.id, label: a.name, searchText: a.description }))
    default:
      return []
  }
}

function durationAliases(d: number): string[] {
  const min = d / 60
  const out: string[] = [`${d}秒`, `${min}分钟`]
  if (min === 0.5) out.push("半分钟", "30s")
  if (min === 1) out.push("1分钟", "一分钟", "1分", "1min", "60s")
  if (min === 2) out.push("2分钟", "两分钟", "2分", "2min", "120秒")
  if (min === 3) out.push("3分钟", "三分钟", "3分", "180秒")
  if (min === 4) out.push("4分钟", "四分钟", "4分", "240秒")
  return out
}

function qualityAliases(q: Quality): string[] {
  if (q === "draft") return ["草稿", "720", "720p", "低清"]
  if (q === "standard") return ["标准", "1080", "1080p", "标清"]
  return ["高清", "4k", "超清"]
}

/** chips 单选行的「推荐」标注（对齐 spec §2.1：时长首项推荐 2 分钟、画质推荐标准） */
const RECOMMENDED: Partial<Record<RowId, readonly string[]>> = {
  duration: ["120"],
  quality: ["standard"],
}

/** 每行是否已完成（决定「当前问题」= 首个未完成行） */
function isRowComplete(row: RowId, draft: Draft, boostTouched: boolean, assetsTouched: boolean): boolean {
  switch (row) {
    case "title":
      return draft.title.trim().length > 0
    case "premise":
      return draft.premise.trim().length >= 6
    case "genre":
      return draft.genre != null
    case "style":
      return draft.style != null
    case "duration":
      return draft.durationSec != null
    case "aspect":
      return draft.aspectRatio != null
    case "quality":
      return draft.quality != null
    case "template":
      return draft.template != null
    case "boost":
      return draft.template !== "full" || boostTouched
    case "mode":
      return draft.interventionMode != null
    case "assets":
      return assetsTouched
  }
}

/** 行完成后的用户回答摘要（echo 气泡 + 简报卡共用） */
function rowSummary(row: RowId, draft: Draft, assetCount: number): string {
  const boostCount = draft.boostAgentIds.length
  switch (row) {
    case "title":
      return draft.title.trim()
    case "premise":
      return draft.premise.trim()
    case "genre":
      return draft.genre ?? ""
    case "style":
      return draft.style ?? ""
    case "duration":
      return draft.durationSec != null ? formatMinutes(draft.durationSec) : ""
    case "aspect":
      return draft.aspectRatio ?? ""
    case "quality":
      return draft.quality != null
        ? QUALITY_ITEMS.find((q) => q.value === draft.quality)?.label ?? ""
        : ""
    case "template":
      return draft.template === "full" ? "完整流水线" : draft.template === "quick" ? "快速预览" : ""
    case "boost":
      return boostCount > 0 ? `增强环节 ${boostCount} 个` : "不加装增强环节"
    case "mode":
      return MODES.find((m) => m.id === draft.interventionMode)?.title ?? ""
    case "assets":
      return assetCount > 0 ? `绑定资产卡 ${assetCount} 项` : "暂不绑定资产"
  }
}

type NewProjectChatAssets = {
  id: string
  name: string
  category: AssetCategory
  description: string
  tags: string[]
  color: string
}[]

export function NewProjectChat() {
  const router = useRouter()
  const { state, dispatch } = useApp()
  const assets = state.assets.map((a) => ({
    id: a.id, name: a.name, category: a.category,
    description: a.description, tags: a.tags, color: a.color,
  }))

  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT)
  const [boostTouched, setBoostTouched] = React.useState(false)
  const [assetsTouched, setAssetsTouched] = React.useState(false)
  const [editId, setEditId] = React.useState<RowId | null>(null)
  const [note, setNote] = React.useState<{ row: RowId; text: string } | null>(null)
  const [input, setInput] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const bottomRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const ROWS: RowId[] = [
    "title", "premise", "genre", "style", "duration", "aspect",
    "quality", "template", "boost", "mode", "assets",
  ]
  // 可见行：quick 模板不出现增强环节行（分母与就绪判定都基于可见行）
  const VISIBLE_ROWS = ROWS.filter((r) => r !== "boost" || draft.template !== "quick")

  // 当前问题 = 修改回退行 ?? 首个未完成行
  const activeId = React.useMemo(() => {
    if (editId != null) return editId
    return VISIBLE_ROWS.find((r) => !isRowComplete(r, draft, boostTouched, assetsTouched)) ?? null
  }, [draft, boostTouched, assetsTouched, editId])
  const allDone = activeId == null

  // 资产库为空：该行直接判定完成并给说明 note
  React.useEffect(() => {
    if (assets.length === 0 && !assetsTouched) {
      setAssetsTouched(true)
      setNote((prev) => prev ?? { row: "assets", text: "资产库为空——可先到「资产库」创建角色/场景/道具/风格卡，或直接进入下一步" })
    }
  }, [assets.length, assetsTouched])

  // 新问题/就绪：滚动到对应行
  React.useEffect(() => {
    if (activeId == null) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      return
    }
    document.getElementById(`row-${activeId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [activeId])

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))

  /** 单选行作答（点 chip / 模板卡 / 模式卡 / 文本命中） */
  const answerSingle = (row: RowId, value: string) => {
    if (row === "genre") patch({ genre: value })
    else if (row === "style") patch({ style: value })
    else if (row === "duration") patch({ durationSec: Number(value) })
    else if (row === "aspect") patch({ aspectRatio: value as Aspect })
    else if (row === "quality") patch({ quality: value as Quality })
    else if (row === "template") {
      const t = value as WorkflowTemplate
      setBoostTouched((touched) => (t === "full" ? touched : false))
      patch({
        template: t,
        // 与旧 Wizard 的模板联动一致：quick 移除 previs；full 默认补回
        boostAgentIds: t === "quick"
          ? draft.boostAgentIds.filter((id) => id !== "previs")
          : draft.boostAgentIds.includes("previs")
            ? draft.boostAgentIds
            : [...draft.boostAgentIds, "previs"],
      })
    } else if (row === "mode") patch({ interventionMode: value as InterventionMode })
    finishAnswer(row)
  }

  const finishAnswer = (row: RowId) => {
    if (editId === row) setEditId(null)
    setNote(null)
    setInput("")
  }

  const toggleMulti = (row: RowId, value: string) => {
    if (row === "boost") {
      const list = draft.boostAgentIds
      const next = list.includes(value)
        ? list.filter((id) => id !== value)
        : [...list, value]
      patch({ boostAgentIds: next })
      setBoostTouched(true)
    } else if (row === "assets") {
      const list = draft.assetIds
      const next = list.includes(value)
        ? list.filter((id) => id !== value)
        : [...list, value]
      patch({ assetIds: next })
      setAssetsTouched(true)
    }
  }

  /** 底部输入框发送：文本行直接写入；枚举行别名匹配 */
  const sendText = (raw: string) => {
    const text = raw.trim()
    if (!text || activeId == null) return
    if (activeId === "title") {
      patch({ title: text })
      finishAnswer("title")
      return
    }
    if (activeId === "premise") {
      if (text.length < 6) {
        setNote({ row: "premise", text: `再丰满一点，至少 6 个字（当前 ${text.length} 字）` })
        return
      }
      patch({ premise: text })
      finishAnswer("premise")
      return
    }
    // 枚举行：别名归一；未命中给提示、保留输入
    const opts = optionsFor(activeId, draft, assets)
    if (opts.length === 0) return
    const matched = matchOption(text, opts)
    if (matched == null) {
      setNote({ row: activeId, text: `没找到「${text}」对应的选项——点下面选项试试，或换个说法` })
      return
    }
    if (activeId === "boost" || activeId === "assets") {
      toggleMulti(activeId, matched)
      setInput("")
      return
    }
    answerSingle(activeId, matched)
  }

  /** IME 组合态守卫：中文输入法回车不发送 */
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault()
      sendText(input)
    }
  }

  const summaryText = (() => {
    const parts: string[] = []
    if (draft.title.trim()) parts.push(`《${draft.title.trim()}》`)
    else parts.push("未命名")
    if (draft.genre) parts.push(draft.genre)
    if (draft.style) parts.push(draft.style)
    if (draft.durationSec != null) parts.push(formatMinutes(draft.durationSec))
    if (draft.aspectRatio) parts.push(draft.aspectRatio)
    if (draft.quality) parts.push(QUALITY_ITEMS.find((q) => q.value === draft.quality)?.label ?? "")
    if (draft.template) parts.push(draft.template === "full" ? "完整流水线" : "快速预览")
    if (draft.interventionMode) parts.push(MODES.find((m) => m.id === draft.interventionMode)?.title ?? "")
    if (draft.boostAgentIds.length > 0) parts.push(`增强 ${draft.boostAgentIds.length}`)
    if (draft.assetIds.length > 0) parts.push(`资产 ${draft.assetIds.length}`)
    return parts.join(" · ")
  })()

  const answeredCount = VISIBLE_ROWS.filter((r) => isRowComplete(r, draft, boostTouched, assetsTouched)).length
  const totalCount = VISIBLE_ROWS.length

  const buildInput = (): NewProjectInput => ({
    title: draft.title.trim(),
    premise: draft.premise.trim(),
    genre: draft.genre ?? GENRES[0],
    style: draft.style ?? STYLES[0].id,
    durationSec: draft.durationSec ?? 120,
    aspectRatio: draft.aspectRatio ?? "16:9",
    quality: draft.quality ?? "standard",
    template: draft.template ?? "full",
    interventionMode: draft.interventionMode ?? "guided",
    assetIds: draft.assetIds,
    boostAgentIds: draft.boostAgentIds,
  })

  const submit = () => {
    if (submitting) return
    setSubmitting(true)
    dispatch({
      type: "CREATE_PROJECT",
      input: buildInput(),
      now: new Date().toISOString(),
    })
    router.push("/dashboard")
  }

  const renderOptions = (row: RowId) => {
    if (row === "style") {
      const current = draft.style
      return (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
          {STYLES.map((s) => {
            const selected = current === s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => answerSingle("style", s.id)}
                className={`group relative overflow-hidden rounded-lg border p-3 text-left transition-colors ${
                  selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50"
                }`}
              >
                <div className={`mb-2 h-10 rounded-md bg-gradient-to-br ${s.gradient}`} />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{s.id}</span>
                  {selected && (
                    <span className="flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <CheckIcon className="size-2.5" />
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.desc}</p>
              </button>
            )
          })}
        </div>
      )
    }
    if (row === "template") {
      const current = draft.template
      return (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {TEMPLATES.map((t) => {
            const selected = current === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => answerSingle("template", t.id)}
                className={`relative flex flex-col gap-3 rounded-lg border p-4 text-left transition-colors ${
                  selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50"
                }`}
              >
                {t.recommended && (
                  <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    <SparklesIcon className="size-3" /> 推荐
                  </span>
                )}
                <div>
                  <p className="text-sm font-semibold">{t.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.desc}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {t.nodes.map((n, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <span className="text-[11px] text-muted-foreground">→</span>}
                      <span className={`rounded border px-1.5 py-0.5 text-[11px] ${n.checkpoint ? "status-warn" : "border-border text-muted-foreground"}`}>
                        {n.name}
                      </span>
                    </React.Fragment>
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      )
    }
    if (row === "mode") {
      const current = draft.interventionMode
      return (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {MODES.map((m) => {
            const selected = current === m.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => answerSingle("mode", m.id)}
                className={`relative flex flex-col gap-1.5 rounded-lg border p-3.5 text-left transition-colors ${
                  selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50"
                }`}
              >
                {m.recommended && (
                  <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    <SparklesIcon className="size-3" /> 推荐
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <span className={`flex size-7 items-center justify-center rounded-md ${selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {m.icon}
                  </span>
                  <span className="text-sm font-semibold">{m.title}</span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{m.desc}</p>
                <span className="text-[11px] text-muted-foreground/70">{m.badge}</span>
              </button>
            )
          })}
          <div className="sm:col-span-2">
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              干预深度谱系：
              {MODE_SPECTRUM.map((m) => (
                <span key={m} className="rounded border border-border px-1.5 py-0.5 text-[11px]">{m}</span>
              ))}
            </p>
          </div>
        </div>
      )
    }
    if (row === "boost") {
      const selectedList = draft.boostAgentIds
      return (
        <div className="mt-3 space-y-2.5">
          <div className="grid gap-2 sm:grid-cols-2">
            {BOOST_OPTIONS.map((b) => {
              const selected = selectedList.includes(b.agentId)
              return (
                <button
                  key={b.agentId}
                  type="button"
                  onClick={() => toggleMulti("boost", b.agentId)}
                  className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${
                    selected ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                  }`}
                >
                  <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                    {selected && <CheckIcon className="size-2.5" />}
                  </span>
                  <span>
                    <span className="block text-sm font-medium">{b.title}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{b.description}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">完整流水线已包含的风格设定/场景等环节会自动去重跳过</p>
            <Button type="button" size="sm" onClick={() => finishAnswer("boost")}>
              继续
            </Button>
          </div>
        </div>
      )
    }
    if (row === "assets") {
      if (assets.length === 0) return null
      const cats = Object.keys(ASSET_CATEGORY_LABEL) as AssetCategory[]
      return (
        <div className="mt-3 space-y-2.5">
          {cats.map((cat) => {
            const list = assets.filter((a) => a.category === cat)
            if (list.length === 0) return null
            return (
              <div key={cat} className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{ASSET_CATEGORY_LABEL[cat]}卡</p>
                <div className="flex flex-wrap gap-2">
                  {list.map((a) => {
                    const recommended = a.tags.includes(draft.genre ?? "") || a.tags.includes(draft.style ?? "")
                    const selected = draft.assetIds.includes(a.id)
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => toggleMulti("assets", a.id)}
                        className={`group flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                          selected ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                        }`}
                      >
                        <span className={`size-2 rounded-full bg-gradient-to-br ${a.color}`} />
                        <span className="text-xs font-medium">{a.name}</span>
                        {recommended && (
                          <span className="rounded bg-amber-500/15 px-1 py-px text-[11px] font-medium text-warn">推荐</span>
                        )}
                        <span className={`flex size-4 items-center justify-center rounded-full border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                          {selected && <CheckIcon className="size-2.5" />}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">已选 {draft.assetIds.length} 项</p>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => { patch({ assetIds: [] }); setAssetsTouched(true); finishAnswer("assets") }}>
                暂不绑定，跳过
              </Button>
              <Button type="button" size="sm" onClick={() => finishAnswer("assets")}>
                继续
              </Button>
            </div>
          </div>
        </div>
      )
    }
    // chips 单选行：genre / duration / aspect / quality
    const opts = optionsFor(row, draft, assets)
    const current = row === "duration" ? (draft.durationSec != null ? String(draft.durationSec) : null)
      : row === "quality" ? draft.quality
      : row === "aspect" ? draft.aspectRatio
      : draft.genre
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {opts.map((o) => {
          const selected = current === o.value
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => answerSingle(row, o.value)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                selected ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/50"
              }`}
            >
              {o.label}
              {!selected && RECOMMENDED[row]?.includes(o.value) && (
                <span className="rounded bg-primary/10 px-1 py-px text-[10px] font-medium text-primary">推荐</span>
              )}
              {selected && <CheckIcon className="size-3" />}
            </button>
          )
        })}
      </div>
    )
  }

  /** assistant 提问气泡（含气泡底部内嵌选项；已完成行只留问题文本，不可再点） */
  const renderAsk = (row: RowId, active: boolean) => {
    const answered = isRowComplete(row, draft, boostTouched, assetsTouched)
    return (
      <div id={`row-${row}`} className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <SparklesIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className={`rounded-lg border px-4 py-3 text-sm ${active ? "border-border bg-card" : "border-transparent bg-muted/50 text-muted-foreground"}`}>
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">{TITLE_TEXT[row]}</p>
              {answered && !active && (
                <button
                  type="button"
                  aria-label={`修改「${TITLE_TEXT[row]}」`}
                  onClick={() => { setEditId(row); setNote(null); inputRef.current?.focus() }}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-border/60 hover:text-foreground"
                >
                  <PencilIcon className="size-3" /> 修改
                </button>
              )}
            </div>
            {answered && !active ? (
              <p className="mt-0.5 text-xs text-muted-foreground/80">{rowSummary(row, draft, draft.assetIds.length)}</p>
            ) : (
              renderOptions(row)
            )}
          </div>
          {note?.row === row && (
            <p className="mt-1.5 px-1 text-xs text-warn">{note.text}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      {/* 成片简报（常驻顶部） */}
      <div className="sticky top-0 z-20 flex items-center justify-between gap-3 rounded-lg border bg-card/95 px-3 py-2 backdrop-blur-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
          <Wand2Icon className="size-3.5 shrink-0 text-primary" />
          <span className="truncate">{summaryText}</span>
        </div>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
          {answeredCount}/{totalCount}
        </span>
      </div>

      {/* 对话消息流 */}
      <div className="flex flex-col gap-6">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <SparklesIcon className="size-3.5" />
          </span>
          <div className="rounded-lg border bg-card px-4 py-3 text-sm">
            <p className="font-medium">你好，我是 Cine Muse 的导演助手 🎬</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              告诉我你想拍什么，我会逐项确认后让智能体团队开工。也可以随时改前面的回答。
            </p>
          </div>
        </div>

        {VISIBLE_ROWS.map((row) => {
          const complete = isRowComplete(row, draft, boostTouched, assetsTouched)
          return (
            <div key={row} className="flex flex-col gap-2.5">
              {renderAsk(row, activeId === row)}
              {complete && row !== activeId && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                    {rowSummary(row, draft, draft.assetIds.length)}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {allDone && (
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <SparklesIcon className="size-3.5" />
            </span>
            <div className="rounded-lg border bg-card px-4 py-3 text-sm">
              <p className="font-medium">全部就绪 ✅ 确认一下你的成片简报</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{summaryText}</p>
              <Button type="button" className="mt-3" disabled={submitting} onClick={submit}>
                <RocketIcon /> 创建并启动
              </Button>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 底部输入栏（纯文本框；选项内嵌于提问气泡） */}
      <div className="sticky bottom-0 z-20 -mx-1 bg-background/95 px-1 pb-2 pt-1 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              activeId === "title" ? "给作品起个名字，回车确认…"
              : activeId === "premise" ? "一句话讲清你的故事（至少 6 个字）…"
              : activeId != null ? "也可以直接输入文字选择（如「竖屏」「两分钟」「4K」）…"
              : "输入框在此待命 ✨"
            }
            className="h-9"
          />
          <Button type="button" size="sm" className="h-9 shrink-0" disabled={!input.trim() || activeId == null} onClick={() => sendText(input)}>
            <SendIcon /> 发送
          </Button>
        </div>
      </div>
    </div>
  )
}
```

> **注意（adjudicated fix waves）**：上方的示例代码发布于 commit `29e2c45`。终审裁定修复了 5 处示例代码缺陷，以 commits `6b9f925`（多选行「继续」确认当前选择——置 touched 标志；note 清除按行收敛；durationAliases 去重；空 chips 容器守卫）与 `f438b21`（durationAliases 残余秒级重复删除；空资产库行「修改」后的逃生按钮）为准。实现以提交代码为最终事实源。

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: 0 错误。
（如 `tsc --noEmit` 不接受该参数组合，改用 `pnpm build` 验证。）

- [ ] **Step 3: 构建验证**

Run: `pnpm build`
Expected: 通过（组件未接入页面也会被 tsconfig 覆盖编译，类型错误会在此暴露）

- [ ] **Step 4: 提交**

```bash
git add src/components/projects/new-project-chat.tsx
git commit -m "feat(project-chat): conversational new-project wizard (chat shell with inline chips)"
```

---

### Task 4: 路由切换 + 删除旧 wizard + 全量验收

**Files:**
- Modify: `src/app/projects/new/page.tsx`
- Delete: `src/components/projects/new-project-wizard.tsx`

- [ ] **Step 1: 页面换组件**

`src/app/projects/new/page.tsx` 内容改为：

```tsx
import { AppShell } from "@/components/app-shell"
import { NewProjectChat } from "@/components/projects/new-project-chat"

export default function Page() {
  return (
    <AppShell>
      <NewProjectChat />
    </AppShell>
  )
}
```

- [ ] **Step 2: 删除旧 wizard 并确认无残留引用**

Run: `rm src/components/projects/new-project-wizard.tsx`
Run: `grep -rn "new-project-wizard\|NewProjectWizard" src --include="*.tsx" --include="*.ts"`
Expected: 无任何输出（无残留引用）

- [ ] **Step 3: 全量回归**

Run: `pnpm test`
Expected: PASS（28 引擎测试 + option-match 用例全绿）
Run: `pnpm build`
Expected: 通过（0 错误）

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "feat(project-chat): route /projects/new to conversational wizard, drop step wizard"
```

- [ ] **Step 5: 人工验收（对照 spec §8 验收清单）**

启动 dev：`pnpm dev`（或 `pnpm dev:all`），浏览器打开 `/projects/new`（先在库中登录态下进入 dashboard 的「新建项目」入口）。逐项核对：

- [ ] 三入口（site-header / app-sidebar / dashboard 空态）均进入对话式界面
- [ ] 完整走完 11 行（quick 模板时 10 行）可创建项目；创建后跳转 dashboard，项目卡片字段与旧 Wizard 相同输入一致
- [ ] 输入框试「竖屏」「两分钟」「4K」→ 对应 chip 选中推进；试「量子史诗」→ 出现「没找到『xx』」提示且输入保留
- [ ] 模板选「快速预览」→ 增强环节行消失且 previs 从简报消失；改回「完整流水线」→ 增强行出现、previs 默认勾选
- [ ] 点任意已答问题的「修改」→ 回滚到该行激活，改后简报/后续摘要联动更新
- [ ] 中文输入法组词时按回车不发送（候选词正常上屏后再回车才发送）
- [ ] 资产库为空时资产行出现提示并自动跳过；有资产时选择/跳过/推荐标签正常
- [ ] 创意不足 6 字发送 → 行内提示；标题空输入时发送按钮 disabled → 标题行保持未完成（不能推进）
- [ ] 就绪卡「创建并启动」双击不重复创建
- [ ] 视觉核对：气泡圆角/配色/间距与 shadcn token 一致；移动端换行正常

**Step 5 备注（标题空输入行为）：** 空输入时发送按钮 disabled（`disabled={!input.trim() || activeId == null}`），Enter 由同一 `sendText` 入口拦截——标题行保持未完成即「不能进入下一步」，与旧 wizard 语义一致；不需要额外提示气泡，**不要**在 `sendText` 里加 title 空串提示分支。

- [ ] **Step 6: 修复验收发现的问题并提交**

如有问题，修复后运行 `pnpm test && pnpm build` 全绿再提交：
`git commit -m "fix(project-chat): …（描述修复内容）"`
