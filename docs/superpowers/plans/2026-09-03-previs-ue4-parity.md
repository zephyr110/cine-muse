# UE4 素体完全复刻 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3D 预演台人物外观/交互/摄像机 1:1 复刻 storyai：UE4 素体 GLB + 骨骼驱动、姿势词表/体型换装（v3 数据迁移）、rig 可拖动、仅 gizmo 高亮。

**Architecture:** 纯数据/引擎层先行（词表/预设/体型替换 + v2→v3 迁移），然后 UE4 渲染路径（骨骼驱动移植 + 双路径回退），最后视口/编辑器交互修正。参考实现数值 1:1 移植自 `/Users/zephyr/.claude/jobs/19e19313/tmp/storyai-ref`（下称 **REF**）；我方自有逻辑（迁移映射/相机数学/加载器壳/滑杆组）为全新建模。

**Tech Stack:** three 0.185 addons（GLTFLoader/SkeletonUtils/TransformControls/CSS2DRenderer）、Next 16 static export、vitest。无新 npm 依赖。

## Global Constraints

- 词表/预设/体型/限位数值以 REF 为准 **1:1 逐字移植**（偏差必须报告并说明）
- `public/models/ue-mannequin-retopology.glb` + `ue-mannequin-retopology.license.txt` 随资产复制（Sketchfab Standard，署名义务；spec §2.1）
- `controls` 形状 v3：`Record<string, number>`（键=词表、值=度；`body.offsetY` 为长度单位按 REF 语义）；`bodyType` 值域 = storyai 8 ID（mannequin/female/broad/muscular/slim/teen/child/chibi）
- DATA_VERSION 2→3；迁移映射表（体型 §spec3.2 / 姿势 §spec3.3）逐条覆盖；undo 快照同步；SVG/PNG 缓存不清空
- 默认渲染 UE4 素体；GLB 加载/实例化失败回退程序化人偶（同 REF error-boundary 语义），程序化由同词表驱动
- 选中高亮=仅 gizmo（删除红色包围盒高亮渲染路径；`buildBoundsEdges` 仅保留导出边缘图用途）
- rig 拖动：选中 rig → TransformControls；translate/rotate 随动，target 沿新朝向保持原视距（`commitCameraTransformFromViewport` 语义）；scale 对 rig 禁用（toast 提示）
- 机位标签「机位NN」两位补零；编辑器 commit 移除 X/Z 钳制
- 测试 `pnpm exec vitest run <file>`；全量 `pnpm test` 基线 35 全绿；`pnpm build` 13/13；UI 中文
- 工作树：`/Users/zephyr/Code/cine-muse/.claude/worktrees/previs-ue4`（branch feat/previs-ue4，base=main f14397c）

---

### Task 1: 资产复制 + UE4 骨骼驱动移植（纯层）

**Files:**
- Copy: `REF/public/models/ue-mannequin-retopology.glb` + `ue-mannequin-retopology.license.txt` → `public/models/`
- Create: `src/lib/engine/previs-ue4-rig.ts`（移植 REF `runtime/ue4Mannequin/ue4MannequinRig.ts` + `ue4MannequinPoseApplication.ts` 的纯函数与场景应用逻辑）
- Test: `src/lib/engine/previs-ue4-rig.test.ts`

**Interfaces:**
- Produces（后续任务消费）:
  - `export type Ue4BodyType = "mannequin" | "female" | "broad" | "muscular" | "slim" | "teen" | "child" | "chibi"`
  - `export interface Ue4RestPose { boneLocal: Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }> }`
  - `export function getUE4PoseBoneRotations(controls: Record<string, number>): Record<string, THREE.Euler>`（REF 同表）
  - `export function getUE4BodyBoneScales(bodyType: Ue4BodyType): Record<string, THREE.Vector3>`（REF 同表）
  - `export function getUE4ModelScale(bodyType: Ue4BodyType): number`（teen .88 / child .72 / chibi .56 / 其余 1）
  - `export function getUE4LabelAnchorY(bodyType: Ue4BodyType): number`（REF 表）
  - `export function captureUE4RestPose(scene: THREE.Object3D): Ue4RestPose`
  - `export function applyUE4Rig(scene: THREE.Object3D, rest: Ue4RestPose, controls: Record<string, number>, bodyType: Ue4BodyType): void`（reset rest → offsetY 英寸换算位置偏移 → 骨缩放 → neutral 双臂微张 → pose 旋转；REF poseApplication 语义 1:1）
  - `export function alignToGround(scene: THREE.Object3D): void`（bounds 迭代 ≤5 次，REF 同）

- [ ] **Step 1: 复制资产（含 license）**

Run（在 previs-ue4 worktree）：
```bash
mkdir -p public/models
cp "/Users/zephyr/.claude/jobs/19e19313/tmp/storyai-ref/public/models/ue-mannequin-retopology.glb" public/models/
cp "/Users/zephyr/.claude/jobs/19e19313/tmp/storyai-ref/public/models/ue-mannequin-retopology.license.txt" public/models/
ls -la public/models/
```
Expected: 两个文件存在（GLB ~750k）。

- [ ] **Step 2: 通读 REF 源文件并移植**

Read（先完整读，理解后逐函数搬运）：
- `REF/src/editor/runtime/ue4Mannequin/ue4MannequinRig.ts`（337 行：getUE4PoseBoneRotations / getUE4BodyBoneScales / getUE4ModelScale / getUE4LabelAnchorY / 内部常量与中性姿态）
- `REF/src/editor/runtime/ue4Mannequin/ue4MannequinPoseApplication.ts`（91 行：capture/apply）
移植为 `src/lib/engine/previs-ue4-rig.ts`，遵守：
- 函数/常量数值 **1:1**（角度、轴向符号、bone 名、英寸→单位换算系数均与 REF 逐字一致）
- 依赖仅 three（`THREE`）——REF 的 R3F/骨架遍历写法改为纯 three 等价调用；不改语义
- 注释保留中文说明 + 标注「移植自 REF <文件>:<行>」

- [ ] **Step 3: 移植/编写单元测试**

先读 REF 测试（`ue4MannequinRig.test.ts`、`ue4MannequinPoseApplication.test.ts`）判断可移植性：凡不依赖 DOM/GLB 加载的纯断言直接移植；依赖 GLB 的用例，改用 `fs.readFileSync(public/models/…glb)` + `GLTFLoader.parse`（vitest node 环境可行则用，不可行则改为 shape/键位断言：如 `getUE4PoseBoneRotations({ "leftElbow.bend": 45 })` 返回含预期 bone 键、`getUE4BodyBoneScales("chibi")` 头骨缩放 ≈4）。最少覆盖：
- 映射表键位完整性（controls 典型键 → 存在对应 bone）
- 体型缩放表（chibi 头 ×4 量级、teen/child/chibi 整模 scale）
- applyUE4Rig 在最小骨骼场景（手工构造 3 bone 骨架）不抛错且 bone rotation 变化符合符号
- alignToGround 对抬升对象收敛至 y≈0

- [ ] **Step 4: 门禁与提交**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`（0 错误）→ `pnpm test`（全绿）→ `pnpm build`（13/13；public 资产随构建复制到 out/ 可核验 `ls out/models/`）
```bash
git add public/models src/lib/engine/previs-ue4-rig.ts src/lib/engine/previs-ue4-rig.test.ts
git commit -m "feat(previs-ue4): port UE4 skeletal rig tables and pose application (1:1 from reference)"
```

---

### Task 2: 词表/预设/体型换装 + controls 类型 v3（引擎层）

**Files:**
- Rewrite: `src/lib/engine/previs-poses.ts`
- Modify: `src/lib/types.ts`（BlockingItem.controls 类型 + bodyType 注释）
- Fix: `src/components/projects/previs-3d-viewport.tsx`（JointName import 失效处）、`src/components/projects/previs-blocking-editor.tsx`（poses 导入项失效处——本任务只做「编译通过的最小替换」，滑杆组 UI 属 Task 6）
- Test: `src/lib/engine/previs-poses.test.ts`（新建）

**Interfaces:**
- Consumes: REF `presets/skeletonMappings.ts`（词表）、`presets/mannequinPosePresets.ts`（20 预设）、`runtime/mannequin/bodyTypes.ts`（UE4 语义标注；id/名称）
- Produces:
  - `export type PoseKey = string`（词表键集合由数据定义）
  - `export const POSE_VOCAB: readonly string[]`（词表全键，REF skeletonMappings 派生）
  - `export const POSE_PRESETS: { id: string; name: string; controls: Record<string, number> }[]`（20 预设逐字）
  - `export const POSE_PRESET_BY_ID: Record<string, …>`
  - `export const BODY_TYPES: { id: Ue4BodyType; name: string; height: number }[]`（8 款：男性素体/女性素体/宽厚素体/健壮素体/纤细素体/少年素体/儿童素体/二头身；height 为展示/程序化参考，骨缩放以 Task 1 表为准）
  - `export const BODY_TYPE_BY_ID`
  - `export interface PoseSliderDef { key: PoseKey; label: string; min: number; max: number }`
  - `export const POSE_GROUPS: { id: string; label: string; sliders: PoseSliderDef[] }[]`（11 组：身体含 offsetY/躯干/头部/左肩/右肩/左肘/右肘/左髋/右髋/左膝/右膝；范围按 REF mannequinPose 限位）
- 删除旧导出：`JointName`/`JointRot`/`PoseControls`/`JOINT_LIMITS`/`JOINT_LABELS`（消费方本任务内修编译，语义 UI 在 Task 6）

- [ ] **Step 1: 通读 REF 词表/预设/限位并重写 previs-poses.ts**

Read: `REF/src/editor/presets/skeletonMappings.ts`（27 行）、`REF/src/editor/presets/mannequinPosePresets.ts`（339 行）、`REF/src/editor/schema/poseSchema.ts`（24 行）、`REF/src/editor/runtime/mannequin/mannequinPose.ts`（44 行，限位/映射）
按 Interfaces 输出重写 `previs-poses.ts`：预设 controls 逐字搬运（含 body.offsetY 负数下蹲值）；slider 范围照 mannequinPose/面板常量；`types.ts` controls 改 `Record<string, number>`。
修复 viewport/blocking-editor 的失效导入——viewport 中旧 `controls[joint]` 三元组取角度的逻辑在 Task 4/5 整体改掉，本任务先用最小改动（类型适配占位）保持编译；如发现旧拼装函数直接消费 JointName 而无法最小适配，允许将 buildMannequin 调用点临时降级为「站姿常量」并在报告说明（Task 4 重写）。

- [ ] **Step 2: 写测试并跑绿**

`previs-poses.test.ts`：
- 预设完整性：恰 20 款；每款 controls 键 ⊆ POSE_VOCAB；无 NaN；`offsetY` 型键在身体组内
- 组定义：11 组标签齐全；身体组含 `body.offsetY`；肩/髋组含 pitch/spread/twist，肘/膝含 bend
- 映射查找：POSE_PRESET_BY_ID 覆盖 20 款全部 id
Run: `pnpm exec vitest run src/lib/engine/previs-poses.test.ts` → PASS

- [ ] **Step 3: 门禁与提交**

Run: `pnpm exec tsc --noEmit`（0）→ `pnpm test`（全绿；旧 poses 引用测试若断言 6 关节需同步改——按新词表语义）→ `pnpm build`
```bash
git add src/lib/engine/previs-poses.ts src/lib/engine/previs-poses.test.ts src/lib/types.ts
git commit -m "feat(previs-ue4): adopt storyai pose vocabulary, 20 presets, 8 body ids (controls v3 shape)"
```

---

### Task 3: 数据迁移 v2→v3

**Files:**
- Modify: `src/lib/engine/reducer.ts`（DATA_VERSION=3 + migrate 扩展）
- Modify: `src/lib/engine/seed.ts`（版本随 createInitialState 路径——沿用 DATA_VERSION）
- Modify: `src/lib/engine/previs-poses.ts`（新增 BODY_TYPE_MIGRATION_V2 / POSE_ID_MIGRATION_V2 常量导出）
- Modify: `src/lib/engine/previs-types.ts`（makePrevisShot blocking 默认 bodyType 若引用旧 id 则同步）
- Test: `src/lib/engine/reducer.test.ts`

**Interfaces:**
- Consumes: `BODY_TYPES`/`POSE_PRESET_BY_ID`（Task 2）
- Produces: 迁移表常量（供迁移与测试共用）：
  - `export const BODY_TYPE_MIGRATION_V2: Record<string, Ue4BodyType>`（spec §3.2 全表）
  - `export const POSE_ID_MIGRATION_V2: Record<string, string>`（spec §3.3 全表）
  - `export const DATA_VERSION = 3`（reducer.ts）

- [ ] **Step 1: 实现迁移**

`reducer.ts`：`DATA_VERSION` 2→3；`migrateAppState` 在 v2 逻辑后追加 v3 段（仅当 `version < 3`）：
- 对每 previs 产物 shot.blocking 项与 previsUndo 快照：`bodyType` 命中 BODY_TYPE_MIGRATION_V2 则替换，未知保留（宽容）；`poseId` 命中 POSE_ID_MIGRATION_V2 则替换，未知置 "stand"
- `controls`：取目标新预设 controls（`POSE_PRESET_BY_ID[newPoseId].controls`）整体替换 v2 的 `Record<string,[3]>`——含「微调归并」语义（spec §3.4：微调不保留，重派生新预设）；v2 旧预设相等性判定可省（最终态一致）
- 顶部 `version` 置 3
（具体代码按现 v2 迁移结构同构扩展；`BODY_TYPE_MIGRATION_V2`/`POSE_ID_MIGRATION_V2` 常量放 `previs-poses.ts` 导出更合模块职责——放 poses 文件并在 reducer import。）

- [ ] **Step 2: 迁移测试（逐表断言）**

`reducer.test.ts` 新增：
- 体型全表：v2 每旧 id → 期望新 id（含 tall→muscular/elder→mannequin/hero→broad 有损项）
- 姿势代表性映射：kneel→kneel-two、point→reach、squat→crouch、lie/jump/talk/greet/back/side/dance/hold/cheer→stand；未知名→stand
- controls：迁移后 == 新预设 controls（`POSE_PRESET_BY_ID[new].controls`）且形状为单值字典
- undo 快照迁移 + 缓存 SVG 不清空（沿用 v2 测试模式）
- 既有 fixture：reducer.test/previs-types.test 中若含旧 bodyType/poseId/controls 三元组数据同步 v3

Run: `pnpm exec vitest run src/lib/engine/reducer.test.ts` → 全绿 → `pnpm test && pnpm build`

- [ ] **Step 3: 提交**

```bash
git add src/lib/engine/reducer.ts src/lib/engine/previs-poses.ts src/lib/engine/previs-types.ts
git commit -m "feat(previs-ue4): v2->v3 migration — body/pose id remap, controls re-derivation from presets"
```

---

### Task 4: UE4 模型运行时 + 程序化回退适配词表

**Files:**
- Create: `src/components/projects/previs-ue4-model.ts`（或同目录 `previs-ue4-model.tsx`——无 JSX 则 .ts）
- Modify: `src/components/projects/previs-3d-viewport.tsx`（buildMannequin 改为「UE4 或程序化」双路径选择 + 程序化按新词表重驱动）

**Interfaces:**
- Consumes: Task 1 rig、Task 2 词表/预设、现有 `BODY_TYPE_BY_ID`（height 参考）、PALETTE/resolveItemColor
- Produces:
  - `let ue4Ready: Promise<THREE.Scene> | null` + `export function ensureUe4Model(): Promise<THREE.Scene>`（GLTFLoader 加载 public 资产一次；失败 reject）
  - `export function createCharacterModel(item: BlockingItem): { object: THREE.Object3D; dispose: () => void }`（尝试 UE4：`SkeletonUtils.clone` → 材质克隆+染色（logo 豁免按 REF 材质判定）→ `captureUE4RestPose`+`applyUE4Rig` → `alignToGround` → 组定位 position/rotation/scale（v2 语义：脚底 y=item.position[1]）；UE4 失败 → 程序化 builder 同词表驱动）
  - 程序化人偶肢体重构：加肘/膝/髋/肩分离段，使词表 shoulder/elbow/hip/knee/hand/foot 键可驱动（移植 REF `runtime/mannequin/mannequinPose.ts` 的映射方向；几何保留我方精细人偶外观）

- [ ] **Step 1: 读 REF 模型层**

Read: `REF/src/editor/runtime/UE4MannequinModel.tsx`（156 行：加载/克隆/染色/中性姿态/标签锚点上报）、`REF/src/editor/runtime/CharacterModel.tsx`（51 行：回退语义）、`REF/src/editor/runtime/mannequin/mannequinPose.ts`（44 行：词表→程序化组旋转映射）

- [ ] **Step 2: 实现 model 模块与视口接入**

按 Interfaces 实现 `previs-ue4-model.ts`（染色材质判定：material name/属性豁免胸 logo，照 REF 41-53；克隆用 `three/addons/utils/SkeletonUtils.js`）。
viewport `buildMesh` 的 character 分支替换为 `createCharacterModel`；同步 effect 的 rigKey 语义保留（重建条件加 color/pose/controls 同前）；GLB 未就绪/失败期间的渲染：先按程序化渲染，UE4 ready 后（状态驱动）整体重建（或 loading 中继续程序化——实现以「ensureUe4Model 成功后触发一次 items 重建」为佳，报告说明）；dispose 路径释放克隆几何/材质。
程序化 limb 重构目标（词表驱动）：arm = 肩(shoulder 组 pitch/spread/twist) + 肘(elbow.bend) 两段 + hand；leg = 髋(hip pitch/spread/twist) + 膝(knee.bend) 两段 + foot；torso/head 直接对应；body.offsetY 整体下移骨盆。旧 6 关节 controls 不再存在（v3）。

- [ ] **Step 3: 门禁与提交**

Run: `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm build`
（GLB 在 dev/build 均可达：`pnpm build` 后 `ls out/models` 核验）
```bash
git add src/components/projects/previs-ue4-model.ts src/components/projects/previs-3d-viewport.tsx
git commit -m "feat(previs-ue4): UE4 mannequin runtime with procedural fallback on shared vocabulary"
```

---

### Task 5: 视口交互修正——去红框高亮 + rig 拖动

**Files:**
- Modify: `src/components/projects/previs-3d-viewport.tsx`
- Create: `src/lib/engine/previs-camera.ts`（纯相机数学）+ `src/lib/engine/previs-camera.test.ts`

**Interfaces:**
- Consumes: 现 shot camera 形状 `{position,target,fov}`
- Produces:
  - `export function reframeCamera(camera: { position:[3]; target:[3] }, pos: [3], forward?: [3]): { position:[3]; target:[3] }`——保持 position→target 距离，forward 缺省沿用当前朝向
  - 视口：`buildBoundsEdges` 高亮用途移除（`hlGroup` 相关 effect/渲染排除可删，保留函数供 captureMaps 边缘导出）；选中视觉仅 gizmo
  - rig 选中 → gizmo attach rig 组；`objectChange` 帧 → 更新 rig 位姿（本地视觉）→ commit 时经 `onTransformRig(camera)` 新回调（editor 接线 Task 6；本任务先经 props 新增 `onMoveRig?: (index: number, camera: PrevisShot["camera"], commit: boolean) => void` 暴露，editor 未传时只视觉随动）

- [ ] **Step 1: 相机数学模块（TDD）**

`previs-camera.ts` + 测试：translate 改变 position 时 target 同位移（距离保持）；rotate（改 forward）时 target 重算于新朝向等距；原朝向缺省路径。Run: `pnpm exec vitest run src/lib/engine/previs-camera.test.ts`

- [ ] **Step 2: 去红框高亮**

viewport：删除选中高亮 effect（hlGroup 添加/清除/重建）与 `buildBoundsEdges` 的选中用途；确认 captureMaps 边缘导出路径仍用 `buildBoundsEdges(mesh)` 独立渲染 edgeScene 不受影响；gizmo attach/detach 保留。

- [ ] **Step 3: rig 拖动**

- rig 组加 `userData.itemId="__camera__"` 与 shotIndex（已有）；选中 rig（点击 rig 或 editor 传入 selectedShotId——editor 接线 Task 6，先按现有 onSelectShot 语义联动选中 id 特殊值 `__cam_{i}`）
- gizmo attach 目标：普通 item mesh 或 rig 组；rig 拖动模式限制 translate/rotate
- `objectChange`：rig → 视觉同步 + `reframeCamera` 语义（rotate 时 target 沿新 forward 等距）；commit（拖动结束）→ `onMoveRig(shotIndex, {position,target,fov}, true)`（fov 不变）
- 帧派发沿用 commit:false 体系（editor 侧 Task 6 落 reducer）

- [ ] **Step 4: rig 造型逐线校准（对照 REF）**

Read REF `SceneRoot.tsx` 相机 rig 视觉生成段（`createBoxWireframeLines`/`createInvertedTetrahedronLensWireframeLines`/`createCircleWireframeLine`/`getViewportCameraBodyWireframeLines` ~175-318；`getViewportCameraFrustumLines` ~610-631；`ViewportCameraRig` ~845-861）。逐项对照现有 `buildCameraRig` 数值并校准：盒体 12 线尺寸 0.4×0.4×1×0.35、镜头倒锥收敛点、后部双圆盘半径/间距、视锥远帧宽 3.2×0.35 @ depth 1.82、线色 #A9D8FF 透明度 0.92、命中盒 padding。偏差以 REF 数值为准修正（报告中列出 diff 项）。

- [ ] **Step 5: 门禁与提交**

Run: `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm build`
```bash
git add src/lib/engine/previs-camera.ts src/lib/engine/previs-camera.test.ts src/components/projects/previs-3d-viewport.tsx
git commit -m "feat(previs-ue4): gizmo-only selection, draggable camera rigs with view-distance follow"
```

---

### Task 6: 编辑器接线与 UI 收口

**Files:**
- Modify: `src/components/projects/previs-blocking-editor.tsx`

- [ ] **Step 1: 接线新契约**

- 传入 `onMoveRig` → reducer `UPDATE_PREVIS_CAMERA`（commit 语义沿用：帧 commit:false / 松手 commit:true）
- 选中态：rig 选中显示在左列表（机位行高亮）与右栏机位面板（沿用 shotIndex 选择语义）

- [ ] **Step 2: 姿势面板滑杆组重构**

右栏角色姿势面板：身体类型 Select 项改用新 8 款名称；姿势预设 Select 用 20 新预设；滑杆区按 `POSE_GROUPS` 渲染 11 组折叠（每组其 sliders：单值滑杆 + °读数，值域按 def；`body.offsetY` 滑杆特殊显示单位）；写回 `controls` 单值键（reducer UPDATE_PREVIS_BLOCKING 整体 blocking 替换语义不变）
- [ ] **Step 3: 命名/钳制/缩放守卫**

- rig 标签「机位NN」补零（viewport 标签文本生成处由机位{index+1} → 机位{String(index+1).padStart(2,"0")}）
- 移除 X/Z commit 钳制（handleTransform 与左栏字段、inline 2D 拖拽的 clamp 调用）
- 工具条缩放：选中 rig 时点击「缩放」toast「机位不支持缩放」且模式不切
- [ ] **Step 4: 门禁与提交**

Run: `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm build`
```bash
git add src/components/projects/previs-blocking-editor.tsx src/components/projects/previs-3d-viewport.tsx
git commit -m "feat(previs-ue4): editor wiring — 11-group pose sliders, rig drag commit, naming, clamp removal"
```

---

### Task 7: 回归 + 验收状态 + A/B 环境

**Files:**
- Modify: `docs/superpowers/specs/2026-09-03-previs-ue4-parity-design.md`（§6 状态）

- [ ] **Step 1: 全量回归**

Run: `pnpm test`（35 基线 + 新用例全绿）→ `pnpm build`（13/13）→ `pnpm exec tsc --noEmit`；`grep -rn "rotationY\|[xyz], \[?0, 0, 0\]?\]" 敏感面` 无 v2 残留（仅迁移字面量）
- [ ] **Step 2: 参考 A/B 环境（人工）**

```bash
cd /Users/zephyr/.claude/jobs/19e19313/tmp/storyai-ref && npm install && npm run dev  # :5173
```
把地址与对照点写入 spec §6 状态段（此步若安装失败记录即可，不阻塞）
- [ ] **Step 3: spec §6 验收清单勾选代码层项，人工项标 PENDING 并提交**

```bash
git add docs/superpowers/specs/2026-09-03-previs-ue4-parity-design.md
git commit -m "docs(previs-ue4): acceptance status — code gates green, browser A/B pending"
```
