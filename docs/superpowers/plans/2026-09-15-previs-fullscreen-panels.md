# Previs 全屏编辑器「右侧栏收口 + 构图辅助开关」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把全屏编辑器从「左中右三栏」收敛为「画布 + 可折叠右侧栏」两栏，并将 3D 画布上的构图三分线改为默认隐藏的可切换开关。

**Architecture:** 布局改动集中在 `previs-blocking-editor.tsx` 的 `fullscreen` 分支：左栏四项内容搬入右栏新建的分区折叠侧栏，右栏收起态退化为 44px 图标条。可测逻辑（分区状态机、适用性判定、宽度常量）抽到新纯模块 `src/lib/engine/previs-panel-state.ts`，在 node 环境的 vitest 下单测；JSX 布局本身无组件测试环境（项目未装 jsdom / testing-library），由 `tsc` + `build` 门禁与人工浏览器清单覆盖。

**Tech Stack:** Next.js 16（静态导出）· React 19 · TypeScript · Tailwind CSS · lucide-react · vitest（`environment: "node"`）

**Spec:** `docs/superpowers/specs/2026-09-15-previs-fullscreen-panels-design.md`

## Global Constraints

- **分支**：`feat/previs-fullscreen-panels`（基于本地 main `49d7e0b`）。不推送 main、不 force-push、不合并。
- **不碰**：`src/components/projects/previs-3d-viewport.tsx`。三分线是 DOM 覆盖层，与 three.js 场景无关；地面 `GridHelper(200, 200)` 明确保留（spec §1 非目标）。
- **不加依赖**：仅用已装的 `lucide-react@^1.34.0`（已核实 `BoxesIcon` / `PersonStandingIcon` / `PanelRightCloseIcon` / `PanelRightOpenIcon` / `SlidersHorizontalIcon` / `Grid3x3Icon` / `ChevronRightIcon` 及类型 `LucideIcon` 均存在）。
- **不动 `showLabels`**：它仍留在 `BlockingShotEditor` 本地、每分镜重置（既有行为，spec §5 已知不一致）。
- **宽度常量只此一处**：`SIDEBAR_WIDTH_PX = 300` / `SIDEBAR_RAIL_WIDTH_PX = 44` 必须通过 `style={{ width: ... }}` 参与渲染，不得写成 `w-[300px]` 之类会漂移的工具类。
- **三分线默认值 = `false`**（默认隐藏）。
- **既有文案不改**：`机位NN` 补零、`角色姿态`、`布景项`、`机位参数`、`构图辅助`（新）等标签逐字照写。
- **门禁命令**（每个任务收尾都要跑）：
  - `pnpm exec tsc --noEmit` → 0 errors
  - `pnpm test` → 全绿。基线 **119 passed / 9 files**，T1 后为 **126 passed / 10 files**。
    若出现来自 `.claude/worktrees/*` 嵌套副本的幻影失败（仓库根 vitest 配置未排除嵌套 worktree 的既有问题），改用
    `pnpm exec vitest run --exclude '**/.claude/**'`；在 `previs-ue4` worktree 内直接跑 `pnpm test` 不应触发该问题。
  - `pnpm build` → 全绿
- **提交信息**：`feat(previs-panels): ...` / `test(previs-panels): ...` / `docs(previs-panels): ...`（沿用仓库 `type(scope):` 风格）。

---

### Task 1: 侧栏分区纯模块（TDD）

把侧栏的状态机与适用性判定抽成可单测的纯函数。没有这一步，后续任务里的布局逻辑一行都测不到。

**Files:**
- Create: `src/lib/engine/previs-panel-state.ts`
- Test: `src/lib/engine/previs-panel-state.test.ts`

**Interfaces:**
- Consumes: 无（全新模块，不依赖应用类型）
- Produces:
  - `SIDEBAR_SECTIONS: readonly ["camera","items","pose","transform"]`
  - `type SidebarSection = "camera" | "items" | "pose" | "transform"`
  - `type PanelSelection = { kind: string } | null`
  - `SIDEBAR_WIDTH_PX: 300` / `SIDEBAR_RAIL_WIDTH_PX: 44`
  - `DEFAULT_OPEN_SECTIONS: ReadonlySet<SidebarSection>`（= `{camera, items}`）
  - `applicableSections(item: PanelSelection): SidebarSection[]`
  - `sectionsForSelection(item: PanelSelection): SidebarSection[]`
  - `toggleSection(open: ReadonlySet<SidebarSection>, id: SidebarSection): Set<SidebarSection>`
  - `openSection(open: ReadonlySet<SidebarSection>, id: SidebarSection): Set<SidebarSection>`

- [ ] **Step 1: 写失败测试**

Create `src/lib/engine/previs-panel-state.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  DEFAULT_OPEN_SECTIONS,
  SIDEBAR_RAIL_WIDTH_PX,
  SIDEBAR_SECTIONS,
  SIDEBAR_WIDTH_PX,
  applicableSections,
  openSection,
  sectionsForSelection,
  toggleSection,
  type SidebarSection,
} from "./previs-panel-state"

describe("previs-panel-state", () => {
  it("SIDEBAR_SECTIONS 为四分区，顺序即渲染顺序", () => {
    expect(SIDEBAR_SECTIONS).toEqual(["camera", "items", "pose", "transform"])
  })

  it("默认展开集合恰为 机位 + 布景项", () => {
    expect([...DEFAULT_OPEN_SECTIONS].sort()).toEqual(["camera", "items"])
  })

  it("宽度常量为正且图标条窄于侧栏", () => {
    expect(SIDEBAR_WIDTH_PX).toBeGreaterThan(0)
    expect(SIDEBAR_RAIL_WIDTH_PX).toBeGreaterThan(0)
    expect(SIDEBAR_RAIL_WIDTH_PX).toBeLessThan(SIDEBAR_WIDTH_PX)
  })

  it("applicableSections：机位/布景项恒在，角色姿态仅角色，变换仅任意选中项", () => {
    expect(applicableSections(null)).toEqual(["camera", "items"])
    expect(applicableSections({ kind: "terrain" })).toEqual(["camera", "items", "transform"])
    expect(applicableSections({ kind: "prop" })).toEqual(["camera", "items", "transform"])
    expect(applicableSections({ kind: "character" })).toEqual(["camera", "items", "pose", "transform"])
  })

  it("sectionsForSelection：角色自动展开 姿态+变换，道具仅 变换，空选择为空", () => {
    expect(sectionsForSelection({ kind: "character" })).toEqual(["pose", "transform"])
    expect(sectionsForSelection({ kind: "prop" })).toEqual(["transform"])
    expect(sectionsForSelection(null)).toEqual([])
  })

  it("toggleSection 往返回到原集合，且不改动入参", () => {
    const open: ReadonlySet<SidebarSection> = new Set(["camera"])
    const once = toggleSection(open, "pose")
    expect([...once].sort()).toEqual(["camera", "pose"])
    const twice = toggleSection(once, "pose")
    expect([...twice].sort()).toEqual(["camera"])
    expect([...open]).toEqual(["camera"]) // 入参未被污染
    expect(once).not.toBe(open) // 返回新 Set
  })

  it("openSection 幂等且不改动入参", () => {
    const open: ReadonlySet<SidebarSection> = new Set(["camera"])
    const a = openSection(open, "items")
    const b = openSection(a, "items")
    expect([...a].sort()).toEqual(["camera", "items"])
    expect([...b].sort()).toEqual(["camera", "items"])
    expect([...open]).toEqual(["camera"])
    expect(b).not.toBe(a)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/engine/previs-panel-state.test.ts`
Expected: FAIL — `Failed to resolve import "./previs-panel-state"`（模块尚不存在）

- [ ] **Step 3: 写最小实现**

Create `src/lib/engine/previs-panel-state.ts`:

```ts
/**
 * 全屏编辑器右侧栏的分区状态（纯逻辑）。
 * 侧栏 UI 无组件测试环境（vitest 为 node 环境、未装 jsdom/testing-library），
 * 故把状态机与适用性判定收在此处单测；JSX 只做渲染。
 */

/** 分区 id，顺序即侧栏渲染顺序（spec §3.1） */
export const SIDEBAR_SECTIONS = ["camera", "items", "pose", "transform"] as const
export type SidebarSection = (typeof SIDEBAR_SECTIONS)[number]

/** 展开态侧栏宽度（px）——参与渲染，勿另写工具类以免漂移 */
export const SIDEBAR_WIDTH_PX = 300
/** 收起态图标条宽度（px） */
export const SIDEBAR_RAIL_WIDTH_PX = 44

/** 默认展开的分区：两块恒在的常用面板 */
export const DEFAULT_OPEN_SECTIONS: ReadonlySet<SidebarSection> = new Set(["camera", "items"])

/** 结构类型而非 BlockingItem：纯模块不耦合应用类型；kind 实际含 character/prop/terrain */
export type PanelSelection = { kind: string } | null

/** 当前选择下适用的分区：机位/布景项恒在；角色姿态仅角色；变换仅任意选中项 */
export function applicableSections(item: PanelSelection): SidebarSection[] {
  return SIDEBAR_SECTIONS.filter((id) => {
    if (id === "camera" || id === "items") return true
    if (id === "pose") return item?.kind === "character"
    return item != null
  })
}

/** 选择变化时应自动展开的分区 = 适用分区中非默认展开的那些 */
export function sectionsForSelection(item: PanelSelection): SidebarSection[] {
  return applicableSections(item).filter((id) => !DEFAULT_OPEN_SECTIONS.has(id))
}

/** 切换分区开合；返回新 Set，不改动入参 */
export function toggleSection(
  open: ReadonlySet<SidebarSection>,
  id: SidebarSection,
): Set<SidebarSection> {
  const next = new Set(open)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** 确保分区展开；已展开时返回等值的新 Set（调用方可无条件 setState） */
export function openSection(
  open: ReadonlySet<SidebarSection>,
  id: SidebarSection,
): Set<SidebarSection> {
  const next = new Set(open)
  next.add(id)
  return next
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/engine/previs-panel-state.test.ts`
Expected: PASS — 7 passed

- [ ] **Step 5: 全量门禁**

Run: `pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: tsc 0 errors；vitest **126 passed**（119 既有 + 7 新增）；build 全绿

- [ ] **Step 6: 提交**

```bash
git add src/lib/engine/previs-panel-state.ts src/lib/engine/previs-panel-state.test.ts
git commit -m "feat(previs-panels): pure sidebar section state machine with applicability rules"
```

---

### Task 2: 构图辅助开关

`FrameOverlay` 的三分线（2 竖 + 2 横）改为受 `showGuides` 控制，默认 `false`；开关放在画布上方工具条（不是画布 pill——pill 只在导演视角渲染，spec §4）。

**Files:**
- Modify: `src/components/projects/previs-blocking-editor.tsx`
  - `FrameOverlay`（约 `:120-140`）
  - `BlockingShotEditor` 入参与解构（`:315-332`）
  - `centerTabsEl` 的 fullscreen 分组（`:808-844`）
  - `FrameOverlay` 调用点（`:1285`）
  - `PrevisBlockingEditor`（`:1356` 起）新增状态并下传
- 顶部 import 行（lucide 图标）

**Interfaces:**
- Consumes: 无（Task 1 与本任务无关）
- Produces:
  - `FrameOverlay({ aspect, showGuides }: { aspect: MapAspect; showGuides: boolean })`
  - `BlockingShotEditor` 新增必填 props：`showGuides: boolean`、`onShowGuidesChange: (v: boolean) => void`
  - `PrevisBlockingEditor` 内部状态 `showGuides`（默认 `false`），跨分镜存活

- [ ] **Step 1: 改 `FrameOverlay` 签名并条件渲染三分线**

`src/components/projects/previs-blocking-editor.tsx:120-140`。旧：

```tsx
/** 构图辅助：画幅比例框（外围遮罩）+ 三分线/九宫格（纯 DOM） */
function FrameOverlay({ aspect }: { aspect: MapAspect }) {
  const ratio = aspect === "16:9" ? "16 / 9" : aspect === "9:16" ? "9 / 16" : "1 / 1"
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div
        className="absolute inset-0 m-auto"
        style={{
          aspectRatio: ratio,
          maxWidth: "100%",
          maxHeight: "100%",
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.22)",
        }}
      >
        <div className="absolute top-0 bottom-0 left-1/3 w-px bg-white/30" />
        <div className="absolute top-0 bottom-0 left-2/3 w-px bg-white/30" />
        <div className="absolute right-0 left-0 top-1/3 h-px bg-white/30" />
        <div className="absolute right-0 left-0 top-2/3 h-px bg-white/30" />
      </div>
    </div>
  )
}
```

新：

```tsx
/** 构图辅助：画幅比例框（外围遮罩）+ 三分线/九宫格（纯 DOM）。
 *  showGuides=false 时只保留遮罩——画幅边界信息不可丢（spec §4）。 */
function FrameOverlay({ aspect, showGuides }: { aspect: MapAspect; showGuides: boolean }) {
  const ratio = aspect === "16:9" ? "16 / 9" : aspect === "9:16" ? "9 / 16" : "1 / 1"
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div
        className="absolute inset-0 m-auto"
        style={{
          aspectRatio: ratio,
          maxWidth: "100%",
          maxHeight: "100%",
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.22)",
        }}
      >
        {showGuides && (
          <>
            <div className="absolute top-0 bottom-0 left-1/3 w-px bg-white/30" />
            <div className="absolute top-0 bottom-0 left-2/3 w-px bg-white/30" />
            <div className="absolute right-0 left-0 top-1/3 h-px bg-white/30" />
            <div className="absolute right-0 left-0 top-2/3 h-px bg-white/30" />
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `BlockingShotEditor` 接收入参**

解构（`:315-317`）。旧：

```tsx
  projectId, stage, shotIndex, shot, shots, shotsCount, onShotIndexChange, onDone, variant = "inline",
  rigSelected = false, onRigSelect,
}: {
```

新：

```tsx
  projectId, stage, shotIndex, shot, shots, shotsCount, onShotIndexChange, onDone, variant = "inline",
  rigSelected = false, onRigSelect, showGuides, onShowGuidesChange,
}: {
```

类型块内、`onRigSelect` 之后追加：

```tsx
  /** rig 选中变更：number = 选中该索引机位；null = 清除（图元/空点/切镜头） */
  onRigSelect?: (index: number | null) => void
  /** 构图辅助（画幅三分线）显示开关——父级持有：编辑器按 shot 重建（key=index），视图偏好须跨重建存活 */
  showGuides: boolean
  onShowGuidesChange: (v: boolean) => void
}) {
```

- [ ] **Step 3: 工具条加开关**

`centerTabsEl` 的 fullscreen 分组（`:808-844`）。**整块替换**（新增外层 flex 包裹，故多一层缩进与一个闭合 `</div>`；两个分段按钮除了缩进 +2 空格，内容逐字不变）：

旧：

```tsx
      {variant === "fullscreen" && (
        <>
          <span className="mx-1 h-4 w-px bg-border" />
          <div className="ml-auto flex items-center rounded-md border border-border bg-muted/40 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => {
                setOpenMenu(null)
                setViewMode("director")
              }}
              className={cn(
                "rounded px-2 py-0.5 transition-colors",
                viewMode === "director"
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              导演视角
            </button>
            <button
              type="button"
              onClick={() => {
                setOpenMenu(null)
                setViewMode("camera")
              }}
              className={cn(
                "rounded px-2 py-0.5 transition-colors",
                viewMode === "camera"
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              机位视角
            </button>
          </div>
        </>
      )}
```

新：

```tsx
      {variant === "fullscreen" && (
        <>
          <span className="mx-1 h-4 w-px bg-border" />
          <div className="ml-auto flex items-center gap-1.5">
            {/* 构图辅助放此处而非画布 pill：pill 仅在导演视角渲染，而三分线在机位视角才是主要用途（spec §4） */}
            <button
              type="button"
              aria-pressed={showGuides}
              title="构图辅助：画幅九宫格三分线"
              onClick={() => onShowGuidesChange(!showGuides)}
              className={cn(
                "flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                showGuides
                  ? "border-primary/60 bg-primary/10 font-medium"
                  : "border-border/60 text-muted-foreground hover:border-primary/30",
              )}
            >
              <Grid3x3Icon className="size-3.5" /> 构图辅助
            </button>
            <div className="flex items-center rounded-md border border-border bg-muted/40 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => {
                  setOpenMenu(null)
                  setViewMode("director")
                }}
                className={cn(
                  "rounded px-2 py-0.5 transition-colors",
                  viewMode === "director"
                    ? "bg-background font-medium shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                导演视角
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpenMenu(null)
                  setViewMode("camera")
                }}
                className={cn(
                  "rounded px-2 py-0.5 transition-colors",
                  viewMode === "camera"
                    ? "bg-background font-medium shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                机位视角
              </button>
            </div>
          </div>
        </>
      )}
```

- [ ] **Step 4: 调用点传参**

`:1285`。旧：`<FrameOverlay aspect={aspect} />`
新：`<FrameOverlay aspect={aspect} showGuides={showGuides} />`

- [ ] **Step 5: `PrevisBlockingEditor` 持状态并下传**

在 `rigSelection` 状态之后（`:1379` 附近）追加：

```tsx
  /** 构图辅助（三分线）显示开关——跨分镜存活：编辑器按 shot 重建，视图偏好不该被重置（spec §5） */
  const [showGuides, setShowGuides] = React.useState(false)
```

在 `<BlockingShotEditor ... onRigSelect={selectRig} />` 上追加两个 props：

```tsx
      rigSelected={rigSelectedIndex === index}
      onRigSelect={selectRig}
      showGuides={showGuides}
      onShowGuidesChange={setShowGuides}
```

- [ ] **Step 6: 加图标 import**

在既有 lucide import 中按字母序插入 `Grid3x3Icon`（该文件当前已从 `lucide-react` 导入 `CameraIcon` 等，保持同一 import 语句）。

- [ ] **Step 7: 门禁**

Run: `pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: tsc 0 errors（若报 `Property 'showGuides' is missing` 说明 Step 2/5 未对齐）；vitest 126 passed；build 全绿

- [ ] **Step 8: 提交**

```bash
git add src/components/projects/previs-blocking-editor.tsx
git commit -m "feat(previs-panels): composition-guides toggle controlling the rule-of-thirds overlay"
```

---

### Task 3: 两栏布局 + 可折叠侧栏 + 图标条

左栏四项内容搬入右栏新建的折叠分区；右栏收起态退化为 44px 图标条。中间列（页签 / 画布 / 环绕条）**逐字不动**——它在新旧结构里同为两层嵌套，缩进不变，diff 只有容器行与右栏。

**Files:**
- Modify: `src/components/projects/previs-blocking-editor.tsx`
  - 新增 `RailButton`、`SidebarSection` 组件与 `SIDEBAR_RAIL_ITEMS` 常量（放在 `BlockingShotEditor` 之前）
  - `cameraEl` 网格（`:1021`）改按语义分行
  - `BlockingShotEditor` 新增 `sidebarCollapsed` / `onSidebarCollapsedChange` props 与 `openSections` 状态
  - fullscreen 分支容器与左右两栏（`:1139-1145` 与 `:1325-1331`）
  - `PrevisBlockingEditor` 新增 `sidebarCollapsed` 状态并下传
- Modify: `src/components/projects/previs-fullscreen-editor.tsx`（仅文档注释）

**Interfaces:**
- Consumes: Task 1 的 `SIDEBAR_SECTIONS` / `SidebarSection` / `SIDEBAR_WIDTH_PX` / `SIDEBAR_RAIL_WIDTH_PX` / `DEFAULT_OPEN_SECTIONS` / `applicableSections` / `toggleSection` / `openSection`
- Produces:
  - `RailButton({ label, disabled?, onClick, children })`
  - `SidebarSection({ label, badge?, open, onToggle, sectionRef?, children })`
  - `BlockingShotEditor` 新增必填 props：`sidebarCollapsed: boolean`、`onSidebarCollapsedChange: (v: boolean) => void`
  - `BlockingShotEditor` 内部：`openSections: ReadonlySet<SidebarSection>`、`sectionRefs`、`applicable: Set<SidebarSection>`、`toggleSec(id)`、`openAt(id)`
  - `PrevisBlockingEditor` 内部状态 `sidebarCollapsed`（默认 `false`），跨分镜存活

- [ ] **Step 1: 加侧栏子组件与图标表**

在 `BlockingShotEditor` 函数声明之前（紧接 `FrameOverlay` 之后）插入：

```tsx
/** 图标条分区图标（顺序与 SIDEBAR_SECTIONS 一致；label 同时用作 title/aria-label） */
const SIDEBAR_RAIL_ITEMS: { id: SidebarSection; label: string; Icon: LucideIcon }[] = [
  { id: "camera", label: "机位", Icon: CameraIcon },
  { id: "items", label: "布景项", Icon: BoxesIcon },
  { id: "pose", label: "角色姿态", Icon: PersonStandingIcon },
  { id: "transform", label: "变换", Icon: Move3dIcon },
]

/** 图标条按钮（侧栏收起态）：禁用时半透明且不可点 */
function RailButton({
  label, disabled, onClick, children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
    >
      {children}
    </button>
  )
}

/** 侧栏分区（受控手风琴）：允许多个同时展开；折叠 = 内容卸载（各面板状态都在 store/父级） */
function SidebarSection({
  label, badge, open, onToggle, sectionRef, children,
}: {
  label: string
  badge?: React.ReactNode
  open: boolean
  onToggle: () => void
  sectionRef?: (el: HTMLDivElement | null) => void
  children: React.ReactNode
}) {
  return (
    <div ref={sectionRef} className="border-b border-border/50 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-foreground/5"
      >
        <ChevronRightIcon className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
        {label}
        {badge != null && (
          <span className="ml-auto truncate rounded-full bg-primary/10 px-1.5 text-[10px] tabular-nums text-primary">
            {badge}
          </span>
        )}
      </button>
      {open && <div className="px-2 pb-2">{children}</div>}
    </div>
  )
}
```

- [ ] **Step 2: 加 import**

从 `lucide-react` 追加 `BoxesIcon`、`ChevronRightIcon`、`PanelRightCloseIcon`、`PanelRightOpenIcon`、`PersonStandingIcon`、`SlidersHorizontalIcon`，并追加类型导入：

```tsx
import type { LucideIcon } from "lucide-react"
```

从纯模块导入：

```tsx
import {
  DEFAULT_OPEN_SECTIONS,
  SIDEBAR_RAIL_WIDTH_PX,
  SIDEBAR_WIDTH_PX,
  applicableSections,
  openSection,
  toggleSection,
  type SidebarSection,
} from "@/lib/engine/previs-panel-state"
```

- [ ] **Step 3: `BlockingShotEditor` 接入侧栏 props 与状态**

解构追加 `sidebarCollapsed, onSidebarCollapsedChange`：

```tsx
  rigSelected = false, onRigSelect, showGuides, onShowGuidesChange,
  sidebarCollapsed, onSidebarCollapsedChange,
}: {
```

类型块 `onShowGuidesChange` 之后追加：

```tsx
  /** 侧栏收起态——父级持有：编辑器按 shot 重建，布局偏好不该被重置（spec §5） */
  sidebarCollapsed: boolean
  onSidebarCollapsedChange: (v: boolean) => void
}) {
```

在 `stageBoxRef`（`:355`）之后追加：

```tsx
  /** 侧栏展开的分区集合：本地即可——组件按 shot 重建时选择同时重置，自动展开会重新打开（spec §5） */
  const [openSections, setOpenSections] = React.useState<ReadonlySet<SidebarSection>>(DEFAULT_OPEN_SECTIONS)
  const sectionRefs = React.useRef<Partial<Record<SidebarSection, HTMLDivElement | null>>>({})
```

- [ ] **Step 4: 在 `selectedItem` 之后派生侧栏数据**

`selectedItem`（`:895`）之后追加：

```tsx
  /** 当前选择下适用的分区：驱动图标条置灰与条件分区渲染（spec §2.3/§3.1） */
  const applicable = new Set(applicableSections(selectedItem ? { kind: selectedItem.kind } : null))
  const toggleSec = (id: SidebarSection) => setOpenSections((prev) => toggleSection(prev, id))
  const openAt = (id: SidebarSection) => {
    onSidebarCollapsedChange(false)
    setOpenSections((prev) => openSection(prev, id))
  }
```

- [ ] **Step 5: `cameraEl` 网格按语义分行**

`:1011-1041`。旧：

```tsx
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-7">
        {(["position", "target"] as const).map((axis) =>
          (["x", "y", "z"] as const).map((letter, idx) => (
            <label key={`${axis}-${letter}`} className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              {axis === "position" ? "机位" : "目标"} {letter.toUpperCase()}
              <NumField
                value={camera[axis][idx as 0 | 1 | 2]}
                step={0.5}
                onCommit={(v) => setCameraAxis(axis, idx as 0 | 1 | 2, v)}
                ariaLabel={`${axis === "position" ? "机位" : "目标"} ${letter.toUpperCase()}`}
              />
            </label>
          )),
        )}
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          FOV（度）
          <NumField value={camera.fov} step={5} onCommit={setCameraFov} ariaLabel="视野角度 FOV" />
        </label>
      </div>
```

新（`sm:grid-cols-7` 看的是视口宽度而非容器宽度，宽屏下 7 格硬塞进 300px 栏会挤爆——改为按语义分行，字段数与 aria-label 逐字不变）：

```tsx
      <div className="flex flex-col gap-1.5">
        {(["position", "target"] as const).map((axis) => (
          <div key={axis} className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="w-8 shrink-0">{axis === "position" ? "机位" : "目标"}</span>
            {(["x", "y", "z"] as const).map((letter, idx) => (
              <NumField
                key={letter}
                value={camera[axis][idx as 0 | 1 | 2]}
                step={0.5}
                onCommit={(v) => setCameraAxis(axis, idx as 0 | 1 | 2, v)}
                ariaLabel={`${axis === "position" ? "机位" : "目标"} ${letter.toUpperCase()}`}
              />
            ))}
          </div>
        ))}
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="w-8 shrink-0">FOV</span>
          <NumField value={camera.fov} step={5} onCommit={setCameraFov} ariaLabel="视野角度 FOV" />
        </label>
      </div>
```

- [ ] **Step 6: 去除面板内与分区标题重复的标题行**

分区标题已承载面板标题，四处面板内标题随之变重复。保留操作性提示文案，只去掉重复的标题词。

**(a) `itemsEl`（`:850-852`）** — 旧：

```tsx
      {variant === "fullscreen" && (
        <p className="text-[11px] font-medium text-muted-foreground">布景项（点击选中，方向键微调）</p>
      )}
```

新：

```tsx
      {variant === "fullscreen" && (
        <p className="text-[10px] text-muted-foreground">点击选中，方向键微调</p>
      )}
```

**(b) `cameraEl`（`:1018-1020`）** — 旧：

```tsx
      <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <CameraIcon className="size-3" /> 机位参数 · {rigLabel(shotIndex)}（视锥随目标实时变化）
      </p>
```

新：

```tsx
      <p className="mb-1.5 text-[10px] text-muted-foreground">视锥随目标实时变化</p>
```

（`CameraIcon` 仍被 pill 的「设当前视角为机位」使用，import 保留。）

**(c) `poseEl`（`:914-917`）** — 旧：

```tsx
      <div className="rounded-md border border-border/60 p-2">
        <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <ClipboardIcon className="size-3" /> 角色姿态 · {selectedItem.name}
        </p>
        <div className="flex gap-2">
```

新：

```tsx
      <div className="flex flex-col">
        <div className="flex gap-2">
```

（`ClipboardIcon` 仍被「粘贴」按钮使用，import 保留。）

**(d) `TransformGroup`（`:269-274`）** — 旧：

```tsx
      <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        变换 · {item.name}
```

新：

```tsx
      <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        {item.name}
```

（该行其余部分——`item.kind` 徽标与 `</p>`——不动。）

- [ ] **Step 7: 换容器 + 删左栏**

`:1139-1146`。旧：

```tsx
        <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)_280px] gap-4">
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
            {undoRedoEl}
            {shotSelectorEl}
            {copyPasteEl}
            {itemsEl}
          </div>
          <div className="flex min-h-0 flex-col gap-3">
```

新：

```tsx
        <div className="flex h-full min-h-0 gap-3">
          <div className="flex min-h-0 flex-1 flex-col gap-3">
```

- [ ] **Step 8: 右栏换成侧栏 / 图标条**

`:1324-1331`。旧：

```tsx
          </div>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pl-1">
            {transformEl}
            {poseEl}
            {cameraEl}
            {actionsEl}
          </div>
        </div>
```

新：

```tsx
          </div>
          {sidebarCollapsed ? (
            /* 收起态：44px 图标条——分区图标常驻（不适用时置灰而非隐藏，避免位置跳动），撤销/重做常驻底部 */
            <aside
              style={{ width: SIDEBAR_RAIL_WIDTH_PX }}
              className="flex shrink-0 flex-col items-center gap-0.5 rounded-md border bg-muted/20 py-2"
            >
              <RailButton label="展开侧栏" onClick={() => onSidebarCollapsedChange(false)}>
                <PanelRightOpenIcon className="size-4" />
              </RailButton>
              <span className="my-0.5 h-px w-5 bg-border" />
              {SIDEBAR_RAIL_ITEMS.map((item) => (
                <RailButton
                  key={item.id}
                  label={item.label}
                  disabled={!applicable.has(item.id)}
                  onClick={() => openAt(item.id)}
                >
                  <item.Icon className="size-4" />
                </RailButton>
              ))}
              <div className="mt-auto flex flex-col items-center gap-0.5">
                <RailButton
                  label="撤销"
                  disabled={state.previsUndo.past.length === 0}
                  onClick={undo}
                >
                  <Undo2Icon className="size-4" />
                </RailButton>
                <RailButton
                  label="重做"
                  disabled={state.previsUndo.future.length === 0}
                  onClick={redo}
                >
                  <Redo2Icon className="size-4" />
                </RailButton>
              </div>
            </aside>
          ) : (
            /* 展开态：头部 + 分区滚动区 + 固定底栏（底栏不随内容滚动） */
            <aside
              style={{ width: SIDEBAR_WIDTH_PX }}
              className="flex shrink-0 flex-col rounded-md border bg-muted/20"
            >
              <header className="flex h-8 shrink-0 items-center gap-1.5 border-b px-2">
                <SlidersHorizontalIcon className="size-3.5 text-muted-foreground" />
                <span className="text-[11px] font-medium text-muted-foreground">预演控制</span>
                <button
                  type="button"
                  title="收起侧栏"
                  aria-label="收起侧栏"
                  onClick={() => onSidebarCollapsedChange(true)}
                  className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                >
                  <PanelRightCloseIcon className="size-4" />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <SidebarSection
                  label="机位"
                  badge={rigLabel(shotIndex)}
                  open={openSections.has("camera")}
                  onToggle={() => toggleSec("camera")}
                  sectionRef={(el) => {
                    sectionRefs.current.camera = el
                  }}
                >
                  <div className="flex flex-col gap-2">
                    {shotSelectorEl}
                    {cameraEl}
                  </div>
                </SidebarSection>
                <SidebarSection
                  label="布景项"
                  badge={draggable.length}
                  open={openSections.has("items")}
                  onToggle={() => toggleSec("items")}
                  sectionRef={(el) => {
                    sectionRefs.current.items = el
                  }}
                >
                  {itemsEl}
                </SidebarSection>
                {applicable.has("pose") && (
                  <SidebarSection
                    label="角色姿态"
                    badge={selectedItem?.name}
                    open={openSections.has("pose")}
                    onToggle={() => toggleSec("pose")}
                    sectionRef={(el) => {
                      sectionRefs.current.pose = el
                    }}
                  >
                    {poseEl}
                  </SidebarSection>
                )}
                {applicable.has("transform") && (
                  <SidebarSection
                    label="变换"
                    open={openSections.has("transform")}
                    onToggle={() => toggleSec("transform")}
                    sectionRef={(el) => {
                      sectionRefs.current.transform = el
                    }}
                  >
                    {transformEl}
                  </SidebarSection>
                )}
              </div>
              <footer className="flex shrink-0 flex-col gap-2 border-t p-2">
                <div className="flex flex-wrap gap-1.5">
                  {undoRedoEl}
                  {copyPasteEl}
                </div>
                {actionsEl}
              </footer>
            </aside>
          )}
        </div>
```

（面板内重复标题已在 Step 6 去除；此处只做搬运，不再改文案。）

- [ ] **Step 9: `PrevisBlockingEditor` 持状态并下传**

在 `showGuides` 状态之后追加：

```tsx
  /** 侧栏收起态——跨分镜存活：用户主动的布局选择，切分镜不该弹回（spec §5） */
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false)
```

在 `<BlockingShotEditor ... onShowGuidesChange={setShowGuides} />` 上追加：

```tsx
      showGuides={showGuides}
      onShowGuidesChange={setShowGuides}
      sidebarCollapsed={sidebarCollapsed}
      onSidebarCollapsedChange={setSidebarCollapsed}
```

- [ ] **Step 10: 更新全屏壳文档注释**

`src/components/projects/previs-fullscreen-editor.tsx:11-15`。旧：

```tsx
/**
 * 空间预演台全屏编辑器：整窗 Dialog（参考 storyai-3d-director-desk 全视口形态），
 * 内部为三栏布局（左镜头/布景项 · 中画布+三图切换 · 右机位/操作）。
 * Esc 或「退出编辑」关闭；每次打开镜头重置到 0。
 */
```

新：

```tsx
/**
 * 空间预演台全屏编辑器：整窗 Dialog（参考 storyai-3d-director-desk 全视口形态），
 * 内部为两栏布局（中画布+三图切换 · 右「预演控制」侧栏：机位/布景项/角色姿态/变换，可收起为图标条）。
 * Esc 或「退出编辑」关闭；每次打开镜头重置到 0。
 */
```

- [ ] **Step 11: 门禁**

Run: `pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: tsc 0 errors（若报 `'SidebarSection' is declared but never used` 说明 Step 4 未生效）；vitest 126 passed；build 全绿

- [ ] **Step 12: 提交**

```bash
git add src/components/projects/previs-blocking-editor.tsx src/components/projects/previs-fullscreen-editor.tsx
git commit -m "feat(previs-panels): two-column layout with collapsible control sidebar and icon rail"
```

---

> **执行修订（`bedd91e`，实现期发现）**：本任务有两处步骤文本在实现后需要修正，代码已按修正版落地，重跑本计划时须按修正版执行：
>
> 1. **Step 6(b) 的标题删除必须按 `variant` 分支。** `cameraEl` 同时被 fullscreen 与 inline 两个分支渲染；inline（`stage-detail-drawer.tsx:113` 不传 `variant`，默认为 `"inline"`）没有侧栏分区标题来接管，无条件删除会让内联编辑器丢失面板标题与 `机位NN` 标签。删标题的理由（与新分区标题逐字重复）只成立于 fullscreen。
> 2. **Step 5 重排网格时不得丢掉可见的 X/Y/Z 轴字母。** 原 7 列网格每个输入框带可见轴字母（`机位 X` 等）；改为按语义分行后若只保留行标签，六个输入框在视觉上无法区分（`NumField` 只渲染裸 `<input>`，标签仅在 `aria-label` 里）。spec §6 的示意图即为 `机位 [X] [Y] [Z]`。

### Task 4: 侧栏交互收口——自动展开与滚入视野

Task 3 交付了可手动开合的侧栏；本任务补上「选择变化 → 相关分区自动展开」与「点图标条 → 展开并滚入视野」。这两项可被单独驳回而不影响 Task 3。

**Files:**
- Modify: `src/components/projects/previs-blocking-editor.tsx`（`BlockingShotEditor` 内，`selectedItem` 派生之后）

**Interfaces:**
- Consumes: Task 1 的 `sectionsForSelection` / `openSection`；Task 3 的 `openSections` / `setOpenSections` / `sectionRefs` / `openAt`
- Produces: 无新导出（纯内部行为）

- [ ] **Step 1: 选择变化自动展开**

在 Task 3 Step 4 的 `openAt` 之后追加：

```tsx
  /** 选择变化 → 自动展开相关分区。
   *  依赖只有 selKey：用户手动收起某分区后，只要选择不变就不会被"打架"重开（spec §3.3）。 */
  const selKey = selectedItem ? `${selectedItem.id}:${selectedItem.kind}` : null
  React.useEffect(() => {
    for (const id of sectionsForSelection(selectedItem)) {
      setOpenSections((prev) => openSection(prev, id))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey])
```

- [ ] **Step 2: 图标条点击滚入视野**

在 `openSections` 状态旁（Task 3 Step 3）追加：

```tsx
  /** 图标条点击后待滚入视野的分区（一次性）；用 state 触发，避免在 rAF 里赌渲染时序 */
  const [scrollTarget, setScrollTarget] = React.useState<SidebarSection | null>(null)
```

在 `selKey` effect 之后追加：

```tsx
  React.useEffect(() => {
    if (!scrollTarget) return
    // 先清空再滚动：重置为 null 也会触发一次本 effect，靠上面的 early-return 短路
    setScrollTarget(null)
    sectionRefs.current[scrollTarget]?.scrollIntoView({ block: "nearest" })
  }, [scrollTarget])
```

在 `openAt` 中补一行：

```tsx
  const openAt = (id: SidebarSection) => {
    onSidebarCollapsedChange(false)
    setOpenSections((prev) => openSection(prev, id))
    setScrollTarget(id)
  }
```

- [ ] **Step 3: 补 import**

Task 3 Step 2 的纯模块 import 中追加 `sectionsForSelection`。

- [ ] **Step 4: 门禁**

Run: `pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: tsc 0 errors；vitest 126 passed；build 全绿

- [ ] **Step 5: 提交**

```bash
git add src/components/projects/previs-blocking-editor.tsx
git commit -m "feat(previs-panels): auto-expand sections on selection and scroll rail targets into view"
```

---

### Task 5: 回归收尾——全量门禁 + 验收状态回填

**Files:**
- Modify: `docs/superpowers/specs/2026-09-15-previs-fullscreen-panels-design.md`（追加「§11 验收状态」）

**Interfaces:**
- Consumes: Task 1-4 的全部产出
- Produces: 无

- [ ] **Step 1: 全量门禁**

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

Expected: tsc 0 errors；vitest **126 passed / 10 files**；build 全绿。逐条记录实际数字（构建产物条数按实际输出写）。

- [ ] **Step 2: 构建产物核验（三分线是 DOM，不涉及静态资源；此处只核验构建未被破坏）**

Run: `ls out/models 2>/dev/null | head`
Expected: 至少列出 `ue-mannequin-retopology.glb`（本次不改资产，仅确认构建输出仍完整）

- [ ] **Step 3: 回填 spec 验收状态**

在 spec 末尾追加：

```markdown
## 11. 验收状态

**自动门禁**（head `<填实测 HEAD 短 SHA>`）：

- `pnpm exec tsc --noEmit`：0 errors
- `pnpm test`：126 passed / 10 files（基线 119 / 9 files + 新增 `previs-panel-state.test.ts` 7 例）
- `pnpm build`：全绿

**人工浏览器验收**（spec §9 十项）：PENDING —— 需 `pnpm exec next dev -p 3001` 后人工逐项确认（无组件测试环境，布局/折叠/滚入视野均为 DOM 行为）。
```

- [ ] **Step 4: 提交**

```bash
git add docs/superpowers/specs/2026-09-15-previs-fullscreen-panels-design.md
git commit -m "docs(previs-panels): acceptance status for automated gates"
```

---

## 附录：人工浏览器验收清单（Task 5 后由用户执行）

`pnpm exec next dev -p 3001` → 打开任一项目 → 空间预演台全屏编辑。逐项：

1. 三分线默认不显示；点「构图辅助」出现 2 竖 + 2 横；再点消失
2. 画幅 letterbox 遮罩在三分线关闭时仍在
3. 导演视角 / 机位视角下「构图辅助」开关均可见可点
4. 侧栏收起 → 画布占满宽度；图标条自上而下为 展开把手 · 4 个分区图标 · 撤销 · 重做
5. 图标条点「变换」（未选中布景项时置灰；选中后点亮）→ 侧栏展开、该分区展开且滚入视野
6. 切换机位分镜后，侧栏保持收起状态、三分线设置保持
7. 选中角色 → 「角色姿态」+「变换」自动展开；手动收起「变换」后切换选中项才重开
8. 机位参数三个输入行在 300px 栏宽下不溢出、不重叠
9. 布景项列表 X/Z 输入框在侧栏内不溢出
10. 底栏撤销/重做/复制/粘贴/取消/重新渲染均可点，且不随滚动区滚动
