# Previs 全屏编辑器「右侧栏收口 + 构图辅助开关」设计

日期：2026-09-15（v0.1）
状态：已实现（验收状态见 §11）
承前：`2026-09-03-previs-ue4-parity-design.md`（UE4 素体 1:1 复刻）已合入 main（`49d7e0b`）

## 0. 修订记录

v0.1（本版）：用户实测全屏编辑器后提出两项调整——(1) 3D 画布上的三分线去留；(2) 左中右三栏改为「画布 + 可折叠右侧栏」。三轮产品问答定稿：三分线**加开关且默认隐藏**；侧栏收起态为**窄图标条**；侧栏内容组织为**分区折叠（手风琴）单列滚动**。设计评审中另定：构图辅助开关从画布 pill 工具条上提到画布上方工具条（pill 仅在导演视角渲染，而三分线在机位视角才是主要用途）；机位参数网格改按语义分行以适配 300px 栏宽。

## 1. 背景与目标

全屏编辑器（`previs-fullscreen-editor.tsx` → `PrevisBlockingEditor variant="fullscreen"`）当前是 `grid-cols-[220px_minmax(0,1fr)_280px]` 三栏（`previs-blocking-editor.tsx:1139`）：

- **左 220px**：撤销/重做 · 机位NN 列表 · 复制/粘贴 · 布景项
- **中**：视图页签 + 3D 画布（叠 `FrameOverlay` + pill 工具条）+ 环绕条
- **右 280px**：变换 · 角色姿态 · 机位参数 · 取消/重新渲染

用户反馈两点：

1. `FrameOverlay`（`:121-140`）在 3D 画布上画 2 竖 + 2 横的三分线，干扰观察，希望「去掉或者加个开关」
2. 三栏布局浪费横向空间，希望把**机位调整（机位NN 列表）、机位参数设置、布景项**收进右侧栏，且右侧栏支持展开/折叠

**目标**：三栏收敛为「画布 + 可折叠右侧栏」两栏；三分线变为默认隐藏的可切换构图辅助。画布在侧栏收起时占满全宽。

**非目标**（明确排除）：three.js 地面网格 `GridHelper(200, 200)`（`:386`）保持原样——用户选择的是只控制 DOM 三分线，不含地面网格；`previs-3d-viewport.tsx` 本次不改动。

## 2. 布局

### 2.1 两栏结构

`previs-blocking-editor.tsx:1139` 的 grid 改为 flex 两栏：

```
<div className="flex h-full min-h-0 gap-3">
  <div className="flex min-h-0 flex-1 flex-col gap-3">   ← 中：页签 / 画布 / 环绕条
  <aside>                                                 ← 右：300px 侧栏 | 44px 图标条
</div>
```

左栏整块消失，其中四项分别归入侧栏（见 §3.1）。

### 2.2 展开态（300px）

```
┌─ 预演控制 ───────────── ▸ ─┐   ← 头部：标题 + 收起按钮
│ ▼ 机位            机位01  │   ← 分区 1
│   机位01 02 03            │
│   机位  [X] [Y] [Z]       │
│   目标  [X] [Y] [Z]       │
│   FOV   [   ]             │
│ ▶ 布景项              ③   │   ← 分区 2
│ ▶ 角色姿态        ·艾达   │   ← 分区 3（条件）
│ ▶ 变换                    │   ← 分区 4（条件）
├───────────────────────────┤
│ 撤销 重做 │ 复制 粘贴     │   ← 固定底栏，不随内容滚动
│              取消 重新渲染 │
└───────────────────────────┘
```

结构：`header`（shrink-0） + 滚动区（`flex-1 overflow-y-auto`） + `footer`（shrink-0）。

### 2.3 收起态（44px 图标条）

```
┌──┐
│▸ │  展开把手（只展开；分区与滚动位置保持原样）
│──│
│▣ │  机位
│▤ │  布景项
│▥ │  角色姿态（未选中角色 → disabled + 半透明）
│▦ │  变换（未选中布景项 → disabled + 半透明）
│  │
│↶ │  撤销（常驻）
│↷ │  重做（常驻）
└──┘
```

图标条常驻 4 个分区图标（不适用时置灰而非隐藏，避免图标位置跳动）；撤销/重做常驻底部——收起后这两个高频操作仍需一次点击可达（复制/粘贴/重新渲染留在展开态底栏）。

## 3. 侧栏分区

### 3.1 分区定义

| id | 标题 | 适用条件 | 内容（现行 JSX 变量） | 徽标 |
|---|---|---|---|---|
| `camera` | 机位 | 恒 | `shotSelectorEl` + `cameraEl` | 当前 `rigLabel(shotIndex)` |
| `items` | 布景项 | 恒 | `itemsEl` | `draggable.length` |
| `pose` | 角色姿态 | `selectedItem?.kind === "character"` | `poseEl` | `selectedItem.name` |
| `transform` | 变换 | `selectedItem != null` | `transformEl` | — |

条件不满足的分区在展开态滚动区**不渲染**（不占位）；在图标条里渲染为 disabled。

### 3.2 折叠行为

- 手风琴用**受控** `<button aria-expanded>` + 条件渲染，不用受控 `<details>`（`details` 的 `onToggle` 异步、受控语义不稳）。姿态面板内部 11 组滑杆继续用既有的非受控 `<details>`，不改。
- **允许多个分区同时展开**（与姿态面板 11 组滑杆的既有做法一致）。
- 默认展开 `camera` + `items`，其余收起。
- 折叠 = 内容卸载。各面板状态全在 store / 父级，卸载无副作用。**例外（实现期修正）**：角色姿态内部 11 组滑杆是非受控 `<details>`（无 `open` 受控），其展开状态随卸载丢失——滑杆值本身在 store，无数据损失，仅损失「哪些组处于展开」这一视觉状态。

### 3.3 自动展开

仅在选择变化时触发：

```ts
useEffect(() => {
  for (const id of sectionsForSelection(selectedItem)) setOpenSections((p) => openSection(p, id))
}, [selKey])   // selKey = selectedItem ? `${id}:${kind}` : null
```

`selKey` 是唯一依赖 → 用户手动收起某分区后，只要选择不变就不会被"打架"重开。

### 3.4 图标条点击

图标条点击 `openAt(id)`：展开侧栏 + 确保该分区展开 + 滚入视野。展开把手是更轻的动作——只展开侧栏，不改分区、不滚动。

滚入视野用一次性 state 触发，避免在 `requestAnimationFrame` 里赌渲染时序：

```ts
const [scrollTarget, setScrollTarget] = React.useState<SidebarSection | null>(null)
useEffect(() => {
  if (!scrollTarget) return
  // 先清空再滚动：重置为 null 会再触发一次本 effect，靠上面的 early-return 短路。
  // scrollTarget 已在闭包中捕获，清空不影响下面这次读取。
  setScrollTarget(null)
  sectionRefs.current[scrollTarget]?.scrollIntoView({ block: "nearest" })
}, [scrollTarget])
```

## 4. 构图辅助开关

`FrameOverlay` 增加 `showGuides` 入参（`previs-blocking-editor.tsx:121`）：

```tsx
function FrameOverlay({ aspect, showGuides }: { aspect: MapAspect; showGuides: boolean })
```

`showGuides === false` 时跳过 4 条线（`:134-137`）的渲染，外层 `box-shadow: 0 0 0 9999px` 画幅遮罩**保留**——画幅边界信息不可丢。

**开关位置**：画布上方工具条 `centerTabsEl`（`:784`），置于「导演视角/机位视角」分段控件左侧，两个视角均可见：

```
[3D视图][布景][深度][边缘] │ [⊞ 构图辅助] [导演视角|机位视角]
```

**为什么不放画布 pill**：pill 只在 `viewMode === "director"` 下渲染（`:1183`），而 `FrameOverlay` 两个视角都渲染（`:1285` 在 viewMode 条件之外）。三分线是构图辅助，机位视角下才是主要用途——放 pill 会导致最该用它的视角够不着。

开关为 `<button aria-pressed={showGuides}>`，激活态用与页签一致的 `border-primary/60 bg-primary/10 font-medium` 高亮，图标 `Grid3x3Icon`，`title="构图辅助：画幅九宫格三分线"`。默认 `false`。

## 5. 状态归属

编辑器按分镜重建（`key={index}`，`:1395`），因此**刻意设置**的偏好必须上提到 `PrevisBlockingEditor`（`:1356`），否则切一次机位就被重置：

| 状态 | 归属 | 理由 |
|---|---|---|
| `sidebarCollapsed` | `PrevisBlockingEditor` | 用户主动的布局选择，切分镜不该弹回 |
| `showGuides` | `PrevisBlockingEditor` | 用户主动的视图设置 |
| `openSections` | `BlockingShotEditor`（本地） | 重置无害：组件同时重建，选择也重置，§3.3 的自动展开会重新打开相关分区 |

上提模式沿用同文件已有的 `rigSelection`（`:1375`，跨分镜存活、切项目/阶段自动失效）。

`showLabels` 保持现状（`BlockingShotEditor` 本地、每分镜重置）——既有行为，不在本次范围。

## 6. 机位参数网格适配

`cameraEl`（`:1021`）现为 `grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-7`。`sm:` 断点看的是**视口**宽度而非容器宽度，因此宽屏下 7 个输入框硬塞进侧栏（今天 280px 右栏即如此，每格 ≈ 38px）。改为按语义分行：

```
机位  [X] [Y] [Z]
目标  [X] [Y] [Z]
FOV   [   ]
```

字段总数不变（3+3+1），`NumField` 固定 `w-14`（56px）不改：3 × 56 + 2 间隔 + 32 标签 ≈ 208px，300px 栏宽（内边距后 284px）可容。

## 7. 纯模块接口

新增 `src/lib/engine/previs-panel-state.ts`。项目无 jsdom / testing-library（`vitest.config.ts` 为 `environment: "node"`），119 个既有测试全是纯模块测试——因此把可测逻辑抽成纯函数：

```ts
export const SIDEBAR_SECTIONS = ["camera", "items", "pose", "transform"] as const
export type SidebarSection = (typeof SIDEBAR_SECTIONS)[number]
/** 结构类型而非 BlockingItem：纯模块不耦合应用类型；kind 实际含 character/prop/terrain */
export type PanelSelection = { kind: string } | null

/** 当前选择下适用的分区（顺序即 SIDEBAR_SECTIONS 顺序）：机位/布景项恒在；角色姿态仅角色；变换仅任意选中项 */
export function applicableSections(item: PanelSelection): SidebarSection[]
/** 选择变化时应自动展开的分区 = 适用分区中非默认展开的那些
 *  角色 → ["pose","transform"]；道具 → ["transform"]；null → [] */
export function sectionsForSelection(item: PanelSelection): SidebarSection[]
/** 切换分区开合；返回新 Set，不改动入参 */
export function toggleSection(open: ReadonlySet<SidebarSection>, id: SidebarSection): Set<SidebarSection>
/** 确保分区展开；已展开时返回等值新 Set（调用方可无条件 setState） */
export function openSection(open: ReadonlySet<SidebarSection>, id: SidebarSection): Set<SidebarSection>

export const DEFAULT_OPEN_SECTIONS: ReadonlySet<SidebarSection>   // camera + items
export const SIDEBAR_WIDTH_PX = 300
export const SIDEBAR_RAIL_WIDTH_PX = 44
```

`applicableSections` 同时驱动图标条的置灰判定（§2.3），使「哪些分区现在可用」只有一处定义、可单测。

两个宽度常量**参与渲染**（`style={{ width: SIDEBAR_WIDTH_PX }}`），使测试锁定的值与实际布局同源，避免 class 与常量漂移。

`previs-panel-state.test.ts` 锁定：切换幂等、不可变性（原 Set 不被修改）、`openSection` 幂等、`sectionsForSelection` 三条映射、默认集合恰为 `{camera, items}`、两个宽度常量为正且 rail < sidebar。

## 8. 改动文件

| 文件 | 改动 |
|---|---|
| `src/components/projects/previs-blocking-editor.tsx` | 布局改两栏；新增侧栏（头部/分区/底栏）+ 图标条；`FrameOverlay` 加 `showGuides`；`centerTabsEl` 加构图辅助开关；`cameraEl` 网格改分行；两个状态上提到 `PrevisBlockingEditor` |
| `src/components/projects/previs-fullscreen-editor.tsx` | 仅文档注释（「三栏布局」→「画布 + 可折叠右侧栏」） |
| `src/lib/engine/previs-panel-state.ts` | 新增 |
| `src/lib/engine/previs-panel-state.test.ts` | 新增 |

`previs-3d-viewport.tsx` 不动（三分线是 DOM 覆盖层，与 three.js 场景无关）。

## 9. 验收

**自动门禁**（可机检）：

- `pnpm exec tsc --noEmit` → 0 errors
- `pnpm test` → 119（既有）+ 新增 `previs-panel-state.test.ts` 全绿
- `pnpm build` → 全绿

**人工浏览器验收**（本项无法自动验证：无组件测试环境，且布局/折叠/滚入视野均为 DOM 行为）。`pnpm exec next dev -p 3001` 后进入任一项目的空间预演台全屏编辑，逐项过：

1. 三分线默认不显示；点「构图辅助」出现 2 竖 + 2 横；再点消失
2. 画幅 letterbox 遮罩在三分线关闭时仍在
3. 导演视角 / 机位视角下「构图辅助」开关均可见可点
4. 侧栏收起 → 画布占满宽度；图标条显示 5 个分区图标（机位/光源/布景项/角色姿态/变换）+ 撤销/重做，另加「展开侧栏」开关，共 8 个按钮
   （注：原文为「4 + 2」——「光源」分区是 §9 写定后新增的，此处按实渲染修正）
5. 图标条点「变换」（未选中布景项时置灰；选中后点亮）→ 侧栏展开、该分区展开且滚入视野
6. 切换机位分镜后，侧栏保持收起状态、三分线设置保持
7. 选中角色 → 「角色姿态」+「变换」自动展开；手动收起「变换」后切换选中项才重开
8. 机位参数三个输入行在 300px 栏宽下不溢出、不重叠
9. 布景项列表 X/Z 输入框在侧栏内不溢出
10. 底栏撤销/重做/复制/粘贴/取消/重新渲染均可点，且不随滚动区滚动

## 10. 风险与已知取舍

- **底栏占用垂直空间**：展开态底栏固定 2 行（约 72px），滚动区相应变短。取舍：撤销/渲染属高频操作，固定在视口内优于滚到底。
- **收起态能力损失**：复制/粘贴/重新渲染/机位参数在收起态不可达（需先展开）。取舍：图标条只常驻撤销/重做两项最高频操作，避免图标条退化成第二排按钮墙。
- **`showLabels` 不一致**：本次把 `showGuides` 上提而 `showLabels` 仍每分镜重置，同属「视图偏好」却行为不同。已知不一致，不在本次范围。
- **滚入视野的时序**：依赖 `openSections` 与 `scrollTarget` 同批次更新后 effect 在渲染后运行。若实测出现「点了没滚」，退化为不做滚入视野（§3.4 可独立删除，不影响其余）。

## 11. 验收状态

**自动门禁**（head `cf2fbb4`）：

- `pnpm exec tsc --noEmit`：0 errors
- `pnpm test`：126 passed / 10 files（基线 119 / 9 files + 新增 `previs-panel-state.test.ts` 7 例）
- `pnpm build`：全绿

**人工浏览器验收**（spec §9 十项）：PENDING —— 需 `pnpm exec next dev -p 3001` 后人工逐项确认（无组件测试环境，布局/折叠/滚入视野均为 DOM 行为）。

**终审修复波后复验**：`tsc --noEmit` 0 errors / `pnpm test` 126 passed / 10 files / `pnpm build` 全绿，与上表一致。

**已知门禁外偏差**：`previs-blocking-editor.tsx` 的 `:1026` / `:1034` 触发 2 处 `react-hooks/set-state-in-effect`（eslint 非本计划门禁，本文件在本次改动前即未通过 lint）。两处 effect 均为 spec §3.3 / §3.4 刻意设计的「按 key 变化推状态」，非疏漏；实现方未擅自添加未授权的规则抑制注释。此处单独记录，以免后续 lint 清理误判为意外引入。
