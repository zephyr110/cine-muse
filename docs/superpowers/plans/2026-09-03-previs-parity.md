# Previs 3D 复刻对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对齐 storyai-3d-director-desk 的交互/模型/舞台视觉：全 3D 变换数据模型（v2 迁移）、官方 TransformControls 三模式、程序化精细人模、深色舞台 + 机位 rig/视锥 + 视角切换 + pill 工具条 + 方向 gizmo。

**Architecture:** 数据层先行（types v2 + migrate 版本化 + 工厂/测试形状同步，行为等值）→ SVG 投影升级（v2 语义）→ 人模/视口视觉与交互（plain three，官方 addons：TransformControls + CSS2DRenderer）→ 编辑器接线（pill 工具条/视角切换/快捷键/变换字段）→ 回归与验收。

**Tech Stack:** three 0.185（addons 通道）、React、base-ui/shadcn tokens、vitest。**无新 npm 依赖**。

## Global Constraints

- 数据契约 v2：`BlockingItem.position[1]` 真实高度、`rotationY` → `rotation:[x,y,z]`（度，欧拉）、`scale` → `scale:[x,y,z]`；新增可选 `color?: string`（#rrggbb）
- 版本化：`AppState.version` 引入（缺省视为 1）；`migrateAppState` v1→v2 只转换 previs 产物 blocking 项，**不清空已缓存三图**（下次编辑/重新渲染按 v2 投影刷新）
- 语义锚点：角色/道具/地形原点——character 组原点=脚底平面（y=位置 y），prop/terrain 网格原点=中心（y=位置 y）；**删除全部 +1 悬浮**
- 拾取：raycast 命中叶子后上溯祖先取 `userData.itemId`；仅 `e.button===0`；拖拽阈值 ~5px；拖拽中 `controls.enabled=false` 并保证 pointerup/cancel/卸载兜底恢复
- TransformControls：`three/addons/controls/TransformControls.js`；模式 translate/rotate/scale；拖拽帧 `commit:false` + 松手 `commit:true`
- 角色外观：8 体型沿用现有 `BODY_TYPES` id/height/width/headSize（**不改 poses 表**）；新 buildMannequin 拼装（骨盆/双胶囊躯干/接缝环/头+眼鼻嘴/手/脚），材质 standard（metalness≈0.04 roughness≈0.74）+ 深色细节 #070A0F；角色颜色 = `item.color ?? ITEM_COLOR[character]`；新增角色按 8 色盘取未用色
- 渲染环境：背景黑场 `#000`、地面 #303640（opacity 0.4）、1m 节线 #2A4065 无限网格、hemisphere+directional + renderer shadowMap；rig/gizmo/网格/标签一律不进导出
- 机位 rig：0.35 缩比线框摄像机（#A9D8FF 12 线盒体+倒锥镜头+后圆盘）+ 视锥 4 线 + 隐形命中盒（点击=选中机位不跳视角）；导演视角可见，机位视角隐藏
- fov/aspect 修复：所有 3D 视图与导出统一应用 shot fov 与画幅 aspect（遮罩=实画面）
- 外壳保持现 shadcn 3 栏；画布内交互热点 storyai 化（pill 工具条/方向 gizmo/标签）
- 无新 npm 依赖；UI 中文；测试命令 `pnpm exec vitest run <file>`；全量 `pnpm test`（基线 28 全绿）与 `pnpm build`（13/13）必须过

---

### Task 1: 数据模型 v2 + 版本化迁移（行为等值迁移）

**Files:**
- Modify: `src/lib/types.ts`（BlockingItem + AppState.version）
- Modify: `src/lib/engine/previs-types.ts`（makePrevisShot v2 默认）
- Modify: `src/lib/engine/reducer.ts`（DATA_VERSION + migrateAppState v1→v2）
- Modify: `src/lib/engine/seed.ts`（createSeedState 补 version: 2——若 createInitialState 已含则确认）
- Modify: `src/lib/engine/reducer.test.ts`、`src/lib/engine/previs-render.test.ts`、`src/lib/engine/previs-types.test.ts`（v1 形状 fixture → v2 等值形状）

**Interfaces:**
- Produces: `BlockingItem { id; kind; name; position:[3]; rotation:[3]; scale:[3]; color?: string; bodyType?; poseId?; controls? }`；`AppState.version: number`（=2）；`export const DATA_VERSION = 2`
- 迁移后旧字段（rotationY/标量 scale）在产物中彻底消失

- [ ] **Step 1: 改类型定义**

`src/lib/types.ts` BlockingItem 改为：

```ts
export interface BlockingItem {
  id: string
  kind: "character" | "prop" | "terrain"
  name: string
  /** 世界位置：character 的 y=脚底平面高度；prop/terrain 的 y=几何中心高度（v2 起真实有效） */
  position: [number, number, number]
  /** 欧拉旋转（度，绕任意轴），v2 取代 rotationY */
  rotation: [number, number, number]
  /** 非等比缩放，v2 取代标量 scale */
  scale: [number, number, number]
  /** 角色染色（#rrggbb）；缺省按 kind 派生 */
  color?: string
  /** 角色姿势：体型 + 姿势预设 + 关节角度（度，materialized 全量有效值） */
  bodyType?: string
  poseId?: string
  controls?: Record<string, [number, number, number]>
}
```

在 `AppState` 接口顶部加 `version: number`（`src/lib/types.ts` AppState 定义首行）。

- [ ] **Step 2: 工厂 v2 默认**

`src/lib/engine/previs-types.ts` `makePrevisShot` blocking 三件套改为 v2 形状（行为等值：旧 rotationY 0/scale 1|0.8 → rotation [0,0,0]、scale 等比向量）：

```ts
blocking: [
  { id: `ter-${shotIndex}`, kind: "terrain", name: "场景地形", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  { id: `ch-${shotIndex}`, kind: "character", name: "主角", position: [0, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1] },
  { id: `prop-${shotIndex}`, kind: "prop", name: "关键道具", position: [2, 0, 0], rotation: [0, 0, 0], scale: [0.8, 0.8, 0.8] },
],
```

- [ ] **Step 3: 迁移版本化**

`src/lib/engine/reducer.ts` 顶部加：

```ts
/** 数据形态版本：v2 = BlockingItem 全 3D 变换（rotation 欧拉 / scale 向量 / y 有效） */
export const DATA_VERSION = 2
```

`createInitialState` 的返回值对象加 `version: DATA_VERSION`。重写 `migrateAppState`：

```ts
/** v1 blocking 项 → v2（旧 rotationY 标量 + scale 标量 → 欧拉/向量），v2 起原样保留 */
function migrateBlockingItemV2(item: Record<string, unknown>): Record<string, unknown> {
  const next = { ...item }
  if (typeof next.rotationY === "number") {
    const r = next.rotationY
    next.rotation = [0, r, 0]
    delete next.rotationY
  }
  if (typeof next.scale === "number") {
    const s = next.scale
    next.scale = [s, s, s]
  }
  return next
}

export function migrateAppState(raw: unknown): AppState {
  const s = raw as Partial<AppState> | null
  const version = s?.version ?? 1
  let projects = (s?.projects ?? []).map((p) => ({
    ...p,
    stages: (p.stages ?? []).map((st) => ({
      ...st,
      references: st.references ?? undefined,
      iterations: st.iterations ?? [],
      reviews: st.reviews ?? [],
    })),
  }))
  if (version < 2) {
    projects = projects.map((p) => ({
      ...p,
      stages: (p.stages ?? []).map((st) => {
        const a = st.artifact as { kind?: string; shots?: { blocking?: Record<string, unknown>[] }[] } | undefined
        if (a?.kind === "previs" && Array.isArray(a.shots)) {
          return {
            ...st,
            artifact: { ...a, shots: a.shots.map((sh) => ({ ...sh, blocking: (sh.blocking ?? []).map(migrateBlockingItemV2) })) },
          }
        }
        return st
      }),
    }))
  }
  return {
    ...createInitialState(),
    ...(s ?? {}),
    version: DATA_VERSION,
    projects,
  } as AppState
}
```

（`createInitialState` 若已在 `reducer.ts:78` 定义且被 migrate 展开——确认其返回含 `version: DATA_VERSION` 且 seed 经同一路径。）

- [ ] **Step 4: 全仓 v1 形状使用点机械等值替换**

Run: `grep -rn "rotationY" src --include="*.ts" --include="*.tsx"`
把所有非测试语义引用改为等值 v2：
- `previs-3d-viewport.tsx` 行 106/121（`g.rotation.y = item.rotationY`）→ `const [rx, ry, rz] = item.rotation; g.rotation.set(rx*DEG, ry*DEG, rz*DEG)`；行 107/122 `g.scale.setScalar(item.scale)` → `g.scale.set(...item.scale)`；行 303-306 同步 effect 同样处理；行 119-120 暂保留 +1（Task 3 删除）
- `previs-render.ts` 行 79 `Math.sin(b.rotationY)` → `Math.sin(b.rotation[1])`（等值保行为，Task 2 升级语义）
- 测试 fixture：所有 `rotationY: n` → `rotation: [0, n, 0]`；`scale: s` → `scale: [s, s, s]`（`reducer.test.ts` stateWithPrevis/move fixtures、`previs-render.test.ts` 自定义数据、`previs-types.test.ts` 断言形状处同步）
- 其余任何类型错误由 `pnpm exec tsc --noEmit -p tsconfig.json` 兜底清完

- [ ] **Step 5: 迁移测试（v1→v2）**

`reducer.test.ts` migrateAppState describe 内新增（复用文件顶部既有 v1 legacy fixture 写法，新用例直接内联）：

```ts
it("v1 previs blocking 迁移到 v2 全 3D 形状（rotation/scale 向量化）", () => {
  const legacy = {
    version: 1,
    projects: [
      {
        id: "p1",
        stages: [
          {
            id: "s1",
            agentId: "previs",
            artifact: {
              kind: "previs",
              shots: [
                {
                  shotIndex: 0,
                  camera: { position: [0, 2, 8], target: [0, 1, 0], fov: 45 },
                  blocking: [
                    { id: "c1", kind: "character", name: "主角", position: [0, 0, 1], rotationY: 90, scale: 1.2 },
                    { id: "t1", kind: "terrain", name: "地形", position: [0, 0, 0], rotationY: 0, scale: 1 },
                  ],
                },
              ],
            },
          },
        ],
      },
    ],
  }
  const migrated = migrateAppState(legacy as unknown)
  const shot = (migrated.projects[0]?.stages[0]?.artifact as unknown as { shots: { blocking: BlockingItem[] }[] }).shots[0]
  const char = shot.blocking.find((b) => b.kind === "character")!
  expect(char.rotation).toEqual([0, 90, 0])
  expect(char.scale).toEqual([1.2, 1.2, 1.2])
  expect(char).not.toHaveProperty("rotationY")
  expect(migrated.version).toBe(2)
})
```

（文件头部 import 补 `BlockingItem` 类型 if missing。）

- [ ] **Step 6: 回归**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`（0 错误）→ `pnpm test`（全绿，行数 ≥ 29）→ `pnpm build`（13/13）

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(previs): v2 data model — full-3D transforms with versioned migration"
```

---

### Task 2: SVG 三图投影 v2 语义升级

**Files:**
- Modify: `src/lib/engine/previs-render.ts`
- Test: `src/lib/engine/previs-render.test.ts`

**Interfaces:**
- Consumes: v2 `BlockingItem`（Task 1）
- Produces: 纯函数签名不变（`renderPreviewSvg/renderDepthSvg/renderEdgeSvg/renderPrevisShot/frustumPoints/injectMarkerIds`）；内部投影升级

- [ ] **Step 1: 写失败测试（旋转足迹 + 非等比缩放 + 高度参与深度）**

`previs-render.test.ts` 增补：

```ts
describe("v2 投影语义", () => {
  it("角色足迹矩形随 rotation[1] 旋转、随非等比 scale 缩放", () => {
    const item: BlockingItem = { id: "c1", kind: "character", name: "主角", position: [0, 0, 1], rotation: [0, 90, 0], scale: [2, 1, 1] }
    const svg = renderPreviewSvg([item])
    // 矩形以中心投影点 + 半宽高：scale.x=2 → 足迹半宽 12*2 像素；rotation[1]=90° → 宽轴转向 z
    expect(svg).toContain(`data-kind="character"`)
    expect(svg).toMatch(/<rect[^>]*x="236"[^>]*y="[0-9.]+"[^>]*data-kind="character"/) // 中心 x = 240-? 见 Step 3 实现取值
  })
  it("道具抬升 y 后深度更暗（距离更远）", () => {
    const near: BlockingItem = { id: "p1", kind: "prop", name: "p", position: [2, 0.35, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    const far: BlockingItem = { id: "p2", kind: "prop", name: "p", position: [2, 3, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    const svg = renderDepthSvg([near, far])
    const grey = (x: number, y: number) => svg.match(new RegExp(`<rect x="${x - 10}" y="${y - 10}"[^>]*fill="rgb\\((\\d+),`))?.[1]
    // 以中心 y 更小（俯视近端）者为近：此处断言 far 项灰度数值 < near 项
    expect(Number(grey(240 + 2 * 48, 120 + (1 - 0) * 48))).toBeGreaterThan(Number(grey(240 + 2 * 48, 120 + (1 - 0) * 48)))
  })
})
```

（Step 3 实现后回填精确坐标断言——测试先失败「无 rect/值不符」即可。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/lib/engine/previs-render.test.ts`
Expected: 新用例 FAIL（旧实现输出 circle/无 v2 投影）

- [ ] **Step 3: 投影升级实现**

`previs-render.ts` 重写投影核心（保持 W/H=480/270、48px/单位、z 向上机位在下的坐标约定，兼容现有 frustum/相机/视锥测试锚点）：

```ts
/** 项的世界轴对齐足迹（顶视图用）：按 rotation[1] 旋转 scale 后的半宽/半深 */
function footprint(item: BlockingItem): { cx: number; cy: number; halfW: number; halfD: number; rot: number } {
  const { x, y: py } = project(item)
  const [sx, , sz] = item.scale
  // 角色/道具基准足迹：角色半宽 12 半深 12，道具半宽 10 半深 10，按 scale 放大
  const base = item.kind === "character" ? 12 : 10
  const halfW = base * sx
  const halfD = base * sz
  return { cx: x, cy: py, halfW, halfD, rot: (item.rotation[1] * Math.PI) / 180 }
}

/** 旋转后轴对齐包围盒半宽高（旋转足迹的保守外接：宽=hw|cos|+hd|sin| …），SVG 旋转用矩形 transform 更精确 */
function svgRotatedRect(item: BlockingItem): string {
  const { cx, cy, halfW, halfD, rot } = footprint(item)
  const r1 = (v: number) => Math.round(v * 10) / 10
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  // 以中心为原点旋转 w×d 矩形
  return (
    `<rect x="${r1(cx - halfW)}" y="${r1(cy - halfD)}" width="${r1(halfW * 2)}" height="${r1(halfD * 2)}"` +
    ` rx="6" fill="none" transform="rotate(${r1((item.rotation[1] * 180) / Math.PI)} ${r1(cx)} ${r1(cy)})" data-kind="${item.kind}"` +
    ` data-fill="TODO"`
  )
}
```

（说明：SVG 矩形自身 `transform="rotate(deg cx cy)"` 保留非等比缩放足迹的可读性；`renderPreviewSvg/renderDepthSvg/renderEdgeSvg` 三类绘制改为「角色=带朝向线的旋转圆角矩形足迹（描边填充色按图类）、道具=旋转小矩形、地形=固定大圆角矩形」，朝向线 = 从中心沿 rotation[1] 方向出 16px；字符填充色沿用现 data-kind 锚点且**保持 injectMarkerIds 依赖的 data-kind 顺序契约**——角色/道具按 blocking 顺序输出且每项恰一个带 `data-kind` 的元素；地形无 data-kind 匹配限制不变。）

深度排序与灰度：`viewDist` 改为同时计入旋转/高度——用项中心世界点 `(x, y, z)` 到机位 `[0,2,8]` 距离（沿用近亮远暗），排序远→近绘制；道具半透明矩形仍按 fill 灰度。

（**实现约束**：字符/道具在布景与深度/边缘三图中均为「旋转矩形+朝向线」形态，三类图共享 `footprint`；测试锚点按实际输出回填——以「中心投影 x=240、y=120+(1-z)*48、旋转 90° 时朝向线水平、scale.x=2 时矩形宽 48px」为准写断言。）

- [ ] **Step 4: 回填/校准测试锚点并全绿**

Run: `pnpm exec vitest run src/lib/engine/previs-render.test.ts`
校准 Step 1 两用例坐标（从实现实际值回填精确数字）；既有用例（previewSvg 角色圆点/道具方块/深度/边缘断言）按新形态改写锚点但保持语义（角色 data-kind 存在、朝向线随 rotation 变、深度近亮远暗、边缘含轮廓线段）。全绿后：

Run: `pnpm test && pnpm build`
Expected: 全绿 + 13/13

- [ ] **Step 5: 提交**

```bash
git add src/lib/engine/previs-render.ts src/lib/engine/previs-render.test.ts
git commit -m "feat(previs): v2 SVG projections — rotated footprints, scaled footprints, height-aware depth"
```

---

### Task 3: 程序化精细人模 + v2 网格装配 + 深色舞台

**Files:**
- Modify: `src/components/projects/previs-3d-viewport.tsx`

**Interfaces:**
- Consumes: v2 `BlockingItem`、`BODY_TYPE_BY_ID`
- Produces: `PALETTE: string[]`（8 色盘）、`resolveItemColor(item): number`、新 `buildMannequin(item): THREE.Group`、`buildMesh(item): THREE.Object3D`（v2 transform、角色原点=脚底、删除 +1）

- [ ] **Step 1: 色盘与角色色解析**

文件顶部常量区（ITEM_COLOR 下方）加：

```ts
/** 新增角色 8 色盘轮转（storyai palette 移植） */
export const PALETTE = ["#4F8EF7", "#E0524D", "#E91E63", "#F2A900", "#9C4DCC", "#12B886", "#00B8D9", "#FF7A45"] as const

/** 角色显式色（item.color，hex）→ number；缺省回 kind 色 */
export function resolveItemColor(item: BlockingItem): number {
  if (item.color) {
    const n = Number.parseInt(item.color.replace("#", ""), 16)
    if (!Number.isNaN(n)) return n
  }
  return ITEM_COLOR[item.kind]
}
```

- [ ] **Step 2: 重写 buildMannequin（精细人模）**

替换行 24-76 的 `buildMannequin` 与 `buildBoundsEdges` 保留（人偶组原点=脚底 y0，高度方向 +y，面向 +Z）：

```ts
/** 深色细节（接缝/五官）材质 */
const DETAIL_COLOR = 0x070a0f

/** 程序化精细人偶：骨盆+双胶囊躯干+接缝环+头（眼鼻嘴）+四肢（手/脚细节）。
 *  组原点 = 脚底平面（y=0），高度沿 +y，默认面向 +Z；scale 由父级应用。 */
function buildMannequin(item: BlockingItem): THREE.Group {
  const g = new THREE.Group()
  const body = BODY_TYPE_BY_ID[item.bodyType ?? "standard"]
  const controls = item.controls ?? POSE_PRESET_BY_ID[item.poseId ?? "stand"]?.controls ?? {}
  const h = body?.height ?? 1.8
  const w = body?.width ?? 1
  const color = resolveItemColor(item)
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.04, roughness: 0.74 })
  const dark = new THREE.MeshStandardMaterial({ color: DETAIL_COLOR, metalness: 0.1, roughness: 0.85 })

  const limb = (
    len: number, rad: number, pivot: [number, number, number],
    joint: JointName, detail = true,
  ): THREE.Group => {
    const holder = new THREE.Group()
    holder.position.set(...pivot)
    const [rx, ry, rz] = controls[joint] ?? [0, 0, 0]
    holder.rotation.set(rx * DEG, ry * DEG, rz * DEG)
    const seg = new THREE.Mesh(new THREE.CapsuleGeometry(rad, Math.max(0.05, len - rad * 2), 4, 12), mat)
    seg.position.y = -len / 2
    holder.add(seg)
    if (detail) {
      // 末端（手/脚）球细节
      const tip = new THREE.Mesh(new THREE.SphereGeometry(rad * 1.25, 10, 8), dark)
      tip.position.y = -len + rad * 0.4
      holder.add(tip)
    }
    return holder
  }

  const hipY = h * 0.52
  const shoulderY = h * 0.8
  const chestR = 0.3 * w
  const hipR = 0.32 * w

  // 骨盆
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(hipR, 16, 12), mat)
  pelvis.position.y = hipY - 0.02 * h
  g.add(pelvis)
  // 躯干双胶囊：下胸（腰→胸）与上胸（胸→肩）
  const lower = new THREE.Mesh(new THREE.CapsuleGeometry(chestR * 0.92, Math.max(0.05, (shoulderY - hipY) * 0.62), 4, 12), mat)
  lower.position.y = hipY + (shoulderY - hipY) * 0.31
  g.add(lower)
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(chestR * 0.8, Math.max(0.05, (shoulderY - hipY) * 0.5), 4, 12), mat)
  upper.position.y = hipY + (shoulderY - hipY) * 0.72
  g.add(upper)
  // 接缝环（腰/颈两处深色细环）
  const seam = (y: number, r: number) => {
    const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018 * w, 6, 20), dark)
    t.rotation.x = Math.PI / 2
    t.position.y = y
    g.add(t)
  }
  seam(hipY + (shoulderY - hipY) * 0.55, chestR * 0.94)
  seam(shoulderY - 0.015 * h, chestR * 0.72)

  // 躯干整体关节（含肩部挂点随躯干旋转）
  const [tx, ty, tz] = controls.torso ?? [0, 0, 0]
  const torsoGroup = new THREE.Group()
  torsoGroup.position.y = hipY
  torsoGroup.rotation.set(tx * DEG, ty * DEG, tz * DEG)
  g.add(torsoGroup)
  // 把胸/上胸/接缝/头/臂挂点移入 torsoGroup
  ;[lower, upper].forEach((m) => {
    torsoGroup.attach(m)
  })
  seam(hipY + (shoulderY - hipY) * 0.55, chestR * 0.94)
  ;(torsoGroup.children[0] as THREE.Mesh) // 占位防错

  // 头：球 + 五官（眼鼻嘴，+Z 面向）
  const headR = (body?.headSize ?? 0.34) * 0.5
  const headGroup = new THREE.Group()
  headGroup.position.set(0, shoulderY + headR * 1.15, 0)
  const [hx, hy, hz] = controls.head ?? [0, 0, 0]
  headGroup.rotation.set(hx * DEG, hy * DEG, hz * DEG)
  const skull = new THREE.Mesh(new THREE.SphereGeometry(headR, 18, 14), mat)
  headGroup.add(skull)
  const fz = headR * 0.86
  const eyeY = headR * 0.16
  const eyeX = headR * 0.34
  const eyeR = headR * 0.16
  const mk = (x: number, y: number, z: number, r: number) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), dark)
    m.position.set(x, y, z)
    headGroup.add(m)
  }
  mk(-eyeX, eyeY, fz, eyeR)
  mk(eyeX, eyeY, fz, eyeR)
  mk(0, -eyeY * 0.3, fz * 1.04, headR * 0.1) // 鼻
  mk(0, -eyeY * 1.5, fz * 0.98, headR * 0.14) // 嘴
  headGroup.userData.parts = "head"
  torsoGroup.add(headGroup)

  // 手臂（肩高挂点，随躯干组）
  const armLen = h * 0.33
  const armRad = 0.09 * w
  const shoulderX = 0.42 * w
  const armL = limb(armLen, armRad, [-shoulderX, h * 0.05, 0], "armL")
  const armR = limb(armLen, armRad, [shoulderX, h * 0.05, 0], "armR")
  torsoGroup.add(armL, armR)

  // 腿（髋高挂点，直接入根组——腿不随躯干转）
  const legLen = hipY
  const legRad = 0.13 * w
  g.add(limb(legLen, legRad, [-0.17 * w, hipY, 0], "legL"))
  g.add(limb(legLen, legRad, [0.17 * w, hipY, 0], "legR"))

  // 标注头部/胸部分组供边缘导出取整体包围盒即可（不需额外字段）
  g.userData.facing = 0
  return g
}
```

（注：若实现中发现肢体挂点需微调（如肩挂点相对 torsoGroup 原点为 0 高度差异），只改数值不动结构；胸/头挂进 torsoGroup 后原 `g.add` 的接缝重复添加需去重——实现时以 torsoGroup 内唯一为准。）

- [ ] **Step 3: buildMesh v2 装配（删 +1、欧拉/向量变换）**

替换 `buildMesh`（行 100-124）与同步 effect（行 281-315）中 transform 应用段：

```ts
function buildMesh(item: BlockingItem): THREE.Object3D {
  if (item.kind === "character") {
    const g = buildMannequin(item)
    g.userData.itemId = item.id
    const [x, y, z] = item.position
    g.position.set(x, y, z) // v2：y = 脚底高度，不再 +1
    const [rx, ry, rz] = item.rotation
    g.rotation.set(rx * DEG, ry * DEG, rz * DEG)
    g.scale.set(item.scale[0], item.scale[1], item.scale[2])
    return g
  }
  let geo: THREE.BufferGeometry
  if (item.kind === "terrain") {
    geo = new THREE.BoxGeometry(3, 0.2, 3)
  } else {
    geo = new THREE.BoxGeometry(0.7, 0.7, 0.7)
  }
  const mat = new THREE.MeshStandardMaterial({ color: resolveItemColor(item), metalness: 0.02, roughness: 0.68 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.userData.itemId = item.id
  const [x, y, z] = item.position
  mesh.position.set(x, y, z)
  const [rx, ry, rz] = item.rotation
  mesh.rotation.set(rx * DEG, ry * DEG, rz * DEG)
  mesh.scale.set(item.scale[0], item.scale[1], item.scale[2])
  return mesh
}
```

同步 effect 中两处 `mesh.position.set(x, y + (… ? 0 : 1), z)`/`mesh.rotation.y = …`/`scale.setScalar` 改为同样的 v2 三段式；rigKey 追加颜色（`|${item.color ?? ""}`）使换色即重建。

- [ ] **Step 4: 深色舞台渲染环境**

初始化 effect 中替换场景观感（行 189-204 区域）：

```ts
scene.background = new THREE.Color(0x000000)
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.15)
scene.add(hemi)
const dir = new THREE.DirectionalLight(0xffffff, 1.2)
dir.position.set(8, 10, 6)
scene.add(dir)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
dir.castShadow = true
dir.shadow.mapSize.set(1024, 1024)
dir.shadow.camera.left = -10; dir.shadow.camera.right = 10
dir.shadow.camera.top = 10; dir.shadow.camera.bottom = -10
dir.shadow.camera.near = 0.5; dir.shadow.camera.far = 40
```

地面/网格（替换原 GridHelper 16×16 + ground plane）：

```ts
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshBasicMaterial({ color: 0x303640, transparent: true, opacity: 0.4 }),
)
ground.rotation.x = -Math.PI / 2
ground.position.y = -0.02
ground.receiveShadow = true
ground.userData.itemId = "__ground__"
ground.userData.hideFromViewportCapture = true
scene.add(ground)
// 1m 节线无限网格（细线不可见，节线 #2A4065，80m 淡出）
const grid = new THREE.GridHelper(200, 200, 0x2a4065, 0x2a4065)
;(grid.material as THREE.Material).transparent = true
;(grid.material as THREE.Material).opacity = 0.9
grid.position.y = -0.015
grid.userData.hideFromViewportCapture = true
scene.add(grid)
```

道具/角色 castShadow 开启：buildMesh 两分支 mesh/g `traverse` 设置 `castShadow=true`（几何件），地面 `receiveShadow` 已置。

- [ ] **Step 5: 验证与提交**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`（0 错误）→ `pnpm test`（全绿）→ `pnpm build`
（视觉留人工验收。）
`git commit -m "feat(previs): procedural detailed mannequin, per-item colors, v2 transforms, dark stage"`

---

### Task 4: 视口交互层——拾取修复 / TransformControls / 机位 rig / 标签 / 方向 gizmo / fov·aspect

**Files:**
- Modify: `src/components/projects/previs-3d-viewport.tsx`

**Interfaces:**
- Consumes: v2 形状（T1）、精细人模（T3）
- Produces（Task 5 消费的 props/handle 契约）:
  - `export type TransformMode = "translate" | "rotate" | "scale"`
  - `export type ViewMode = "director" | "camera"`
  - 组件 props 增：`shots: PrevisShot[]`、`shotIndex: number`、`viewMode: ViewMode`、`transformMode: TransformMode`、`showLabels?: boolean`（默认 true）、`onSelectShot?: (index: number) => void`、`onTransform?: (id: string, patch: { position?: [n,n,n]; rotation?: [n,n,n]; scale?: [n,n,n] }, commit: boolean) => void`；删旧 `viewFromCamera` 语义（editor 同步改）
  - handle 增：`setViewAspect(a: number | null)`（null=容器自适应；非 null=按画幅比例锁定相机 aspect，editor 在画幅切换时调用）、`snapViewToAxis(axis: [number,number,number])`
  - **导出排除通用化**：`withCaptureView`（captureMaps 内）由「仅隐藏 hlGroup/camGizmo」改为「隐藏全部 `userData.hideFromViewportCapture=true` 对象 + hlGroup + gizmo helper」（rig/网格/标签/CSS2D 天然被排除；CSS2D 为独立 DOM 层本就进不了 canvas 导出）

- [ ] **Step 1: 拾取修复与手势仲裁**

替换 `onPointerDown`/`onPointerMove`/`endDrag`（行 357-402）逻辑主体：

```ts
/** 从命中对象向上找携带 itemId 的祖先 */
function ownerId(obj: THREE.Object3D | null): string | null {
  let cur: THREE.Object3D | null = obj
  while (cur) {
    const id = cur.userData.itemId as string | undefined
    if (id) return id
    cur = cur.parent
  }
  return null
}
```

`onPointerDown`：仅 `e.button === 0` 处理；记录 `st.downAt = {x: e.clientX, y: e.clientY, id}`——先不选中不拖拽；命中判定同前但用 `ownerId(hit.object)`；`st.dragArmed = id != null && id !== "__ground__" && id !== "__camera__"`。
`onPointerMove`：未 armed 直接 return；移动超 5px → 进入拖拽：`onSelect(id)`、`dragId=id`、`dragging=true`、`controls.enabled=false`、`setPointerCapture`；`onTransform` 帧派发见 Step 3（统一 gizmo 通道后此处仅保留兜底，gizmo 激活时跳过本通道：`if (st.gizmoActive) return`）。
`endDrag`：`dragging=false; dragId=null; dragArmed=false; controls.enabled=true;` 释放 capture；若本次为「点选未拖」且命中 id 且 != __ground__ → `onSelect(id)`（点选语义）；`__camera__` 命中 → 由 rig 命中盒自有 handler 处理（Step 4），此处忽略。
组件卸载 cleanup 中确保 `controls.enabled = true` 兜底（在初始化 effect 的 return 前加）。

- [ ] **Step 2: TransformControls 接入**

stateRef 增 `gizmo: THREE.TransformControls | null`、`gizmoMode: TransformMode`、`gizmoActive: boolean`。初始化 effect 中创建：

```ts
import { TransformControls } from "three/addons/controls/TransformControls.js"
const gizmo = new TransformControls(camera, renderer.domElement)
gizmo.addEventListener("dragging-changed", (ev) => {
  st.gizmoActive = ev.value
  st.controls.enabled = !ev.value
  if (!ev.value) st.gizmo.dispatchEvent({ type: "commit" })
})
gizmo.userData.hideFromViewportCapture = true
scene.add(gizmo.getHelper())
```

选中与模式同步 effect：

```ts
React.useEffect(() => {
  const st = stateRef.current
  if (!st) return
  const mesh = selectedId ? st.itemMeshes.get(selectedId) : null
  if (mesh && mesh.userData.itemId !== "__ground__") {
    st.gizmo.attach(mesh)
  } else {
    st.gizmo.detach()
  }
  st.gizmo.setMode(transformMode)
}, [selectedId, transformMode, items])
```

（`items` 变化重建网格后重挂——effect 依赖含 items。）

变换提交（`objectChange` → 帧派发；`commit` → 终帧）：

```ts
const applyGizmo = (commit: boolean) => {
  const st = stateRef.current
  const obj = st?.gizmo.object
  if (!st || !obj) return
  const id = ownerId(obj)
  if (!id || id === "__ground__") return
  const [px, py, pz] = [obj.position.x, obj.position.y, obj.position.z]
  const [rx, ry, rz] = [THREE.MathUtils.radToDeg(obj.rotation.x), THREE.MathUtils.radToDeg(obj.rotation.y), THREE.MathUtils.radToDeg(obj.rotation.z)]
  const [sx, sy, sz] = [obj.scale.x, obj.scale.y, obj.scale.z]
  const round2 = (v: number) => Math.round(v * 100) / 100
  propsRef.current.onTransform?.(id,
    { position: [round2(px), round2(py), round2(pz)], rotation: [round2(rx), round2(ry), round2(rz)], scale: [round2(sx), round2(sy), round2(sz)] },
    commit)
}
st.gizmo.addEventListener("objectChange", () => applyGizmo(false))
st.gizmo.addEventListener("commit", () => applyGizmo(true))
```

注意：character 组原点=脚底，translate y 即抬升；gizmo rotate 绕组原点（脚底）→ 绕脚旋转不绕重心——**补偿**：attach 前把角色组几何包进居中子组？——为避免复杂化，rotate/scale 模式下 gizmo 锚点沿用组原点，属可接受（storyai 亦按 rig 原点）。实现中不做补偿，验收评估。

- [ ] **Step 3: fov/aspect 修复与机位视角**

初始化 effect：相机初始 `fov: 45`；视口 resize 与视图 effect 按 `viewMode`：

```ts
// —— 导演/机位视角 + fov/aspect ——
React.useEffect(() => {
  const st = stateRef.current
  if (!st) return
  const cam = propsRef.current.shots[propsRef.current.shotIndex]?.camera
  if (propsRef.current.viewMode === "camera" && cam) {
    st.camera.position.set(...cam.position)
    st.controls.target.set(...cam.target)
    st.camera.fov = cam.fov
    st.camera.aspect = st.viewAspect // 由画幅比例决定（Step 4）
    st.camera.updateProjectionMatrix()
    st.controls.enabled = false
  } else {
    // 恢复导演位姿（若无记录则默认 [8,8,10]→(0,1,0)）
    if (st.directorView) {
      st.camera.position.copy(st.directorView.pos)
      st.controls.target.copy(st.directorView.target)
    }
    st.camera.fov = st.directorView?.fov ?? 45
    st.camera.aspect = st.directorAspect
    st.camera.updateProjectionMatrix()
    st.controls.enabled = true
  }
}, [viewMode, shotIndex, shots])
```

OrbitControls `change` 事件里缓存导演位姿（仅 director 模式）`st.directorView = { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov }`（节流：直接赋值即可）。stateRef 增 `viewAspect`（默认 16/9 渲染宽度比——**画幅 aspect 语义**：director 模式用容器宽高比；camera 模式/导出按所选画幅；遮罩 DOM 由 editor 负责 → 视口对外暴露 `setViewAspect(a)` handle，editor 在画幅切换时调用并让 DOM letterbox 同步）。

handle 增 `setViewAspect: (a: number | null) => void`（null = 容器自适应）。

- [ ] **Step 4: 机位 rig（线框摄像机 + 视锥 + 命中盒 + 标签挂点）**

初始化 effect 建 `rigGroup`（userData.hideFromViewportCapture = true、visible 随 viewMode）。每 shot 一个 rig：

```ts
function buildCameraRig(): THREE.Group {
  const g = new THREE.Group()
  const line = (pts: [number, number, number][], color = 0xa9d8ff, opacity = 0.92) => {
    const geo = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p)))
    const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity })
    const l = new THREE.Line(geo, m)
    l.userData.hideFromViewportCapture = true
    g.add(l)
    return l
  }
  const s = 0.35 // 0.35 缩比
  // 盒体 12 线 (0.4×0.4×1 缩比)
  const a = 0.2 * s, b = 0.2 * s, c = 0.5 * s
  const corners: [number, number, number][] = []
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push([sx * a, sy * b, sz * c])
  const idx = [[0,1],[0,2],[1,3],[2,3],[4,5],[4,6],[5,7],[6,7],[0,4],[1,5],[2,6],[3,7]]
  for (const [i, j] of idx) line([corners[i], corners[j]])
  // 倒锥镜头（指向 -Z 前方点）
  const lensTip: [number, number, number] = [0, 0, -c - 0.09 * s]
  for (const [x, y] of [[-a, -b], [a, -b], [a, b], [-a, b]]) line([[x, y, c], lensTip])
  // 后部圆盘（两圈，顶部）
  const disc = (yy: number) => {
    const pts: [number, number, number][] = []
    for (let i = 0; i <= 20; i++) {
      const ang = (i / 20) * Math.PI * 2
      pts.push([Math.cos(ang) * 0.16 * s, yy, -c + Math.sin(ang) * 0.16 * s])
    }
    line(pts)
  }
  disc(0.2 * s)
  disc(0.2 * s + 0.05)
  // 视锥 4 线：镜头尖 → 远帧 16:9 角点（宽 3.2*s 于 depth 1.82）
  const depth = 1.82
  const hw = (3.2 / 2) * s * 1.0, hh = hw / (16 / 9) * 1.0
  const frameCorners: [number, number, number][] = [[-hw, hh, -c - depth], [hw, hh, -c - depth], [hw, -hh, -c - depth], [-hw, -hh, -c - depth]]
  for (const fc of frameCorners) line([lensTip, fc])
  // 隐形命中盒（padding）
  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(0.8 * s, 0.8 * s, 1.6 * s),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
  )
  hit.userData.cameraHit = true
  hit.userData.hideFromViewportCapture = true
  g.add(hit)
  return g
}
```

同步 effect（随 `shots`）：每 shot rig 位置/朝向：

```ts
// rig 位置=shot.camera.position；朝向=lookAt(target)；rig 前向(+Z?) 约定：组 lookAt 后相机本体 -Z 朝向 target 即可——用 rig.lookAt(target)
function updateRigs() {
  const st = stateRef.current
  if (!st) return
  const shots = propsRef.current.shots
  while (st.rigGroup.children.length > shots.length) { const o = st.rigGroup.children.pop()!; st.rigGroup.remove(o) }
  shots.forEach((shot, i) => {
    let rig = st.rigGroup.children[i] as THREE.Group | undefined
    if (!rig) {
      rig = buildCameraRig()
      st.rigGroup.add(rig)
    }
    rig.position.set(...shot.camera.position)
    rig.lookAt(new THREE.Vector3(...shot.camera.target))
    rig.userData.shotIndex = i
    rig.userData.itemId = `__camera__`
  })
}
```

rig 命中：raycast 后若 `ownerId` 为 `__camera__` → 上溯找到携带 `shotIndex` 的祖先 → `onSelectShot(idx)` 并 `onSelect(null)`（点选不拖、不跳视角）。rig 组整体 `visible = viewMode === "director"`。

（**实现注意**：相机本体 +Z 朝向 target 使「镜头」背对 target——将 rig 旋转 180° 使 -Z 指向 target：`rig.rotation.y += Math.PI` 于 lookAt 之后；导出/截图与本 rig 无关，仅视觉。）

- [ ] **Step 5: CSS2D 名字标签 + 方向 gizmo**

初始化 effect：

```ts
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js"
const labelRenderer = new CSS2DRenderer()
labelRenderer.domElement.style.position = "absolute"
labelRenderer.domElement.style.top = "0"
labelRenderer.domElement.style.pointerEvents = "none"
host.appendChild(labelRenderer.domElement)
const labelLayer = new THREE.Group()
labelLayer.userData.hideFromViewportCapture = true
scene.add(labelLayer)
// 帧循环同时 labelRenderer.render(scene, camera)；resize 同步 labelRenderer.setSize
```

标签同步 effect（随 items/shots/selectedId）：

```ts
function makeLabel(text: string): CSS2DObject {
  const el = document.createElement("div")
  el.className = "pointer-events-none rounded-full border border-border/60 bg-background/85 px-2 py-0.5 text-[10px] leading-none text-foreground shadow-sm backdrop-blur-sm"
  el.textContent = text
  const obj = new CSS2DObject(el)
  obj.position.y = 1.0 // 相对父级头顶偏移，由调用处决定
  return obj
}
// 清理 labelLayer；对 items：label 挂在 item mesh 上（mesh.add(label)，y=mesh 包围盒高 +0.15）；对 shots：rig 挂「机位N」标签；角色名=item.name
```

标签可见性 = 角色标签开关（editor 状态，通过 props `showLabels: boolean` 传入，默认 true）。

方向 gizmo（DOM，host 内 absolute 右上；点击轴 → handle `snapViewToAxis`）：

```ts
function snapViewToAxis(axis: [number, number, number]) {
  const st = stateRef.current
  if (!st) return
  if (st.viewMode !== "director") return // 机位视角下 gizmo 隐藏（editor 控制显隐）
  const tgt = st.controls.target
  const dist = st.camera.position.distanceTo(tgt) || 5
  const v = new THREE.Vector3(...axis).normalize().multiplyScalar(dist)
  st.camera.position.copy(tgt).add(v)
  st.camera.lookAt(tgt)
  st.controls.update()
}
```

DOM 结构（组件 return 内，host 下叠放）：

```tsx
<div ref={hostRef} className="relative h-full w-full touch-none" onPointerDown={...} ...>
  {/* 方向 gizmo：右上角 */}
  <div className="pointer-events-none absolute right-2 top-2 z-10 flex flex-col items-center gap-0.5 rounded-md border border-border/60 bg-background/70 p-0.5 backdrop-blur-sm">
    {/* 视觉轴：top = +Y；三向交叉指示 */}
    <div className="flex flex-col items-center">
      <button type="button" aria-label="切换到 Y 正向视图" className="pointer-events-auto rounded px-1 text-[9px] font-bold text-emerald-400 hover:bg-border/50" onClick={() => snapY(1)}>Y</button>
      <div className="flex items-center gap-2">
        <button aria-label="切换到 X 反向视图" className="... text-rose-400" onClick={() => snapX(-1)}>X−</button>
        <span className="size-1.5 rounded-full bg-zinc-400" />
        <button aria-label="切换到 X 正向视图" className="... text-rose-400" onClick={() => snapX(1)}>X</button>
      </div>
      <button aria-label="切换到 Y 反向视图" className="... text-emerald-400" onClick={() => snapY(-1)}>Y−</button>
      <button aria-label="切换到 Z 正向视图" className="... text-sky-400" onClick={() => snapZ(1)}>Z</button>
      <button aria-label="切换到 Z 反向视图" className="... text-sky-400" onClick={() => snapZ(-1)}>Z−</button>
    </div>
  </div>
</div>
```

（按钮布局实现可调，语义=6 轴向视图切换按钮 + 右上角定位；`snapX/Y/Z(±1)` 调用 `snapViewToAxis`。gizmo 组件在 camera 模式下整体隐藏——host 内条件渲染 `{viewMode === "director" && ...}`。）

- [ ] **Step 6: 验证与提交**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`（0 错误）→ `pnpm test` → `pnpm build`
（editor 侧 props 未接线前组件不挂载——tsc 通过即可；接线在 Task 5。）
`git commit -m "feat(previs): pick fixes, TransformControls modes, camera rigs, CSS2D labels, axis gizmo, fov/aspect"`

---

### Task 5: 编辑器接线——pill 工具条 / 视角切换 / 快捷键 / 变换字段 / 设视角为机位

**Files:**
- Modify: `src/components/projects/previs-blocking-editor.tsx`
- Modify: `src/components/projects/previs-fullscreen-editor.tsx`（如需传新 props）

**Interfaces:**
- Consumes: Task 4 的 props/handle 契约、`PALETTE`
- Produces: 全屏 3D 视图可用完整交互

- [ ] **Step 1: 视口接线与新状态**

编辑器增 state：`viewMode: "director" | "camera"`（默认 director）、`transformMode: TransformMode`（默认 translate）、`showLabels`（默认 true）。现 `viewFromCamera` state 由 viewMode 取代（UI 上「从机位看」toggle → 「机位视角/导演视角」segmented toggle）。向 `<PrevisViewport>` 传 `shots/ shotIndex / viewMode / transformMode / onSelectShot / onTransform` 并保留 onSelect/onMoveItem（onMoveItem 改由 onTransform 通路实现：视图内地面拖不再直接走 onMoveItem——移除旧 onMoveItem prop 依赖，统一 onTransform commit 语义）。

`onTransform(id, patch, commit)` 实现：

```ts
const handleTransform = (id: string, patch: {...}, commit: boolean) => {
  const items = draftItems // 当前 shot blocking
  const next = items.map((b) => (b.id === id ? { ...b, position: patch.position ?? b.position, rotation: patch.rotation ?? b.rotation, scale: patch.scale ?? b.scale } : b))
  dispatch({ type: "UPDATE_PREVIS_BLOCKING", ..., blocking: next, commit: commit !== false })
}
```

（沿用既有 commit 语义：commit=false 中间帧不占 undo——现有 `pushUndo` 对 commit:false 跳过，已具备。）

现 draft/commit propsKey 机制保留。shot 切换时（shotIndex 变化）向视口 handle 调 `setViewAspect`（画幅默认 16:9）——画幅 state 已存在于工具条（aspect state）。

- [ ] **Step 2: pill 工具条（替换现中栏工具行，画布内 bottom 覆盖）**

中栏 3D tab 内，stage 容器（`relative flex-1 overflow-hidden rounded-md border bg-background`）加 absolute 底部覆盖层：

```tsx
{viewMode === "director" && (
  <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border/60 bg-background/80 px-2 py-1.5 shadow-lg backdrop-blur-md">
    <ModeButton active={transformMode === "translate"} icon={<Move3dIcon className="size-4" />} label="移动" onClick={() => setTransformMode("translate")} />
    <ModeButton active={transformMode === "rotate"} icon={<Rotate3dIcon className="size-4" />} label="旋转" onClick={() => setTransformMode("rotate")} />
    <ModeButton active={transformMode === "scale"} icon={<Scale3dIcon className="size-4" />} label="缩放" onClick={() => setTransformMode("scale")} />
    <span className="mx-0.5 h-4 w-px bg-border" />
    <ModeButton icon={<UserPlusIcon className="size-4" />} label="添加角色" onClick={openAddCharacter} />
    <ModeButton icon={<CameraIcon className="size-4" />} label="设当前视角为机位" onClick={commitViewToCamera} />
    <ModeButton icon={<FrameIcon className="size-4" />} label={`画幅 ${aspect}`} onClick={() => setAspectOpen((v) => !v)} />
    <ModeButton icon={<ImageIcon className="size-4" />} label="当前视角截图" onClick={captureCurrent} />
    <ModeButton icon={<OrbitIcon className="size-4" />} label="环绕拍摄" onClick={() => setOrbitOpen((v) => !v)} />
  </div>
)}
```

- `ModeButton`：本地小组件（圆按钮 size-8 rounded-full + hover 提示小 pill：`group relative` + `invisible group-hover:visible absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-foreground px-2 py-0.5 text-[10px] text-background`）
- 图标（lucide `*Icon` 后缀）：`Move3dIcon` `Rotate3dIcon` `Scale3dIcon` `UserPlusIcon` `CameraIcon` `FrameIcon` `ImageIcon` `OrbitIcon`（若某图标名不存在，换等价 lucide 名并在报告注明）
- 原中栏工具行内容迁移：view tabs（3D/布景/深度/边缘）保留为 stage 上方一行小 tabs（不改）；aspect 按钮组/环绕条/截图等从原工具行移入 pill 弹层（aspect 弹层=stage 上方小 popover 3 选项沿用现 chips 组；环绕条沿用现 h-16 条，由 OrbitIcon 展开在 stage 底部上方）；「从机位看」toggle 由顶部视角切换承担（Step 3）
- `openAddCharacter`：弹层列 8 体型（`BODY_TYPES.map` name）→ 点选后 append 角色（Step 4）
- `commitViewToCamera`：调 viewport handle `getViewCamera()` → 现有 `applyViewCamera` 逻辑（恢复：update 当前 shot camera + 标红更新）→ 需保留本地 viewport ref（编辑器已有 ref 调 captureMaps/orbits——沿用）
- `captureCurrent`：沿用现「重新渲染/导出」入口语义——不重复造：本按钮调现有 captureMaps(aspect) 并写回 maps（可并入现「重新渲染」按钮功能：pill 上保留「重新渲染」？→ pill 的截图按钮=调用现 handle.captureMaps 并 dispatch UPDATE_PREVIS_MAPS 保存三图 + toast 提示导出完成；原「取消/重新渲染」按钮保留于右栏不动）

- [ ] **Step 3: 顶部视角切换 + 机位选择入口**

stage 上方（view tabs 行右侧）加 segmented：

```tsx
<div className="flex items-center rounded-md border border-border bg-muted/40 p-0.5 text-xs">
  <button className={viewMode === "director" ? "rounded px-2 py-0.5 bg-background shadow-sm" : "px-2 py-0.5 text-muted-foreground"} onClick={() => setViewMode("director")}>导演视角</button>
  <button className={viewMode === "camera" ? "..." : "..."} onClick={() => setViewMode("camera")}>机位视角</button>
</div>
```

机位视角下自动应用当前 shot 相机（Task 4 viewport 内部按 viewMode 处理），右栏相机面板保持可编辑；切换回 director 恢复轨道位姿。shot 选择器（左栏既有「镜头 N」）保留；rig 点击（Task 4）触发 `onSelectShot` → 编辑器 `setShotIndex(i)`（并保持在 director 视角，右栏切该 shot 数据）。

- [ ] **Step 4: 添加角色（色盘轮转）**

```ts
const nextPaletteColor = (items: BlockingItem[]): string => {
  const used = new Set(items.filter((b) => b.kind === "character").map((b) => b.color).filter((c): c is string => !!c))
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[(items.length + 1) % PALETTE.length]
}
```

`openAddCharacter` 弹层选体型后：

```ts
const addCharacter = (bodyType: string) => {
  const items = draftItems
  const id = `ch-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const col = (items.filter((b) => b.kind === "character").length % 4) - 1.5 // -1.5,-0.5,0.5,1.5
  const z = 1 + Math.floor(items.filter((b) => b.kind === "character").length / 4) * 0.8
  const next = [...items, { id, kind: "character" as const, name: `角色${String(items.filter((b) => b.kind === "character").length + 1).padStart(2, "0")}`, position: [Math.round(col * 1.25 * 100) / 100, 0, Math.round(z * 100) / 100], rotation: [0, 0, 0], scale: [1, 1, 1], color: nextPaletteColor(items), bodyType, poseId: "stand", controls: undefined }]
  dispatch({ type: "UPDATE_PREVIS_BLOCKING", ..., blocking: next })
  setSelectedId(id)
  setBodyTypeDraft?.(...) // 若弹层为受控复用现 pose 面板状态则同步
}
```

（新增角色 id 唯一；命名 角色NN 与现有复制语义一致；落位避免重叠：与现 makePrevisShot 同区。若现编辑器已有「添加」路径/复制语义可复用其命名，报告注明。）

- [ ] **Step 5: 右栏变换字段（精确输入 + y 归位）**

选中项（角色/道具/地形均可）时，右栏相机面板上方加「变换」分组（pose 面板仅角色显示不变）：

```tsx
function TransformGroup({ item, onChange }: { item: BlockingItem; onChange: (patch: { position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] }) => void }) {
  const Row = ({ label, values, onCommit, step = 0.1 }: { label: string; values: [number, number, number]; onCommit: (v: [number, number, number]) => void }) => (
    <div className="grid grid-cols-[3.5rem_1fr_1fr_1fr] items-center gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {(["X", "Y", "Z"] as const).map((ax, i) => (
        <input key={ax} type="number" step={step} defaultValue={values[i]} data-axis={ax}
          onBlur={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) { const next = [...values] as [number, number, number]; next[i] = Math.round(v * 100) / 100; onCommit({ [label.toLowerCase()]: next } as never) } }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
          className="h-7 w-full rounded border border-border bg-background px-1.5 text-right outline-none focus:border-ring" />
      ))}
    </div>
  )
  return (
    <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-2.5">
      <Row label="位置" values={item.position} onCommit={(v) => onChange({ position: v })} />
      <Row label="旋转" values={item.rotation} onCommit={(v) => onChange({ rotation: v })} />
      <Row label="缩放" values={item.scale} onCommit={(v) => onChange({ scale: v })} />
    </div>
  )
}
```

（提交语义：blur/Enter → handleTransform commit:true → undo 单步。实现选**受控方案**：input `value` 绑本地暂存 state（随 item 值初始化、外部变化经 `key={item.id + label + axis}` 重挂同步），`onChange` 更新暂存，blur/Enter 才 commit；避免拖动 gizmo 时输入框闪烁。验收以「改值回车/失焦生效、undo 单步、gizmo 拖动期间输入框不被搅动」为准。）

同组底部加角色标签开关（绑定 `showLabels` state，传 viewport）：

```tsx
<div className="flex items-center justify-between text-xs text-muted-foreground">
  <span>角色标签</span>
  <button type="button" role="switch" aria-checked={showLabels} onClick={() => setShowLabels((v) => !v)}
    className={`h-4 w-7 rounded-full transition-colors ${showLabels ? "bg-primary" : "bg-border"}`}>
    <span className={`block size-3.5 translate-x-0.5 rounded-full bg-background transition-transform ${showLabels ? "translate-x-3" : ""}`} />
  </button>
</div>
```

- [ ] **Step 6: 快捷键（fullscreen 内）**

`previs-fullscreen-editor.tsx`（或 blocking-editor fullscreen variant）加 keydown effect：

```ts
React.useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault()
      if (e.shiftKey) { /* redo */ dispatchRedo() } else { dispatchUndo() }
      return
    }
    if (mod && e.key.toLowerCase() === "c") { e.preventDefault(); copySelected() }
    if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); pasteClipboard() }
    if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
      e.preventDefault()
      if (selectedId) removeSelected()
    }
  }
  window.addEventListener("keydown", onKey)
  return () => window.removeEventListener("keydown", onKey)
}, [/* 依赖：dispatch 函数/selectedId 的 ref 或 deps */])
```

`removeSelected`：dispatch blocking 过滤掉 selectedId + setSelectedId(null)。copy/paste/undo/redo 复用现按钮 handler（提取为稳定引用）。删除角色色盘占用随之释放（色盘计算即时）。

- [ ] **Step 7: 验证与提交**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`（0 错误）→ `pnpm test` → `pnpm build`（13/13）
`git commit -m "feat(previs): pill toolbar, view-mode toggle, add-character palette, transform fields, shortcuts"`

---

### Task 6: 回归 + 人工验收清单 + 文档收口

**Files:**
- Modify: `docs/superpowers/specs/2026-09-03-previs-parity-design.md`（状态段勾选验收项，标注人工项）

- [ ] **Step 1: 全量回归**

Run: `pnpm test`（≥ 29 全绿）→ `pnpm build`（13/13）→ `pnpm exec tsc --noEmit -p tsconfig.json`（0 错误）

- [ ] **Step 2: 无残留引用检查**

Run: `grep -rn "rotationY\|viewFromCamera" src --include="*.ts" --include="*.tsx"`
Expected: 仅剩迁移函数/历史测试注释内的字面量（若有）——v2 语义不应有活引用；`viewFromCamera` 应零命中（编辑器已切 viewMode）。有残留则清理并回归。

- [ ] **Step 3: 人工验收清单（dev server，浏览器）**

启动 `pnpm dev`（或 dev:all），进入全屏预演台 3D 视图，对照 spec §7 验收项逐条勾选并记录（此步需人类执行——输出清单到 spec §0 状态区，标记 PENDING → 由用户在合并后实测勾选）：

- [ ] 角色可拾取拖动（地面平移/抬升 y）、地形不再误拖
- [ ] 移动/旋转/缩放三模式轴柄生效；旋转绕轴、缩放非等比、gizmo 不卡死（松手后轨道恢复）
- [ ] 添加角色：8 体型可选、落位不重叠、自动选中、8 色盘轮转不重色
- [ ] Delete 删除选中；⌘/Ctrl+Z、⇧Z、C、V 生效（输入框聚焦时不触发）
- [ ] 角色外观：五官/双色/接缝可见；8 体型轮廓差异可见；站立贴地不悬浮
- [ ] 画布深色舞台观感：黑场 + 深灰地面 + 深蓝节线网格 + 阴影
- [ ] 机位 rig：导演视角可见线框摄像机+视锥+名字标签；点击 rig 选中机位（不跳视角）；机位视角锁定 shot 且 fov 正确
- [ ] 画幅比例切换：letterbox 与实画面同 aspect；遮罩=所见；导出三图按所选画幅
- [ ] 方向 gizmo 六向切换生效（机位视角隐藏）
- [ ] 右栏变换字段精确改值生效（回车/失焦）、undo 单步
- [ ] 布景/深度/边缘 SVG 与 3D 数据一致（旋转/缩放/抬升后重新渲染比对）

- [ ] **Step 4: 提交（含清单状态）**

```bash
git add docs/superpowers/specs/2026-09-03-previs-parity-design.md
git commit -m "docs(previs): mark parity spec acceptance — manual browser items pending human check"
```
