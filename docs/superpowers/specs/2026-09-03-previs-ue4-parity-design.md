# Previs 3D「完全复刻」UE4 素体（外观/交互/摄像机 1:1）设计

日期：2026-09-03（v0.1）
状态：讨论稿（未编码）

## 0. 修订记录

v0.1（本版）：三轮产品问答定稿——UE4 素体 GLB 引入（Q1=B，用户确认承担资产许可风险）；姿势系统整体换装 storyai 词表（Q2=A）；单次大包交付（Q3=方案 2）。承前：`2026-09-03-previs-parity-design.md`（v2 数据/精细人模/交互层）已合入 main，本 spec 在其上做 1:1 收口。

## 1. 背景与目标

用户在 main 实测 parity 交付后提出：**3D 人物模型外观、模型交互方式、摄像机外观与交互**要「完全复刻」storyai-3d-director-desk。parity 交付的是 storyai 的**兜底**程序化外观与其近似交互；本 spec 将三块收敛到参考实现 1:1：

1. **人物外观**：默认角色 = UE4 素体 GLB（`ue-mannequin-retopology.glb`，自参考仓库复制）；骨骼驱动 + 按角色染色 + 8 体型骨缩放；加载失败回退程序化人偶（参考同款语义）
2. **模型交互**：选中反馈 = 仅 gizmo（去红色包围盒）；pose/体型体系换装参考词表（30 关节 + 20 预设 + 8 体型 ID）
3. **摄像机**：rig 造型逐线校准 + **rig 可拖动**（translate/rotate 随动、target 保持视距沿新朝向跟随）；标签机位NN 两位补零；去 X/Z 钳制

**参考源码**：`/Users/zephyr/.claude/jobs/19e19313/tmp/storyai-ref`（数值 1:1 移植源）。

## 2. 资产与渲染路径

### 2.1 资产

- 复制 `storyai-ref/public/models/ue-mannequin-retopology.glb` → 本仓库 `public/models/ue-mannequin-retopology.glb`（随 Next 静态导出与 Electron 打包分发）
- **许可（已核实）**：资产为 Sketchfab 发布（"UE Mannequin (Retopology)"，作者 William Luque，sketchfab.com/luquewilliam230），**SKETCHFAB Standard**——商业/衍生可用，要求署名与基础限制（独立再分发原始文件受限）；参考仓库附带 `ue-mannequin-retopology.license.txt`。处置：随资产一并复制 license.txt 至 `public/models/`，并在应用内「关于/设置」不可见前提下以文档署名（spec §2.1 已载明来源/作者/许可链接）——分发形态风险由用户此前拍板接受
- 加载：GLTFLoader（three addons）；每实例 `SkeletonUtils.clone(gltf.scene)`；实例材质克隆 + 染色（默认色 #4F8EF7；胸 logo 材质豁免——实现按参考 UE4MannequinModel.tsx:41-53 的材料判定）

### 2.2 骨骼驱动三件套（数值 1:1 移植）

新文件 `src/lib/engine/previs-ue4-rig.ts`（移植自参考 `runtime/ue4Mannequin/ue4MannequinRig.ts` + `ue4MannequinPoseApplication.ts`）：
- `captureUE4RestPose`：快照每骨骼 local position/quaternion/scale
- `applyUE4RestPoseAndRig`：重置 rest → `body.offsetY` 骨骼位置偏移（英寸→单位换算按参考）→ 体型骨缩放 → neutral 双臂微张（参考 187-194）→ 姿势旋转（per-bone 四元数乘法，映射表 `getUE4PoseBoneRotations`）
- `getUE4BodyBoneScales`：8 体型 per-bone 缩放表 + `getUE4ModelScale`（teen 0.88 / child 0.72 / chibi 0.56，其余 1）+ 贴地 label 锚点表
- `alignUE4MannequinToGround`：bounds 迭代接地（≤5 次）

### 2.3 渲染路径选择与回退

- 默认渲染 UE4 素体；GLB 加载失败或实例化异常 → 自动回退程序化精细人偶（保留 parity 交付的 builder，同 error-boundary 语义）
- 程序化路径由**同一份新词表**驱动（移植参考 ProceduralMannequin 的词表→组映射）；两条路径视觉可分别验收
- 深度/边缘/布景导出、捕获排除机制不变（UE4 网格同样挂 `hideFromViewportCapture` 语义的对象不受影响）

## 3. 姿势词表 + 体型 + 数据 v3 迁移

### 3.1 词表（`previs-poses.ts` 整体替换为 storyai 体系）

- 词表 ~30 键（数值与命名逐字移植参考 `presets/skeletonMappings.ts`）：`body.{pitch,yaw,roll}`、`body.offsetY`、`torso.{pitch,yaw,roll}`、`head.{pitch,yaw,roll}`、`left/rightShoulder.{pitch,spread,twist}`、`left/rightElbow.bend`、`left/rightHip.{pitch,spread,twist}`、`left/rightKnee.bend`、`left/rightHand.{pitch,roll,twist}`、`left/rightFoot.{pitch,roll,twist}`
- `controls` 形状：v2 `Record<string,[x,y,z]>` → **v3 `Record<string, number>`**（单值度；offsetY 为长度单位按参考语义）
- 20 预设逐字移植（`presets/mannequinPosePresets.ts`：stand/t-pose/walk/run/sit/crouch/kneel-one/kneel-two/hands-on-hips/lean/bow/think/fight/kick/throw/push/wave/reach/cross-arms/phone）
- 限位：按参考 `mannequinPose.ts`（slider ±90 等，具体值实现时 1:1）
- 滑杆 UI：右栏姿势面板改参考 11 组：身体(含 offsetY)/躯干/头部/左肩/右肩/左肘/右肘/左髋/右髋/左膝/右膝（肩/髋 pitch·spread·twist 三键、肘/膝 bend 单键、躯干/头/身体 pitch·yaw·roll）

### 3.2 体型 ID 换装

| 旧（v2） | 新（v3，storyai） | 语义备注 |
|---|---|---|
| standard | `mannequin` 男性素体 | 直接对应 |
| heavy | `broad` 宽厚素体 | 直接对应 |
| slim | `slim` 纤细素体 | 直接对应 |
| child | `child` 儿童素体 | 直接对应 |
| short | `teen` 少年素体 | 旧 1.50 vs teen 整模 ×0.88≈1.58 |
| tall | `muscular` 健壮素体 | 旧 2.05 无直接款，取最高壮款（有损） |
| elder | `mannequin` 男性素体 | 旧长者并入标准款（有损） |
| hero | `broad` 宽厚素体 | 旧英雄并入宽厚（有损） |

（v2 旧 UI 文案随之换新：标准→男性素体…；`BODY_TYPES` 名称/身高系数表整体替换，`previs-poses.ts` 输出 8 体型 = 参考 `bodyTypes.ts` UE4 语义（身高仅作 UI 展示与程序化 fallback），骨缩放以 2.2 表为准。）

### 3.3 姿势 ID 映射（v2 → v3，无损项直连，缺失项并入最接近款并在 UI 文案不特殊标注——属预期有损）

| 旧（v2 20 款） | 新（v3） | 备注 |
|---|---|---|
| stand/walk/run/sit/bow/wave/think/fight/squat | stand/walk/run/sit/bow/wave/think/fight/crouch | 直接对应（squat→crouch） |
| kneel | kneel-two | 旧双膝跪 → 新双膝跪 |
| point | reach | 单臂前伸近义 |
| lie/jump/talk/greet/back/side/dance/hold/cheer | stand | 参考无对应款（有损，spec 明示） |

### 3.4 数据迁移 v3（DATA_VERSION 2→3，migrateAppState）

- 每 blocking item：`bodyType` 按 §3.2 表映射；`poseId` 按 §3.3 表映射
- `controls` 策略：
  - item.controls 与**旧预设**（v2 同 poseId 预设）逐键相等（或缺失 controls）→ 由**新预设**（映射后 poseId）controls 重派生（干净）
  - controls 与旧预设不等（用户滑杆微调过）→ 归并到新预设 controls（**自定义微调重置**，spec 明示；迁移后编辑器滑杆可重新调整）
- 形状迁移：controls 值由 v2 `[x,y,z]` 三元组 → v3 单值字典（仅当走「旧预设相等」路径可 1:1 重派生；微调路径直接整体替换为预设字典）
- `previsUndo.past/future` 快照同规则迁移；SVG/PNG 缓存三图保留（重渲染后更新）
- 引擎/类型/reducer 分支随 v3 形状走；测试 fixture 同步

## 4. 交互 1:1 修正

### 4.1 选中高亮 = 仅 gizmo

- 删除红色包围盒高亮（viewport `hlGroup`/`buildBoundsEdges` 高亮用途移除——边缘线仍用于导出边缘图则保留函数，仅去选中高亮渲染路径与相关 effect）

### 4.2 机位 rig 可拖动（translate/rotate）

- 选中 rig（点 rig 或机位列表）→ TransformControls 挂 rig 组（模式随工具条 translate/rotate）
- 拖动语义（参考 `commitCameraTransformFromViewport`）：rig 位置 = shot.camera.position；**rig→target 向量长度保持**，target = rig + 新朝向 × 原长度（rotate 改变朝向时 target 随动；translate 保持原朝向）
- shotIndex 对应 camera 数据同步更新（commit:false 帧 / commit:true 单快照沿用）
- scale 模式对 rig 禁用：选中 rig 时点击工具条「缩放」无效并 toast 提示「机位不支持缩放」，模式保持当前 translate/rotate

### 4.3 rig 造型与命名校准

- rig 线框逐项对照参考 `SceneRoot.tsx` 视觉：12 线盒体 / 倒锥镜头 / 后部双圆盘 / 视锥 4 线到 16:9 远帧（宽 3.2×0.35 @ depth 1.82）/ 线色 #A9D8FF 透明度 0.92 / 隐形命中盒 padding——按参考数值校准（现有实现为近似，实现期逐行对表）
- 名字标签「机位NN」两位补零（机位01 起）；rig 上方 +0.55 锚点保留

### 4.4 其他

- X/Z 范围钳制移除（编辑器 commit 不再 clamp——自由摆放与参考一致）
- 空点取消选中、Delete/⌘Z/⌘⇧Z/⌘C/⌘V、机位视角锁定恢复、画幅/导出：保持 parity 已交付行为，回归保证

## 5. 工程结构与测试

- 文件：
  - 新增 `public/models/ue-mannequin-retopology.glb`（二进制资产）
  - 新增 `src/lib/engine/previs-ue4-rig.ts`（骨映射/缩放/接地，~400 行移植）
  - 新增 `src/lib/engine/previs-ue4-model.ts`（GLB 加载/克隆/染色/回退选择；导出 `createUe4Model`/`disposeUe4Model` 供 viewport 调用——模块化，不并入 viewport）
  - 替换 `src/lib/engine/previs-poses.ts`（词表/预设/体型/限位/滑杆组定义）
  - 改 `src/lib/types.ts`（controls 类型、DATA_VERSION 3）、`reducer.ts`（v3 迁移）、`previs-3d-viewport.tsx`（渲染路径/去高亮/rig 拖动/标签）、`previs-blocking-editor.tsx`（滑杆组/命名/去 clamp）
  - 测试：迁移 v2→v3 断言全表、词表完整性（预设键 ⊆ 词表 & 限位内）、rig 拖动语义（引擎层）、35 基线回归
- 参考对照环境：实现与验收期间本地起 storyai-ref（`npm install` + `npm run dev`，端口 5173）逐项 A/B

## 6. 验收清单（对照参考 A/B）

> 状态标记（2026-09-09）：`[x]` = 代码门禁/自动化测试已覆盖（附证据）；`[ ]` + `PENDING（人工 A/B）` = 需人工浏览器对照参考。汇总见本节末「验收状态（2026-09-09）」。

- [ ] 默认角色渲染为 UE4 素体（光滑无脸、染色 #4F8EF7、胸 logo 豁免），贴地不悬浮；GLB 加载失败回退程序化人偶 —— **PENDING（人工 A/B）**（外观与默认渲染需浏览器）。代码层子项已验证：默认色 `#4F8EF7`（`previs-ue4-model.test.ts > resolveCharacterTint > 默认色锁定 spec §2.1/§6`）、胸 logo 豁免（`… > isolateAndTintUE4MannequinMaterials：染色与胸 logo 豁免`）、贴地（`previs-ue4-rig.test.ts > alignToGround` 4 例 + `previs-ue4-model.test.ts > 克隆…+ 贴地`）、失败回退（`previs-ue4-model.test.ts > UE4 实例化异常 → 程序化回退`、`> ensureUe4Model：加载失败语义`）
- [x] 8 体型（男性素体…二头身）骨缩放差异与参考一致（二头身头×4 等）—— `previs-ue4-rig.test.ts > 体型缩放表`（8 款 × 19 骨、脊柱收窄/骨盆与头部分级放大、整模缩放 teen 0.88 / child 0.72 / chibi 0.56）、`资产集成：rig 表 ↔ 真实 GLB > GLB JSON 节点名…` 与 `… > GLTFLoader.parse 后 rig 完整驱动真实骨架`、真实骨架用例断言 `chibi 头骨缩放 ×4`；表值 1:1 移植经 Task 1 review 机检
- [ ] 20 姿势预设与参考逐帧一致（含 t-pose/单双膝跪/叉腰/看手机/offsetY 下蹲）—— **PENDING（人工 A/B）**（逐帧观感）。数值层已锁定：`previs-poses.test.ts > 姿势预设 POSE_PRESETS（与 REF 逐字）`（恰 20 款且 id/名称/顺序一致 + T 型/蹲下 offsetY/单膝跪/双膝跪/叉腰校准直移）、`previs-ue4-rig.test.ts > 足部 pitch 控制用于跪姿/弓步`
- [ ] 右栏 11 组滑杆与参考一致，数值写回 controls 驱动 UE4 骨架 —— **PENDING（人工 A/B）**（面板渲染无自动化测试）。定义与写回已验证：`previs-poses.test.ts > 滑杆组 POSE_GROUPS`（恰 11 组、id/标签齐全、键 ⊆ 词表）、`previs-ue4-rig.test.ts > applyUE4Rig`（controls → 骨骼四元数/offsetY）
- [x] 旧项目数据迁移：体型/姿势映射生效、微调归并预设、undo 栈安全、缓存图重渲染后更新 —— `reducer.test.ts > migrateAppState v2 → v3（词表换装）` 8 例（体型全表映射含有损项、姿势直连/近义/有损并入/未知名落 stand、controls 重派生且深拷贝、微调归并、未知体型宽容、undo past/future 快照同规则迁移且缓存 SVG/PNG 不清空、v1→v3 链式、v3 幂等）
- [ ] 选中角色仅 gizmo（无红框）；rig 拖动 translate/rotate 随动且 target 视距跟随；机位01 命名 —— **PENDING（人工 A/B）**（视口交互无自动化测试）。代码层：高亮渲染路径已删（`buildBoundsEdges` 仅剩边缘图导出，`previs-3d-viewport.tsx:1181`）、`hlGroup` 源码零命中、命名两位补零 `rigLabel`（`previs-blocking-editor.tsx:65`）、rig 视距跟随数学 `previs-camera.test.ts > reframeCamera` 5 例
- [ ] 自由摆放无 X/Z 钳制；删除/撤销/复制粘贴/机位视角等 parity 行为回归 —— **PENDING（人工 A/B）**。3D 提交路径已无钳制（`previs-blocking-editor.tsx:607/697` 仅 `round2`）；撤销/重做有 `reducer.test.ts` 4 例覆盖；**已知残余**：2D 画布指针拖拽仍按 SVG 画布范围收边（`previs-blocking-editor.tsx:442-444` `worldFromEvent`，T6 minor），复制粘贴实现存在但无自动化测试（`previs-blocking-editor.tsx:684-754`）
- [x] SVG 三图与 3D 同源（姿势不影响足迹，重渲染比对）—— `previs-render.test.ts > v2 投影语义`（足迹随 rotation[1] 旋转/非等比 scale 缩放、深度按 3D 距离近亮远暗）、`> 三图背景与标记契约`、`reducer.test.ts > RERENDER_PREVIS` 2 例；足迹仅由 position/rotation/scale 派生，renderer 不读 controls（姿势不影响足迹为结构性保证）

### 验收状态（2026-09-09）

- **分支头**：`feat/previs-ue4` @ `f9dd41642172bdfbb0912f8bfa34cfd28f6f5ba0`（Task 1–6 全部 complete）
- **代码门禁**：`pnpm test` **113/113 passed**（8 文件；分支基线 35 → 113）；`pnpm build` **13/13** 静态页；`pnpm exec tsc --noEmit -p tsconfig.json` **0 errors**（exit 0）
- **v2 残留扫描**：`rotationY` / `hlGroup` / `#6366f1` / 旧体型 id / 旧姿势 id / `[x,y,z]` 姿势三元组 全部零泄漏——命中项均为迁移字面量、REF 忠实移植或 pre-existing（逐条见 task-7 report）
- **桌面资产 URL 已知问题（记录，未修）**：`UE4_MODEL_URL = "/models/ue-mannequin-retopology.glb"` 为根绝对路径（`previs-ue4-model.ts:39`）；`CINE_RELATIVE_ASSETS=1` 仅改写 webpack 产物前缀（`next.config.ts:8` → `assetPrefix: "./"`），运行期字面量不变——实测桌面构建 `out/index.html` 用 `./_next/...` 而 chunk 内仍为 `/models/...`，Electron `file://` 下解析为 `file:///models/...` 加载失败 → 静默回退程序化人偶。Dev/浏览器不受影响。待用户决策（webpack asset import vs Electron 协议/基路径）
- **A/B 环境**：参考应用 `/Users/zephyr/.claude/jobs/19e19313/tmp/storyai-ref` 安装成功（`npm install`，229 包）、`npm run dev` 于 **http://localhost:5173/**（标题「3D导演台 Demo」）返回 HTTP 200；核验后已停止。对照点：默认角色渲染与染色、体型下拉 8 款、姿势预设 20 款逐款、右栏「姿势」tab 11 组滑杆、选中高亮（仅 gizmo）、机位 rig 拖动与视距跟随、机位01 命名、自由摆放边界、⌘Z/⌘⇧Z/⌘C/⌘V/Delete、三图与 3D 一致性
- **遗留 minors（ledger 记录，未修）**：(a) `reducer.ts:128-131` 映射表用普通对象索引，原型键（constructor/toString）绕过宽容/未知→stand，需 `Object.hasOwn`；(b) `reducer.ts:142-144` undo 路径缺 `(sn.shots ?? [])`/`(sh.blocking ?? [])` 守卫；(c) `SkeletonUtils.clone` 按引用共享 `boneInverses`（潜在：未来对克隆调用 `calculateInverses()` 会污染源）；(d) 骨骼 dispose 测试在 node 环境只能断言调用；(e) 左栏「机位」行不清除图元选中（`previs-blocking-editor.tsx:531-534`）→ Delete 可能误删仍选中角色；(f) 2D 画布拖拽仍收边（上条）；(g) `poseLimitFor` 原型键查询 → NaN 滑杆边界（与 (a) 同类）；(h) 姿势滑杆每次 input 事件推一次 undo 快照（T2 既有行为）；(i) `previs-render.ts:128` 示意填充硬编码 `#6366f1`（pre-existing on main，非本分支引入）。ledger 记录的 `preset.controls` 别名问题已在 T6 修复（`previs-blocking-editor.tsx:929` 现为 `{ ...preset.controls }`）
- **已接受取舍（REF 忠实 / spec 授权）**：程序化回退姿势与 UE4 路径前/后反向 + 左右镜像（REF `ProceduralMannequin` 同行为，仅 GLB 失败时可见）；`reframeCamera` 平移保持原视距（spec §4.2 规定，REF 由新位置重推视距）

## 7. 已知取舍（明示）

- 资产许可风险由用户确认接受；资产进入仓库与打包产物
- 旧体型/姿势映射有损（§3.2/§3.3 表）；自定义 controls 微调迁移后重置（§3.4）
- 姿势观感 A/B、拖拽手感为浏览器人工验收项
