# Previs 3D 复刻对齐（storyai-3d-director-desk）设计

日期：2026-09-03（v0.1）
状态：讨论稿（未编码）

## 0. 修订记录

v0.1（本版）：三轮产品问答定稿——全 3D 数据模型（Q1=B）；程序化精细人模复刻 storyai 兜底外观（Q2=A）；深色舞台 + 机位视觉 + 画布内 storyai 交互热点，外壳保持 shadcn 3 栏（Q3=B）；官方 three addons 增量改造路线（Q4=方案 1）。

## 1. 背景与问题

用户在 main（已合入 PR #9 全屏 3D 编辑器）实测发现三类差距，期望对齐 [storyai-3d-director-desk](https://github.com/jiguang132/storyai-3d-director-desk)：

1. **3D 模型无法拖动/旋转/缩放**——根因（代码级核实）：角色不可拾取（`itemId` 只标 Group 根，raycast 打叶子网格后 `.find()` 落空；点角色会穿透选到脚下地形）；旋转/缩放交互完全不存在（无 TransformControls，`rotationY`/`scale` 无任何 UI 入口）；左键手势冲突（轨道旋转 vs 拖拽共用 pointerdown）；全部非地形项被抬 +1 悬浮（脚离地 ≈0.9m）
2. **模型外观差距**——现为单色 indigo 胶囊人（共享 Lambert 材质、无脸、同色）；storyai 默认 UE4 素体 GLB，兜底为程序化胶囊人（8 体型比例、眼鼻嘴、双色+接缝细节、8 色盘轮转染色）
3. **摄像机/画布样式差距**——FOV 从未进 3D（view/capture 恒 45°）；画幅遮罩不改相机 aspect（遮罩≠实画面）；无机位可视化（storyai：线框摄像机 rig+视锥+名字标签，导演/机位视角切换）；浅灰扁平画布 vs storyai 深色舞台（黑场 + #303640 地面 + #2A4065 网格）

**复刻范围**：交互语义、模型外观、舞台与机位视觉、画布内交互热点；**外壳布局不照搬**（保持项目 shadcn 3 栏全屏编辑外壳）。

## 2. 数据模型升级 v1→v2（全 3D 变换）

### 2.1 字段变更（src/lib/types.ts `BlockingItem`）

| 字段 | v1（现值） | v2（新值） |
|---|---|---|
| `position` | `[x,y,z]`，y 恒 0 | `[x,y,z]`，y 真实高度（角色贴地=0） |
| `rotationY` | `number`（度） | 删除，改 `rotation:[x,y,z]`（欧拉，度，绕任意轴） |
| `scale` | `number`（等比） | 改 `scale:[x,y,z]`（非等比，默认 [1,1,1]） |

### 2.2 迁移（migrateAppState v1→v2）

- 状态版本 1→2；遍历全部项目 stage 中 previs 产物每镜 `blocking[]`：`rotationY:r` → `rotation:[0,r,0]`；`scale:s` → `[s,s,s]`；缺省 y=0；旧字段移除
- `previs-types.ts` 工厂、种子默认同步 v2 形状
- 纯数据契约：无新 action；reducer 分支只随类型形状走
- **缓存策略**：迁移仅转换数据，不清空产物中已缓存的三图 SVG/PNG——旧图在下次编辑（自动重渲染）或点「重新渲染」后按 v2 投影刷新；属预期行为，验收时注意先重渲染再比对

## 3. 3D 交互层

### 3.1 拾取修复（bug）

raycast 命中任意叶子网格后**上溯** `userData.itemId` 所属祖先 Group，而非仅查命中对象自身；角色/道具/地形统一可拾取；点击穿透选地形问题消除。

### 3.2 手势仲裁

- 仅 `e.button === 0` 进入拾取（中/右键留给轨道 pan/zoom）
- pointerdown 先记录位置，移动超阈值（≈5px）才判定拖拽；纯点击=选中/取消选中
- 拖拽中 `controls.enabled=false`；`pointerup/pointercancel` + 组件卸载兜底恢复（防 enabled 卡死）
- 命中项若为机位 rig → 切换该机位（见 §5.3）；命中为角色/道具/地形 → 选中并进入拖拽

### 3.3 TransformControls 三模式（three 官方 addons）

- 新引入 `three/addons/controls/TransformControls.js`（与现有 OrbitControls 同通道，无新 npm 依赖）
- 模式：`translate`（轴向箭头 + 面向相机的平面柄，全 3D 含抬升 y）/ `rotate`（弧线轴环，绕任意轴）/ `scale`（轴向 + 中心均匀）
- 选中项挂 gizmo；`dragging-changed`/`objectChange` 期间高频 dispatch `commit:false`（中间帧不入 undo），松手/失焦 `commit:true` 单快照（沿用现 reducer 语义，快照栈不动）
- 接地：角色等生成时脚落 y=0（修 +1 悬浮：`buildMesh` 与同步 effect 两处删除 +1）；模型被拖离地面后，右键面板 y 数值可精确归位；渲染用 item.position.y 直接作为物体 y（道具/角色一致，不再隐式 +1）
- 网格吸附不引入（YAGNI；storyai 默认可选，本项目无场景缩放需求）

### 3.4 快捷键（fullscreen 编辑器内，全局监听）

- Delete/Backspace：删除选中项（焦点在 INPUT/TEXTAREA/SELECT 时跳过）
- ⌘/Ctrl+Z 撤销、⌘/Ctrl+Shift+Z 重做（映射现有 previsUndo/Redo）
- ⌘/Ctrl+C / V：复制/粘贴（沿用现有 clipboard 语义：+1 偏移钳制、唯一 id）

### 3.5 机位视口正确性（fov/aspect 修复）

- 「从机位看」与捕获管线统一应用 shot 的 `fov`（不再恒 45°）
- 画幅比例选择（16:9/9:16/1:1）同时设置实相机 `aspect` + 更新 DOM letterbox → 遮罩=所见（capture 分辨率按该比例不变）

## 4. 程序化精细人模（storyai 兜底外观复刻）

### 4.1 外观（重写 `buildMannequin`）

- 8 体型比例表驱动（`BODY_TYPES` 扩展：肩宽/肢体粗细/头径/身高/锚点差异），角色 vs 女性 vs 儿童等体型差异可见
- 拼装：骨盆球 + 躯干双胶囊 + **深色接缝环（#070A0F）**；头部球 + **眼/鼻/嘴深色细节**；手（带拇指胶囊）、脚（带脚趾帽）；全身 `meshStandardMaterial`（metalness ≈0.04, roughness ≈0.74）
- 每角色**独立材质染色**（不再共享单 Lambert）；新增角色按 8 色盘轮转取未用色（#4F8EF7 / #E0524D / #E91E63 / #F2A900 / #9C4DCC / #12B886 / #00B8D9 / #FF7A45 系），命中已有色则 round-robin
- 姿势词表**不动**（现有 6 关节/20 姿势/滑杆直接驱动新拼装，关节组旋转语义不变）
- 移除角色头顶 cone 朝向箭——朝向在旋转交互下直接可见（模型自身转向），不设替代指示；2D SVG 布景箭头保留（那是渲染层标记，与 3D 模型无关）

### 4.2 渲染环境

- 场景背景黑场（原 #f4f4f5）；地面 200×200 `#303640` 半透明板（opacity 0.4）+ 1m 节线 `#2A4065` 无限网格（细线隐藏，`fadeDistance` 收尾）替代现 16×16 GridHelper + 灰平面
- 灯光：hemisphere + directional（现已有），renderer 开 `shadowMap`，角色/道具 castShadow、地面 receive
- 布景/道具/地形沿用 `ITEM_COLOR` 色相区分（terrain/character/prop），材质随人模统一为 `meshStandardMaterial`，色值不另行调整（深舞台上的观感由灯光与地面配色承载）

## 5. 舞台与机位视觉 + 画布内交互热点

### 5.1 布局不变

全屏编辑器外壳保持现 shadcn 3 栏（左列表/中画布/右面板）；变化集中在画布区与中栏工具行（§5.4）。

### 5.2 机位 rig（导演视角可见）

每 shot 渲染 0.35 缩比**线框摄像机**：#A9D8FF 12 线盒体 + 倒锥镜头 + 后部双圆盘 + **视锥线**（到 16:9 远帧 4 角）+ 隐形加大命中盒；朝向对准 shot.target；rig 位置 = shot 机位（视口相机位置）。导演视角下全部 rig 可见；机位视角下隐藏（所见即所拍）。

### 5.3 视角切换

- 顶部（或画布内）「导演视角 ⇄ 机位视角」切换：机位视角 = 锁定 active shot（position/target/**fov** 全应用）；导演视角 = 恢复轨道相机上次位姿（存 snapshot，切回恢复，含 damping）
- 点击 rig 命中盒 = 仅选中该机位并让右侧面板编辑该机位数据；视角**不**自动跳转（跳转由「机位视角」按钮执行）

### 5.4 画布内交互热点（storyai 式，替换现中栏工具行）

画布底部中央 **glass pill 工具条**（blur 玻璃底、圆角胶囊、圆形图标按钮 + 悬浮文本提示，样式 token 化对齐主题）：

1. 移动/旋转/缩放（TransformControls 模式切换，选中态高亮）
2. 添加角色：弹层选 8 体型 → 新增默认角色（默认站姿、下一盘色、落位空槽）→ 自动选中（gizmo 出现）
3. 添加机位：以当前导演视角生成新 shot？——**否（本期）**：shot 集由引擎产物决定（镜头数量与 previs 阶段绑定）。本按钮改为「**设当前视角为机位**」（覆盖 active shot 的 position/target/fov = 当前导演视角；即复活现 dead code `applyViewCamera` 并给 UI 入口）
4. 画幅比例弹层（16:9/9:16/1:1 小图标 + auto？——维持现三档，无 auto）
5. 截图：当前机位截图 + 环绕拍摄（保留现 8 帧环绕条，移到工具条内弹出/相邻）

其余保留：顶部视角切换、名字标签（§5.5）、方向 gizmo（§5.6）、九宫格遮罩按钮。

### 5.5 角色/机位名字标签

`CSS2DRenderer`（three addons，DOM 层自动不进 canvas 导出）圆角药丸标签浮于角色与机位 rig 上方；随距离缩放（distanceFactor 语义）——实现采用恒定尺寸药丸标签（可读性优先，不随距离缩放；CSS2D 不进导出）；开关沿用右面板或标签内小控件（保底：跟随现有场景内标签开关——若无则加右面板开关）。

### 5.6 方向 gizmo（右上）

画布右上角：±X/±Y/±Z 六个 DOM 命中按钮 + 视觉轴指示（浅红/绿/蓝），点击 = 相机沿该轴**等距**（当前轨道距离）重定位并 lookAt target；机位视角下 gizmo 隐藏。

## 6. 2D 三图渲染适配（全 3D 投影）

- `previs-render.ts`（布景/深度/边缘 SVG）升级为感知 v2 数据：`rotation` 任意轴/`scale` 非等比/`position.y`——足迹=按 rotation[1]（yaw）旋转后的包围盒、深度带按 y 与包围盒、边缘线按旋转后轮廓投影
- SVG 与 3D 同源：任何 v2 数据在两处呈现一致（引擎层纯函数，可单测）
- 导出捕获：TransformControls/gizmo、机位 rig、网格/地面、名字标签一律不进导出图（现 `userData.hideFromViewportCapture` 机制扩展；CSS2D 天然排除）

## 7. 工程结构与测试

- 主要文件：`previs-3d-viewport.tsx`（拾取/手势/gizmo/rig/标签/深色舞台/方向 gizmo/捕获排除）、`previs-blocking-editor.tsx`（pill 工具条/视角切换/设视角为机位/快捷键）、`previs-fullscreen-editor.tsx`（外壳微调）、`types.ts`+`previs-types.ts`+`previs-poses.ts`（数据 v2 + 体型比例扩展）、`reducer.ts`+迁移、`previs-render.ts`（SVG 投影）
- 测试更新/新增：迁移 v1→v2；v2 旋转/高度/非等比缩放的 SVG 足迹/深度/边缘投影；既有 28 测试随数据形状回归全绿
- **验收对照（用户 3 条实测）**：
  1. 角色可拖（地面/抬升）、可绕任意轴旋转、可非等比缩放；地形不再被误拖
  2. 模型带五官/双色/接缝、8 体型比例可见差异、多角色多色
  3. 画布深色舞台观感、机位 rig+视锥可见、导演/机位视角切换、fov/aspect 生效（遮罩=实画面）、pill 工具条与方向 gizmo 可用
- 浏览器交互验收项（人工）：拖拽顺滑度、gizmo 各柄手感、视角切换过渡、导出三图与 3D 一致

## 8. 本期不做（YAGNI）

- UE4 素体 GLB 路径（许可不明，Q2 已否决）
- 群演阵列、几何体/模型库、FBX/OBJ 导入、全景背景、角色标签烘入导出 PNG
- shot 增删（引擎产物绑定）、机位 target-object 跟随模式
- 网格吸附、场景整体缩放/平移
- 外壳玻璃化（Q3 已定边界）

## 9. 实施验收状态（T6 收口，2026-09-03）

代码层全部通过：tsc 0 错误 · `pnpm test` 35/35 · `pnpm build` 13/13 · 残留引用检查干净（`rotationY` 仅存迁移字面量/注释；`viewFromCamera`/`onMoveItem` 零命中）。

**人工浏览器验收（合并后 dev server 实测，逐条勾选）**：

- [ ] 角色可拾取拖动（地面平移/抬升 y）、地形不再误拖
- [ ] 移动/旋转/缩放三模式轴柄生效；松手后轨道恢复不卡死
- [ ] 添加角色：8 体型可选、落位不重叠、自动选中、8 色盘轮转不重色
- [ ] Delete 删除选中；⌘/Ctrl+Z、⇧Z、C、V 生效（输入框聚焦时不触发）
- [ ] 角色外观：五官/双色/接缝可见；8 体型轮廓差异可见；站立贴地不悬浮
- [ ] 深色舞台观感：黑场 + 深灰地面 + 深蓝节线网格 + 阴影
- [ ] 机位 rig：导演视角可见线框摄像机+视锥+名字标签；点击 rig 选中机位不跳视角；机位视角锁定 shot 且 fov 正确
- [ ] 画幅切换：letterbox 与实画面同 aspect（遮罩=所见）；导出三图按所选画幅
- [ ] 方向 gizmo 六向切换生效（机位视角隐藏）
- [ ] 变换字段精确改值生效（回车/失焦）、undo 单步
- [ ] 布景/深度/边缘 SVG 与 3D 数据一致（旋转/缩放/抬升后重新渲染比对）
- [ ] 已知待观感确认：人偶头颅埋入胸腔（颈部观感）、9:16 窄画布下 pill 可能溢出遮罩条
