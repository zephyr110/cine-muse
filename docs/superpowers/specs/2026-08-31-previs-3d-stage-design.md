# 空间预演台（Previs）Sub-Agent 设计

日期：2026-08-31（v0.2 修订版，经产品/技术双总监审查）
状态：讨论稿（未编码）

## 0. 修订记录

v0.2（本版）：产品总监 + 技术总监审查修订——新增成功指标与智能启用规则（P1/P2）、产品命名与职责边界（P3/P4/P5）、产物改 SVG 解决持久化（T1）、数据模型定案判别联合（T2）、定义跨 stage 附件数据流（T3）、reducer 契约与打回模拟策略（T4）、存储迁移（T5）、砍掉二期占位死代码（T6）、简化渲染规则纯函数化（T7）、门禁定案（T8）。

## 1. 背景与问题

文生视频模型缺乏对物体空间位置关系的几何锚点：同一物体在跨镜头生成时容易发生位置漂移。传统影视制作用 **previs（预演）** 解决：先在场景里摆好布景与机位，再据此拍最终画面。

本方案引入「空间预演台」sub-agent：分镜脚本 → 生成场景摆位与机位 → 渲染**深度图 + 边缘图** → 作为视频生成模型的**参考附件**，把空间布局以几何约束传给 video_gen。

### 1.1 价值与成功指标（P1）

**核心价值**：减少视频阶段的打回重写、提高首轮门禁通过率、加速成片交付。预演台是"一次摆位成本，换取多轮重写成本"的杠杆。

| 指标 | 定义 | 模拟实现 |
|---|---|---|
| 空间一致性得分 | visual_qa 新增指标（0-100） | 与 previs 附件质量、摆位复杂度相关 |
| 视频首轮门禁通过率 | 无 previs 项目 vs 有 previs 项目 | 有 previs 时 video_gen avgScore 基线 +5~8 |
| 平均打回次数 | gateRetries 均值 | 有 previs 时上限 -1 |

演示叙事：控制变量对比（同项目开/关预演台的质检分数差异）。

## 2. 参考项目调研

[storyai-3d-director-desk](https://github.com/jiguang132/storyai-3d-director-desk)（MIT）：浏览器端 3D 预演编辑器（Three.js/R3F + Zustand）——人工装配角色/群演/几何体/摄像机/全景，镜头录制与截图，工程 JSON 导入导出。

**两个缺口**（需自行扩展）：
- 不解析剧本、无"文本→场景布局"自动化（人工摆位）
- 不导出深度图/边缘图（仅普通截图）

## 3. 可行性结论

- **概念成立**：深度/边缘条件化生成（ControlNet 系、VideoComposer、HunyuanVideo 深度控制、商业 API 参考图/结构控制）是成熟路线；同一场景多机位渲染出的 depth/edge 恰好提供跨镜头几何锚点
- **本项目引擎是模拟的**：集成 = 新增模拟 agent/artifact 类型，不真实调用模型
- **图片→3D 建模**：可行（②③档）。三档成本：① CPU 2.5D 浮雕（Depth-Anything ONNX，零 GPU 门槛）；② 消费级 GPU 真 3D（TripoSR/InstantMesh，1-10s/张）；③ 云端 API。**列为二期整体规划，本期不预留接口（T6 YAGNI）**

## 4. 架构：接入现有 boost 机制

现有引擎支持 **boost 子智能体**（`templates.ts` 的 `injectBefore/injectAfter`）。预演台作为新 boost stage 注入 **storyboard 与 video_gen 之间**：

```
基础链路：剧本 → 分镜 → [空间预演台] → 视频生成 → 视觉质检 → 配音 → 剪辑
                          ↑ 注入点
```

### 4.1 命名（P3）

产品名「**空间预演台**」，agent id `previs`。UI 与描述明确"2D 模拟渲染（布景图+深度/边缘图）"，"3D"为二期能力，不提前透支。

### 4.2 Agent 元数据（SEED_AGENTS 新增）

```ts
{ id: "previs", name: "空间预演台", group: "pre",
  description: "分镜驱动场景摆位与机位规划，渲染深度图/边缘图作为视频生成参考附件",
  status: "active", modelId: "llm", maxIterations: 3,
  usesRag: ["scene-background", "visual-style"], avgScore: 84 }
```

### 4.3 模板注入与智能启用（P2）

```ts
{ agentId: "previs", before: "video_gen", checkpoint: true,
  title: "空间预演台", description: "场景摆位与机位规划，人工确认后进入视频生成" }
```

**智能启用规则**：分镜满足任一条件才注入——① 镜头数 ≥3；② 任一镜头群演数 ≥2；③ 场景含 3 个以上可摆放物。单镜头简单项目不挂载，避免流程负担。

### 4.4 与 consistency_guard 的职责边界（P4）

- **空间预演台（事前预防）**：提供几何锚点，把空间关系固化进参考附件
- **一致性守护（事后校验）**：贯穿全流程比对（角色/场景视觉一致性）
- 协同：previs 附件纳入 consistency_guard 的比对输入；空间一致性指标由 visual_qa 输出

## 5. 数据模型

### 5.1 ArtifactKind 扩展

```ts
export type ArtifactKind = ... | "previs"
```

### 5.2 PrevisArtifact：判别联合（T2 定案）

```ts
/** 判别联合：previs 专用载荷，与通用 Artifact 平级 */
export interface PrevisArtifact extends Artifact {
  kind: "previs"
  shots: PrevisShot[]
}
export interface PrevisShot {
  shotIndex: number
  camera: { position: [number, number, number]; target: [number, number, number]; fov: number }
  blocking: BlockingItem[]
  previewSvg: string   // 预演帧（布景俯视图，SVG 文本）
  depthSvg: string     // 深度图（SVG 渐变）
  edgeSvg: string      // 边缘图（SVG 线稿）
}
export interface BlockingItem {
  id: string; kind: "character" | "prop" | "terrain"
  name: string
  position: [number, number, number]; rotationY: number; scale: number
}
```

**产物格式定案：SVG 文本而非位图（T1）**——深度渐变/边缘线稿/布景图为矢量，单张 <5KB（位图 dataURL 单张 200KB+，base64 膨胀 33%，多镜头多项目必爆 localStorage 配额）；SVG 可持久化进 state、可缩放、可程序化生成。

**类型守卫**：`isPrevisArtifact(a: Artifact): a is PrevisArtifact` 统一分发渲染。

### 5.3 跨 stage 附件数据流（T3 定案）

`WorkflowStage` 新增可选字段：

```ts
references?: { kind: "previs"; depthUrl: string; edgeUrl: string }[]
```

**接线规则**（engine 层）：stage 流转至 `running` 时，engine 从**上游已 completed 的 previs artifact** 提取 depth/edge SVG，序列化为 data URL 注入下游 stage 的 `references`。引用是**只读快照**——上游干预重渲染后，下游引用在重新流转时更新（打回重写会触发重流转）。

## 6. 状态流转与用户干预

```
pending → running（自动摆位 + 渲染三图）
        → waiting_approval（checkpoint，人工干预节点）
           ├─ 批准 → video_gen（references 注入 depth/edge）
           └─ 打回重写（反馈 → 下一轮迭代重新摆位）
```

**干预方式（manual 干预模式项目，与现有 L3 手作式一致）**：
- **2D 布景俯视图**：SVG 布景图上拖拽角色/道具标记（俯视投影与 3D 布局一一映射）
- **机位参数面板**：position/target/FOV 数值或拖杆
- 修改后「重新渲染」：三图即时更新（防抖 300ms），重新评估空间一致性

**默认全自动（P5）**：自动摆位产出质量即达可用标准，干预面板为进阶能力。

### 6.1 reducer 契约（T4 定案）

```ts
{ type: "UPDATE_PREVIS_BLOCKING", projectId, stageId, shotIndex, blocking }  // 拖拽/参数修改
{ type: "RERENDER_PREVIS", projectId, stageId }                              // 重渲染三图 + 重新评估
```

**打回重写模拟策略**：`REJECT_STAGE` 的 reason 文本按关键词启发式触发摆位微调（"左/右/近/远/大/小" → 对应位移/缩放增量），写入下一轮 `iterations` 记录，与现有迭代机制一致。

## 7. 三图生成：SVG 程序化渲染（模拟引擎）

引擎为模拟的，用 **SVG 文本生成**（纯函数，便于单测，不引入 Three.js）：

```
blocking + camera ──renderPrevisShot()──▶ { previewSvg, depthSvg, edgeSvg }
```

**简化渲染规则（T7 定案）**：
- 布景图：俯视投影——角色=带朝向箭头的圆点、道具=方块、地形=底图，标注镜头视锥
- 深度图：**画家算法**（按视距排序绘制）+ 距离灰度渐变（近亮远暗），不追求物理级精确
- 边缘图：物体轮廓线段 + 相互遮挡处的断裂线

种子数据：demo 项目「星尘余晖」预置一个 previs 阶段示例（2 镜头，含三图）。

## 8. 存储迁移（T5）

`STORAGE_KEY` bump 至 `cine-muse-state-v2`，迁移函数：旧 v1 数据保留全部字段、丢弃/补建 previs 相关字段（无 previs 的旧项目直接可用，新项目按模板重建）。electron SQLite 侧同步处理。

## 9. UI 改动清单

1. 工作流画布：新增 previs 节点（pre 组，新图标如 `BoxIcon`）
2. 抽屉 ArtifactPanel：previs 展示——预演帧/深度图/边缘图三图并排（SVG 内联渲染）+ 机位与摆位参数表格 + 下游 `references` 徽章
3. 干预面板（manual 模式）：2D 布景 SVG 拖拽 + 机位参数控件 + 「重新渲染」
4. KIND_ICON 映射新增 previs
5. 质检面板：visual_qa 指标网格新增「空间一致性」

## 10. 验收标准

- 新建项目（full 模板，满足启用规则）流水线含预演台节点，自动产出 布景/深度/边缘 三图
- 2D 布景干预（移动/机位调整）后重渲染生效，下游 references 快照更新
- 批准后 video_gen 展示参考附件徽章；visual_qa 含「空间一致性」指标；开/关预演台的门禁通过率差异可演示
- 存储迁移：v1 数据升级 v2 无崩溃
- `pnpm exec tsc --noEmit` 通过（layout.tsx 既有问题除外）

## 11. 范围外（二期，本期不留占位代码）

- 真实 3D 编辑器（Three.js 嵌入，可复用参考项目 MIT 代码）
- 图片→3D 建模（① CPU 2.5D / ② GPU 真 3D / ③ 云端 API）
- 真实视频模型 API 对接（Seedance/Veo 结构控制实测）
