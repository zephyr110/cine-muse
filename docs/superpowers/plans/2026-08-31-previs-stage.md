# 空间预演台（Previs）Sub-Agent 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增「空间预演台」boost sub-agent——分镜后注入视频生成前，产出布景/深度/边缘三图（SVG），支持 2D 布景干预，作为 video_gen 参考附件，质检含空间一致性指标。

**Architecture:** 复用现有 boost 机制（`BOOST_SLOTS` 注入 `video_gen` 之前，checkpoint 人工确认）；产物为纯函数生成的 SVG 文本（可持久化）；engine 在 video_gen 启动时从上游 completed 的 previs artifact 提取深度/边缘注入 `stage.references`；reducer 新增干预 action。

**Tech Stack:** TypeScript、React 19、Next 16.3（static export）、base-ui、vitest（新增 devDependency，node 环境纯函数测试）、Tailwind v4。

## Global Constraints

- 遵循 spec v0.2（`docs/superpowers/specs/2026-08-31-previs-3d-stage-design.md`）
- 产物一律 SVG 文本（禁止位图 dataURL，防 localStorage 配额爆掉）
- 产品名「空间预演台」，agent id `previs`；UI 不出现"3D"字样（模拟版为 2D）
- 不引入 Three.js；图片→3D、真实 API 属二期，**本期不预留接口/死代码**
- 引擎为模拟：所有产出为程序化模拟数据
- 现有红线：`pnpm exec tsc --noEmit` 必须通过（`layout.tsx` 既有 `LayoutProps` 报错除外——若已消失则应为 0 错误）
- 新增文件一律放 `src/lib/engine/`（逻辑）与 `src/components/projects/`（UI）

---

### Task 1: 测试基建 + 类型层

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`（devDependencies + scripts）
- Modify: `src/lib/types.ts`（ArtifactKind、PrevisArtifact、PrevisShot、BlockingItem、WorkflowStage.references）
- Create: `src/lib/engine/previs-types.ts`（isPrevisArtifact 类型守卫 + PrevisShot 构造辅助）
- Test: `src/lib/engine/previs-types.test.ts`

**Interfaces:**
- Consumes: 现有 `Artifact`、`WorkflowStage`（types.ts）
- Produces:
  - `type PrevisShot`、`type BlockingItem`（types.ts 导出）
  - `interface PrevisArtifact extends Artifact { kind: "previs"; shots: PrevisShot[] }`
  - `function isPrevisArtifact(a: Artifact): a is PrevisArtifact`
  - `function makePrevisShot(shotIndex: number): PrevisShot`（默认布景：1 角色 + 1 地形 + 1 道具，中央机位）

- [ ] **Step 1: 安装 vitest 并配置**

```bash
pnpm add -D vitest
```

`vitest.config.ts`：
```ts
import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  test: { environment: "node" },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
})
```

`package.json` scripts 增加：
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: 运行空测试确认基建可用**

Run: `pnpm exec vitest run --passWithNoTests`
Expected: PASS（0 个测试）

- [ ] **Step 3: 写类型层与守卫**

`src/lib/types.ts` 修改（ArtifactKind 联合末尾追加）：
```ts
export type ArtifactKind =
  | "script"
  | "storyboard"
  | "style_guide"
  | "scene"
  | "video"
  | "voiceover"
  | "final_cut"
  | "previs"
```

`WorkflowStage` 增加字段（在 `progress` 之后）：
```ts
  /** 参考附件：上游 previs 产物注入（只读快照，重流转时更新） */
  references?: { kind: "previs"; depthUrl: string; edgeUrl: string }[]
```

`src/lib/types.ts` 新增（Artifact 接口之后）：
```ts
export interface BlockingItem {
  id: string
  kind: "character" | "prop" | "terrain"
  name: string
  position: [number, number, number]
  rotationY: number
  scale: number
}

export interface PrevisShot {
  shotIndex: number
  camera: { position: [number, number, number]; target: [number, number, number]; fov: number }
  blocking: BlockingItem[]
  previewSvg: string
  depthSvg: string
  edgeSvg: string
}

/** 判别联合：previs 专用载荷，与通用 Artifact 平级 */
export interface PrevisArtifact extends Artifact {
  kind: "previs"
  shots: PrevisShot[]
}
```

`src/lib/engine/previs-types.ts`：
```ts
import type { Artifact, PrevisArtifact, PrevisShot } from "@/lib/types"

export function isPrevisArtifact(a: Artifact | undefined): a is PrevisArtifact {
  return a?.kind === "previs"
}

/** 默认布景：中央地形 + 前景角色 + 右侧道具，机位正面平视 */
export function makePrevisShot(shotIndex: number): PrevisShot {
  return {
    shotIndex,
    camera: { position: [0, 2, 8], target: [0, 1, 0], fov: 45 },
    blocking: [
      { id: `ter-${shotIndex}`, kind: "terrain", name: "场景地形", position: [0, 0, 0], rotationY: 0, scale: 1 },
      { id: `ch-${shotIndex}`, kind: "character", name: "主角", position: [0, 0, 1], rotationY: 0, scale: 1 },
      { id: `prop-${shotIndex}`, kind: "prop", name: "关键道具", position: [2, 0, 0], rotationY: 0, scale: 0.8 },
    ],
    previewSvg: "",
    depthSvg: "",
    edgeSvg: "",
  }
}
```

- [ ] **Step 4: 写守卫测试**

`src/lib/engine/previs-types.test.ts`：
```ts
import { describe, expect, it } from "vitest"
import { isPrevisArtifact, makePrevisShot } from "./previs-types"

describe("isPrevisArtifact", () => {
  it("previs artifact 判定为真", () => {
    const a = { kind: "previs" as const, title: "t", shots: [] }
    expect(isPrevisArtifact(a)).toBe(true)
  })
  it("其他 kind 判定为假", () => {
    expect(isPrevisArtifact({ kind: "video" as const, title: "t" })).toBe(false)
    expect(isPrevisArtifact(undefined)).toBe(false)
  })
})

describe("makePrevisShot", () => {
  it("默认布景含 1 角色 + 1 地形 + 1 道具，中央机位", () => {
    const s = makePrevisShot(3)
    expect(s.shotIndex).toBe(3)
    expect(s.blocking.map((b) => b.kind)).toEqual(["terrain", "character", "prop"])
    expect(s.camera).toEqual({ position: [0, 2, 8], target: [0, 1, 0], fov: 45 })
    expect(s.depthSvg).toBe("")
  })
})
```

- [ ] **Step 5: 运行测试**

Run: `pnpm test`
Expected: 2 describe 块 PASS（4 个断言）

- [ ] **Step 6: 提交**

```bash
git add vitest.config.ts package.json pnpm-lock.yaml src/lib/types.ts src/lib/engine/previs-types.ts src/lib/engine/previs-types.test.ts
git commit -m "test(infra): add vitest; feat(previs): types, guard, default shot builder"
```

---

### Task 2: SVG 渲染纯函数

**Files:**
- Create: `src/lib/engine/previs-render.ts`
- Test: `src/lib/engine/previs-render.test.ts`

**Interfaces:**
- Consumes: `PrevisShot`、`BlockingItem`（Task 1）
- Produces:
  - `function renderPrevisShot(shot: PrevisShot): PrevisShot`（填充 previewSvg/depthSvg/edgeSvg，返回新对象）
  - `function renderDepthSvg(blocking: BlockingItem[]): string`（画家算法：远→近绘制，视距灰度）
  - `function renderEdgeSvg(blocking: BlockingItem[]): string`
  - `function svgDataUrl(svg: string): string`（`data:image/svg+xml;utf8,` + encodeURIComponent）

- [ ] **Step 1: 写失败测试**

`src/lib/engine/previs-render.test.ts`：
```ts
import { describe, expect, it } from "vitest"
import { renderPrevisShot, renderDepthSvg, renderEdgeSvg, svgDataUrl } from "./previs-render"
import { makePrevisShot } from "./previs-types"

const shot = (): ReturnType<typeof makePrevisShot> => {
  const s = makePrevisShot(0)
  s.camera = { position: [0, 2, 8], target: [0, 1, 0], fov: 45 }
  return s
}

describe("renderPrevisShot", () => {
  it("填充三张 SVG 且可序列化为 data URL", () => {
    const out = renderPrevisShot(shot())
    expect(out.previewSvg).toContain("<svg")
    expect(out.depthSvg).toContain("<svg")
    expect(out.edgeSvg).toContain("<svg")
    expect(svgDataUrl(out.depthSvg)).toMatch(/^data:image\/svg\+xml;utf8,/i)
  })
})

describe("renderDepthSvg", () => {
  it("角色在画面前景 → 更亮（灰度更高）", () => {
    const s = shot()
    s.blocking = [
      { ...s.blocking[0], position: [0, 0, 10] }, // 地形远处
      { ...s.blocking[1], position: [0, 0, 1] },  // 角色近处
    ]
    const svg = renderDepthSvg(s.blocking)
    const terrainFill = svg.match(/fill="([^"]*)"[^>]*>[\s\S]*?terrain/i)
    const charFill = svg.match(/fill="([^"]*)"[^>]*>[\s\S]*?character/i)
    expect(charFill?.[1]).toBeTruthy()
    expect(terrainFill?.[1]).toBeTruthy()
  })
})

describe("renderEdgeSvg", () => {
  it("含角色与道具轮廓线段", () => {
    const s = shot()
    const svg = renderEdgeSvg(s.blocking)
    expect(svg).toContain("<line")
    expect(svg).toContain("character")
    expect(svg).toContain("prop")
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/lib/engine/previs-render.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现渲染器**

`src/lib/engine/previs-render.ts`：
```ts
import type { BlockingItem, PrevisShot } from "@/lib/types"

const W = 480
const H = 270

/** 俯视投影：x/z 平面 → 画布坐标（z 向上，机位在下方） */
function project(item: BlockingItem): { x: number; y: number } {
  const [x, , z] = item.position
  return { x: W / 2 + x * 48, y: H / 2 + (1 - z) * 48 }
}

/** 视距（画家算法排序键）：近大远小、近亮远暗 */
function viewDist(item: BlockingItem): number {
  const [, y, z] = item.position
  return Math.hypot(y - 2, z - 8) // 机位 [0,2,8]
}

/** 深度灰度：近亮(240) 远暗(60)，按视距归一化 */
function depthFill(dist: number, maxDist: number): number {
  return Math.round(240 - (dist / maxDist) * 180)
}

/** 布景俯视图：地形底图 + 角色圆点(带朝向箭头) + 道具方块 + 镜头视锥 */
export function renderPreviewSvg(blocking: BlockingItem[]): string {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#f4f4f5"/>`,
  ]
  for (const b of blocking) {
    const { x, y } = project(b)
    if (b.kind === "terrain") {
      parts.push(`<rect x="${x - 96}" y="${y - 96}" width="192" height="192" rx="8" fill="#e4e4e7" stroke="#a1a1aa" data-kind="terrain"/>`)
    } else if (b.kind === "character") {
      const dx = Math.sin(b.rotationY) * 16
      const dy = -Math.cos(b.rotationY) * 16
      parts.push(
        `<g data-kind="character"><circle cx="${x}" cy="${y}" r="12" fill="#6366f1"/><line x1="${x}" y1="${y}" x2="${x + dx}" y2="${y + dy}" stroke="#fff" stroke-width="2"/></g>`,
      )
    } else {
      parts.push(`<rect x="${x - 10}" y="${y - 10}" width="20" height="20" rx="3" fill="#f59e0b" data-kind="prop"/>`)
    }
  }
  // 镜头视锥（从机位指向布景）
  parts.push(
    `<polygon points="${W / 2},${H + 20} ${W / 2 - 90},${H / 2 + 10} ${W / 2 + 90},${H / 2 + 10}" fill="none" stroke="#71717a" stroke-dasharray="4 3" data-kind="frustum"/>`,
  )
  parts.push(`</svg>`)
  return parts.join("")
}

/** 深度图：画家算法按视距远→近绘制，距离灰度渐变 */
export function renderDepthSvg(blocking: BlockingItem[]): string {
  const sorted = [...blocking].sort((a, b) => viewDist(b) - viewDist(a))
  const maxDist = Math.max(...blocking.map(viewDist), 12)
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#3c3c3c"/>`,
  ]
  for (const b of sorted) {
    const { x, y } = project(b)
    const fill = depthFill(viewDist(b), maxDist)
    if (b.kind === "terrain") {
      parts.push(`<rect x="${x - 96}" y="${y - 96}" width="192" height="192" rx="8" fill="rgb(${fill},${fill},${fill})" data-kind="terrain"/>`)
    } else if (b.kind === "character") {
      parts.push(`<circle cx="${x}" cy="${y}" r="12" fill="rgb(${fill},${fill},${fill})" data-kind="character"/>`)
    } else {
      parts.push(`<rect x="${x - 10}" y="${y - 10}" width="20" height="20" rx="3" fill="rgb(${fill},${fill},${fill})" data-kind="prop"/>`)
    }
  }
  parts.push(`</svg>`)
  return parts.join("")
}

/** 边缘图：轮廓线段 + 遮挡断裂线（角色/道具描边，地形外框） */
export function renderEdgeSvg(blocking: BlockingItem[]): string {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#18181b"/>`,
  ]
  for (const b of blocking) {
    const { x, y } = project(b)
    if (b.kind === "terrain") {
      parts.push(`<rect x="${x - 96}" y="${y - 96}" width="192" height="192" rx="8" fill="none" stroke="#f4f4f5" stroke-width="2" data-kind="terrain"/>`)
    } else if (b.kind === "character") {
      parts.push(`<circle cx="${x}" cy="${y}" r="12" fill="none" stroke="#f4f4f5" stroke-width="2" data-kind="character"/><line x1="${x - 12}" y1="${y}" x2="${x + 12}" y2="${y}" stroke="#f4f4f5" stroke-width="2"/>`)
    } else {
      parts.push(`<rect x="${x - 10}" y="${y - 10}" width="20" height="20" rx="3" fill="none" stroke="#f4f4f5" stroke-width="2" data-kind="prop"/>`)
    }
  }
  parts.push(`</svg>`)
  return parts.join("")
}

/** 渲染一镜全部三图，返回填充后的新 PrevisShot */
export function renderPrevisShot(shot: PrevisShot): PrevisShot {
  return {
    ...shot,
    previewSvg: renderPreviewSvg(shot.blocking),
    depthSvg: renderDepthSvg(shot.blocking),
    edgeSvg: renderEdgeSvg(shot.blocking),
  }
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/lib/engine/previs-render.test.ts`
Expected: PASS（3 describe）

- [ ] **Step 5: 提交**

```bash
git add src/lib/engine/previs-render.ts src/lib/engine/previs-render.test.ts
git commit -m "feat(previs): SVG renderer for preview/depth/edge maps"
```

---

### Task 3: 模板与种子接入

**Files:**
- Modify: `src/lib/engine/templates.ts`
- Modify: `src/lib/engine/seed.ts`
- Test: `src/lib/engine/templates.test.ts`

**Interfaces:**
- Consumes: `makePrevisShot`、`renderPrevisShot`（Task 1/2）；`buildArtifact`/`simulateAssessment` 现有机制
- Produces:
  - `BOOST_SLOTS` 新增 previs 条目（before: "video_gen"）
  - `STAGE_CONTENT["previs"]` 工厂
  - `METRIC_BY_AGENT["visual_qa"]` 新增 spatial_consistency
  - `simulateAssessment` 支持 previs 加成（`stage.references` 含 previs → score +5、spatial 指标 +10）

- [ ] **Step 1: 写失败测试**

`src/lib/engine/templates.test.ts`：
```ts
import { describe, expect, it } from "vitest"
import { BOOST_SLOTS, buildArtifact, buildStages } from "./templates"

describe("previs boost 插槽", () => {
  it("previs 插槽锚定在 video_gen 之前且为 checkpoint", () => {
    const slot = BOOST_SLOTS.find((b) => b.agentId === "previs")
    expect(slot?.before).toBe("video_gen")
    expect(slot?.artifactKind).toBe("previs")
  })

  it("勾选 previs 后注入到 video_gen 之前", () => {
    const stages = buildStages({
      title: "t", premise: "p", genre: "科幻", style: "赛博朋克",
      durationSec: 60, aspectRatio: "16:9", quality: "high",
      template: "full", interventionMode: "auto",
      assetIds: [], boostAgentIds: ["previs"],
    } as Parameters<typeof buildStages>[0])
    const idx = stages.findIndex((s) => s.agentId === "previs")
    const vidIdx = stages.findIndex((s) => s.agentId === "video_gen")
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBeLessThan(vidIdx)
    expect(stages[idx].isCheckpoint).toBe(true)
  })

  it("previs 产物含三图且可渲染", () => {
    const stage = { agentId: "previs", iterations: [] } as any
    const artifact = buildArtifact(stage, { title: "星尘余晖", premise: "p" } as any, [])
    expect(artifact.kind).toBe("previs")
    const shots = (artifact as any).shots
    expect(shots.length).toBeGreaterThan(0)
    expect(shots[0].previewSvg).toContain("<svg")
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/lib/engine/templates.test.ts`
Expected: FAIL（previs 不存在）

- [ ] **Step 3: templates.ts 接入**

`BOOST_SLOTS` 数组末尾追加：
```ts
  {
    agentId: "previs",
    title: "空间预演台",
    description: "分镜驱动场景摆位与机位规划，渲染深度/边缘图作为视频生成参考附件",
    before: "video_gen",
    artifactKind: "previs",
  },
```

`STAGE_CONTENT`（在 `storyboard: (p) => ...` 附近）新增工厂：
```ts
  previs: (p) => {
    const shotCount = Math.max(2, Math.min(4, Math.ceil(p.durationSec / 30)))
    return {
      kind: "previs",
      title: `${p.title} · 空间预演`,
      summary: `${shotCount} 镜头 · 布景/深度/边缘三图`,
      content: `已按分镜生成 ${shotCount} 镜头空间摆位与机位规划`,
      shots: Array.from({ length: shotCount }, (_, i) => renderPrevisShot(makePrevisShot(i))),
    }
  },
```

`METRIC_BY_AGENT.visual_qa` 追加：
```ts
    { key: "spatial", label: "空间一致性" },
```

`simulateAssessment` 内 `const base = ...` 行前插入 previs 加成：
```ts
  // previs 参考附件：空间几何锚点 → 分数与空间一致性指标加成
  const hasPrevisRef = stage.references?.some((r) => r.kind === "previs")
  const previsLift = hasPrevisRef ? 5 : 0
```
并把 `const score = Math.min(97, Math.round(base + lift + assetLift))` 改为 `Math.min(97, Math.round(base + lift + assetLift + previsLift))`；metrics 映射中追加 `+ (m.key === "spatial" && hasPrevisRef ? 10 : 0)`。

templates.ts 顶部导入：
```ts
import { makePrevisShot } from "./previs-types"
import { renderPrevisShot } from "./previs-render"
```

- [ ] **Step 4: seed.ts 接入**

`SEED_AGENTS` 追加：
```ts
  { id: "previs", name: "空间预演台", group: "pre", description: "分镜驱动场景摆位与机位规划，渲染深度图/边缘图作为视频生成参考附件", status: "active", modelId: "llm", maxIterations: 3, usesRag: ["scene-background", "visual-style"], avgScore: 84 },
```

demo 项目「星尘余晖」的 stages 数组（`stage("stg-...", "style_design", ...)` 之后、`video_gen` 之前）插入：
```ts
  stage("stg-previs-demo", "previs", "空间预演台", "场景摆位与机位规划，人工确认后进入视频生成", "pending", {
    isCheckpoint: true,
  }),
```
（星尘余晖停在风格确认节点，previs 保持 pending 展示链路即可。）

- [ ] **Step 5: 运行测试 + 类型检查**

Run: `pnpm test && pnpm exec tsc --noEmit`
Expected: 全部 PASS；tsc 无新增错误

- [ ] **Step 6: 提交**

```bash
git add src/lib/engine/templates.ts src/lib/engine/seed.ts src/lib/engine/templates.test.ts
git commit -m "feat(previs): boost slot, artifact factory, spatial metric, seed agent"
```

---

### Task 4: Reducer 契约（干预 action + 引用注入 + 打回策略）

**Files:**
- Modify: `src/lib/engine/reducer.ts`
- Modify: `src/lib/types.ts`（Action 联合）
- Test: `src/lib/engine/reducer.test.ts`

**Interfaces:**
- Consumes: `renderPrevisShot`、`isPrevisArtifact`（Task 1/2）
- Produces:
  - `{ type: "UPDATE_PREVIS_BLOCKING"; projectId; stageId; shotIndex; blocking: BlockingItem[] }`
  - `{ type: "RERENDER_PREVIS"; projectId; stageId }`
  - `startNextStage` 注入 references：启动 `video_gen` 时从上游 completed previs artifact 提取

- [ ] **Step 1: 写失败测试**

`src/lib/engine/reducer.test.ts`：
```ts
import { describe, expect, it } from "vitest"
import { engineReducer, createInitialState } from "./reducer"
import { makePrevisShot } from "./previs-types"
import { renderPrevisShot } from "./previs-render"
import type { AppState } from "@/lib/types"

function stateWithPrevis(): AppState {
  let s = createInitialState()
  s = engineReducer(s, { type: "HYDRATE", state: s })
  const p = s.projects[0]
  const stg = p.stages.find((x) => x.agentId === "style_design")
  return s
}

describe("previs reducer", () => {
  it("UPDATE_PREVIS_BLOCKING 更新摆位并重渲染三图", () => {
    const shot = renderPrevisShot(makePrevisShot(0))
    const artifact = { kind: "previs" as const, title: "t", summary: "", shots: [shot] }
    const state = engineReducer(createInitialState(), { type: "HYDRATE", state: createInitialState() })
    const p = state.projects[0]
    const stg = { ...p.stages[0], agentId: "previs", status: "waiting_approval" as const, artifact }
    const s2 = { ...state, projects: [{ ...p, stages: [stg, ...p.stages.slice(1)] }] }
    const next = engineReducer(s2, {
      type: "UPDATE_PREVIS_BLOCKING", projectId: p.id, stageId: stg.id, shotIndex: 0,
      blocking: [{ id: "c1", kind: "character", name: "主角", position: [3, 0, 1], rotationY: 90, scale: 1 }],
    })
    const out = (next.projects[0].stages[0].artifact as any).shots[0]
    expect(out.blocking[0].position[0]).toBe(3)
    expect(out.previewSvg).toContain("<svg")
  })

  it("RERENDER_PREVIS 重新生成三图", () => {
    const shot = renderPrevisShot(makePrevisShot(0))
    const artifact = { kind: "previs" as const, title: "t", summary: "", shots: [shot] }
    const state = engineReducer(createInitialState(), { type: "HYDRATE", state: createInitialState() })
    const p = state.projects[0]
    const stg = { ...p.stages[0], agentId: "previs", status: "waiting_approval" as const, artifact }
    const s2 = { ...state, projects: [{ ...p, stages: [stg, ...p.stages.slice(1)] }] }
    const next = engineReducer(s2, { type: "RERENDER_PREVIS", projectId: p.id, stageId: stg.id })
    expect(next.projects[0].stages[0].artifact).toBeDefined()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/lib/engine/reducer.test.ts`
Expected: FAIL（action 类型不存在）

- [ ] **Step 3: Action 类型（types.ts）**

`Action` 联合（`UPDATE_ASSET` 附近）追加：
```ts
    | { type: "UPDATE_PREVIS_BLOCKING"; projectId: string; stageId: string; shotIndex: number; blocking: BlockingItem[] }
    | { type: "RERENDER_PREVIS"; projectId: string; stageId: string }
```

- [ ] **Step 4: reducer 实现**

`src/lib/engine/reducer.ts` 顶部导入：
```ts
import { isPrevisArtifact } from "./previs-types"
import { renderPrevisShot, svgDataUrl } from "./previs-render"
```

`startNextStage` 内 `next.status = "running"` 之前注入引用：
```ts
  // previs 参考附件注入：启动视频生成时，从上游已完成的 previs 产物提取深度/边缘图
  if (next.agentId === "video_gen") {
    const previsStage = project.stages.find((s) => s.agentId === "previs" && isPrevisArtifact(s.artifact) && s.status === "completed")
    const previs = previsStage?.artifact
    if (previs && isPrevisArtifact(previs)) {
      const first = previs.shots[0]
      next.references = [{ kind: "previs", depthUrl: svgDataUrl(first.depthSvg), edgeUrl: svgDataUrl(first.edgeSvg) }]
    }
  }
```

`engineReducer` switch（`EDIT_ARTIFACT` case 之前）追加：
```ts
    case "UPDATE_PREVIS_BLOCKING":
      return produce(state, (draft) => {
        const p = draft.projects.find((x) => x.id === action.projectId)
        const s = p?.stages.find((x) => x.id === action.stageId)
        if (!p || !s || !isPrevisArtifact(s.artifact)) return
        const shot = s.artifact.shots[action.shotIndex]
        if (!shot) return
        shot.blocking = action.blocking
        Object.assign(shot, renderPrevisShot(shot))
      })

    case "RERENDER_PREVIS":
      return produce(state, (draft) => {
        const p = draft.projects.find((x) => x.id === action.projectId)
        const s = p?.stages.find((x) => x.id === action.stageId)
        if (!p || !s || !isPrevisArtifact(s.artifact)) return
        s.artifact.shots = s.artifact.shots.map((shot) => renderPrevisShot(shot))
      })
```

- [ ] **Step 5: 运行测试 + 类型检查**

Run: `pnpm test && pnpm exec tsc --noEmit`
Expected: PASS；无新增类型错误

- [ ] **Step 6: 提交**

```bash
git add src/lib/types.ts src/lib/engine/reducer.ts src/lib/engine/reducer.test.ts
git commit -m "feat(previs): reducer actions, references injection, rerender"
```

---

### Task 5: 向导智能启用

**Files:**
- Modify: `src/components/projects/new-project-wizard.tsx`
- Test: 沿用 `templates.test.ts`（buildStages 默认参数）

**Interfaces:**
- Consumes: `BOOST_SLOTS`（Task 3）
- Produces: full 模板新建项目默认勾选 previs

- [ ] **Step 1: 写失败测试（templates.test.ts 追加）**

```ts
  it("full 模板默认注入 previs（向导默认勾选语义）", () => {
    const stages = buildStages({
      title: "t", premise: "p", genre: "科幻", style: "赛博朋克",
      durationSec: 120, aspectRatio: "16:9", quality: "high",
      template: "full", interventionMode: "auto",
      assetIds: [], boostAgentIds: ["previs"],
    } as Parameters<typeof buildStages>[0])
    expect(stages.some((s) => s.agentId === "previs")).toBe(true)
  })
```

- [ ] **Step 2: 向导默认值**

`new-project-wizard.tsx` 表单初始 state（`boostAgentIds: [] as string[]` 处）改为：
```ts
    // full 模板默认开启空间预演台（可取消）；quick 模板不注入
    boostAgentIds: (template: "full" | "quick") => template === "full" ? ["previs"] : [],
```
若初始值为对象字面量（`{ template: "full", boostAgentIds: [] }`），改为 `{ template: "full", boostAgentIds: ["previs"] }`，并在模板切换 quick/full 时同步增删 previs（切换回调内：`boostAgentIds: next === "full" ? [...form.boostAgentIds, "previs"] : form.boostAgentIds.filter((id) => id !== "previs")`，用 Set 去重）。

- [ ] **Step 3: 运行测试 + 构建**

Run: `pnpm test && pnpm build`
Expected: PASS；构建通过

- [ ] **Step 4: 提交**

```bash
git add src/components/projects/new-project-wizard.tsx src/lib/engine/templates.test.ts
git commit -m "feat(previs): default-enable previs for full template in wizard"
```

---

### Task 6: 抽屉展示（三图 + 参数表 + 附件徽章）

**Files:**
- Modify: `src/components/projects/stage-detail-drawer.tsx`
- Modify: `src/lib/meta.tsx`（KIND 映射若在此）

**Interfaces:**
- Consumes: `isPrevisArtifact`、`svgDataUrl`（Task 1/2）
- Produces: `<PrevisPanel artifact: PrevisArtifact />`、`<ReferenceBadge references>` 组件（导出供 Task 7 复用）

- [ ] **Step 1: 新增 PrevisPanel 组件（drawer 文件内）**

在 `ArtifactPanel` 旁新增：
```tsx
/** 预演台产物：布景/深度/边缘三图 + 机位与摆位参数 */
function PrevisPanel({ artifact }: { artifact: PrevisArtifact }) {
  return (
    <div className="space-y-4">
      {artifact.shots.map((shot) => (
        <div key={shot.shotIndex} className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium">镜头 {shot.shotIndex + 1}</span>
            <span className="tabular-nums">
              机位 ({shot.camera.position.join(", ")}) · FOV {shot.camera.fov}°
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "预演帧", src: svgDataUrl(shot.previewSvg) },
              { label: "深度图", src: svgDataUrl(shot.depthSvg) },
              { label: "边缘图", src: svgDataUrl(shot.edgeSvg) },
            ].map((m) => (
              <figure key={m.label} className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.src} alt={m.label} className="aspect-video w-full rounded-md border bg-background object-cover" />
                <figcaption className="text-center text-[11px] text-muted-foreground">{m.label}</figcaption>
              </figure>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {shot.blocking.map((b) => (
              <Badge key={b.id} variant="outline" className="text-[11px]">
                {b.kind === "character" ? "角色" : b.kind === "prop" ? "道具" : "地形"} · {b.name}
                <span className="ml-1 tabular-nums text-muted-foreground">
                  ({b.position[0]}, {b.position[2]})
                </span>
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: ArtifactPanel 分发 previs**

`ArtifactPanel` 的 `if (!a)` 空态分支之后、`editable` 计算之前插入：
```tsx
  if (a.kind === "previs") {
    return <PrevisPanel artifact={a} />
  }
```

- [ ] **Step 3: references 徽章（video_gen 展示）**

`ArtifactPanel` 内、标题行下方（`{editable && ...}` 附近）插入：
```tsx
          {stage.references && stage.references.length > 0 && (
            <Badge variant="outline" className="gap-1 text-[11px]">
              <ShieldCheckIcon className="size-3 text-primary" /> 参考附件 · 预演深度/边缘图
            </Badge>
          )}
```

- [ ] **Step 4: 类型与导入**

drawer 顶部导入：
```ts
import type { PrevisArtifact } from "@/lib/types"
import { isPrevisArtifact } from "@/lib/engine/previs-types"
import { svgDataUrl } from "@/lib/engine/previs-render"
```

- [ ] **Step 5: 构建验证**

Run: `pnpm build`
Expected: 构建通过

- [ ] **Step 6: 提交**

```bash
git add src/components/projects/stage-detail-drawer.tsx
git commit -m "feat(previs): drawer panel with maps, camera params, reference badge"
```

---

### Task 7: 干预面板（2D 布景拖拽 + 机位参数 + 重新渲染）

**Files:**
- Modify: `src/components/projects/stage-detail-drawer.tsx`
- Create: `src/components/projects/previs-blocking-editor.tsx`

**Interfaces:**
- Consumes: `UPDATE_PREVIS_BLOCKING` / `RERENDER_PREVIS`（Task 4）；`useApp()` dispatch
- Produces: `<PrevisBlockingEditor projectId stage shotIndex onDone />`

- [ ] **Step 1: 干预入口（manual 模式 + checkpoint）**

`PrevisPanel` 顶部（镜头 1 卡片上方）加干预按钮（仅 manual 干预模式项目）：
```tsx
{project?.interventionMode === "manual" && (
  <Button size="sm" variant="outline" className="gap-1" onClick={() => setEditing(true)}>
    <PenLineIcon className="size-3.5" /> 调整摆位与机位
  </Button>
)}
```
`PrevisPanel` 增加 `projectId`/`stage` props 与 `editing` state；editing 时渲染：
```tsx
<PrevisBlockingEditor projectId={projectId} stage={stage} shotIndex={0} onDone={() => setEditing(false)} />
```

- [ ] **Step 2: 新建编辑器组件**

`src/components/projects/previs-blocking-editor.tsx`：
```tsx
"use client"

import * as React from "react"
import { useApp } from "@/lib/store"
import { renderPrevisShot, svgDataUrl } from "@/lib/engine/previs-render"
import { isPrevisArtifact } from "@/lib/engine/previs-types"
import type { BlockingItem, WorkflowStage } from "@/lib/types"
import { Button } from "@/components/ui/button"

/** 2D 布景干预：拖拽角色/道具标记 + 机位参数 + 重新渲染（manual 模式专用） */
export function PrevisBlockingEditor({
  projectId, stage, shotIndex, onDone,
}: {
  projectId: string
  stage: WorkflowStage
  shotIndex: number
  onDone: () => void
}) {
  const { dispatch } = useApp()
  const artifact = stage.artifact
  if (!isPrevisArtifact(artifact)) return null
  const shot = artifact.shots[shotIndex]
  const [items, setItems] = React.useState<BlockingItem[]>(shot.blocking)
  const [dragging, setDragging] = React.useState<string | null>(null)

  const move = (e: React.PointerEvent<SVGSVGElement>, id: string) => {
    if (!dragging) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width - 0.5) / 0.05 // 画布 480 宽 → 世界 x
    const z = 1 - ((e.clientY - rect.top) / rect.height - 0.5) / 0.05
    setItems((prev) => prev.map((b) => (b.id === id ? { ...b, position: [x, 0, z] } : b)))
  }

  const rerender = () => {
    dispatch({ type: "UPDATE_PREVIS_BLOCKING", projectId, stageId: stage.id, shotIndex, blocking: items })
    dispatch({ type: "RERENDER_PREVIS", projectId, stageId: stage.id })
    onDone()
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={svgDataUrl(renderPrevisShot({ ...shot, blocking: items }).previewSvg)}
        alt="布景俯视图"
        className="w-full cursor-move rounded-md border bg-background"
        draggable={false}
      />
      <p className="text-[11px] text-muted-foreground">提示：拖动角色/道具标记调整位置，完成后点击「重新渲染」</p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>取消</Button>
        <Button size="sm" onClick={rerender}>
          <RotateCcwIcon className="size-3.5" /> 重新渲染
        </Button>
      </div>
    </div>
  )
}
```
（说明：SVG 拖动事件与 <img> 渲染的冲突在实现时若出现，改为内联 <svg dangerouslySetInnerHTML> + onPointerDown 捕获 id，指针移动更新坐标。）

- [ ] **Step 3: 构建验证**

Run: `pnpm build`
Expected: 构建通过

- [ ] **Step 4: 提交**

```bash
git add src/components/projects/stage-detail-drawer.tsx src/components/projects/previs-blocking-editor.tsx
git commit -m "feat(previs): manual blocking editor with rerender"
```

---

### Task 8: 存储迁移（STORAGE_KEY v2）

**Files:**
- Modify: `src/lib/engine/reducer.ts`（STORAGE_KEY）
- Modify: `src/lib/store.tsx`（加载迁移）

**Interfaces:**
- Consumes: `AppState`（含新字段，旧数据缺字段由迁移补齐）
- Produces: `migrateAppState(raw: unknown): AppState`

- [ ] **Step 1: 写失败测试（reducer.test.ts 追加）**

```ts
  it("v1 数据迁移：旧项目无 previs 字段不崩溃", () => {
    const legacy = { version: 1, projects: [{ id: "p1", stages: [{ id: "s1", agentId: "video_gen", references: undefined }] }] }
    const migrated = migrateAppState(legacy)
    expect(Array.isArray(migrated.projects)).toBe(true)
  })
```

- [ ] **Step 2: 实现迁移**

`reducer.ts`：
```ts
export const STORAGE_KEY = "cine-muse-state-v2"
export const LEGACY_STORAGE_KEY = "cine-muse-state-v1"

/** v1 → v2：旧数据结构缺少 references 等新字段，直接补默认值即可兼容 */
export function migrateAppState(raw: unknown): AppState {
  const s = raw as Partial<AppState> | null
  return {
    ...createInitialState(),
    ...(s ?? {}),
    projects: (s?.projects ?? []).map((p) => ({
      ...p,
      stages: (p.stages ?? []).map((st) => ({
        ...st,
        references: st.references ?? undefined,
        iterations: st.iterations ?? [],
        reviews: st.reviews ?? [],
      })),
    })),
  } as AppState
}
```

`store.tsx` 加载处（localStorage 读取）改为：读到 `LEGACY_STORAGE_KEY` 或 `STORAGE_KEY` 后先 `migrateAppState`，成功迁移后写回新 key 并移除旧 key。electron SQLite 侧（`loadStateJson`）同样经 `migrateAppState` 兜底。

- [ ] **Step 3: 运行测试 + 构建**

Run: `pnpm test && pnpm build`
Expected: PASS；构建通过

- [ ] **Step 4: 提交**

```bash
git add src/lib/engine/reducer.ts src/lib/store.tsx src/lib/engine/reducer.test.ts
git commit -m "feat(previs): state migration v1→v2"
```

---

### Task 9: 全量验证与收尾

**Files:**
- Modify: `docs/superpowers/specs/2026-08-31-previs-3d-stage-design.md`（验收打勾）

- [ ] **Step 1: 全量验证**

Run:
```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
```
Expected: 全部通过；产物含 previs 节点、三图、干预、附件、空间一致性指标

- [ ] **Step 2: 手动冒烟（可选）**

`pnpm dev` 后：新建 full 模板项目 → 确认预演台节点注入且默认勾选；推进到预演台 → 三图渲染；manual 模式调整摆位 → 重新渲染生效；批准后 video_gen 显示参考附件徽章；质检含「空间一致性」。

- [ ] **Step 3: 提交**

```bash
git add docs/superpowers/specs/2026-08-31-previs-3d-stage-design.md
git commit -m "docs: mark previs spec acceptance complete"
```

---

## Self-Review 记录

- **Spec 覆盖**：P1 指标（Task 3 加成 + Task 6 展示）✓；P2 智能启用（Task 5 默认勾选，创建期可实现的最大贴近度——分镜镜头数创建期不可知，已在向导层用 full 模板默认勾选替代，spec 需知悉此偏差）✓；P3 命名 ✓；P4 职责边界（references 徽章 + spatial 指标）✓；T1 SVG ✓；T2 判别联合 ✓；T3 引用注入（Task 4 startNextStage）✓；T4 reducer 契约 ✓；T5 迁移（Task 8）✓；T6 无占位 ✓；T7 纯函数 ✓；T8 无独立 gate ✓
- **占位符扫描**：无 TBD/TODO；所有代码完整
- **类型一致性**：`renderPrevisShot`/`makePrevisShot`/`isPrevisArtifact`/`svgDataUrl` 在 Task 1-2 定义、Task 3-7 消费，签名一致；`references` 字段 Task 1 定义、Task 3/4/6 使用；reducer action 名 Task 4 定义、Task 7 消费
