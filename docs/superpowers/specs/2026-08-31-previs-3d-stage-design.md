# 3D 预演台（Previs）Sub-Agent 设计

日期：2026-08-31
状态：讨论稿（未编码）

## 1. 背景与问题

文生视频模型缺乏对物体空间位置关系的几何锚点：同一物体在跨镜头生成时容易发生位置漂移（"杯子在画面左侧，下一镜头跑到右侧"）。传统影视制作用 **previs（预演）** 解决：先在 3D 场景里摆好布景与机位，再据此拍最终画面。

本方案引入「3D 预演台」sub-agent：分镜脚本 → 生成场景 3D 摆位 → 渲染**深度图 + 边缘图** → 作为视频生成模型的**参考附件**，把空间布局以几何约束传给 video_gen，解决跨镜头空间不一致。

## 2. 参考项目调研

[storyai-3d-director-desk](https://github.com/jiguang132/storyai-3d-director-desk)（MIT）：浏览器端 3D 预演编辑器（Three.js/R3F + Zustand）——人工装配角色/群演/几何体/摄像机/全景，镜头录制与截图，工程 JSON 导入导出。

**两个缺口**（需自行扩展）：
- 不解析剧本、无"文本→场景布局"自动化（人工摆位）
- 不导出深度图/边缘图（仅普通截图）

## 3. 可行性结论

- **概念成立**：深度/边缘条件化生成（ControlNet 系、VideoComposer、HunyuanVideo 深度控制、商业 API 参考图/结构控制）是成熟路线；同一 3D 场景多机位渲染出的 depth/edge 恰好提供跨镜头几何锚点
- **本项目引擎是模拟的**：集成 = 新增模拟 agent/artifact 类型，不真实调用模型
- **图片→3D 建模**：可行。三档成本：① CPU 2.5D 浮雕（Depth-Anything ONNX + 深度位移网格，零 GPU 门槛）；② 消费级 GPU 真 3D（TripoSR/InstantMesh/Hunyuan3D，开源免费，1-10s/张）；③ 云端 API（Tripo/Meshy）。单图重建背面为推断结果，质量够预演摆位、不够最终资产。真实推理为二期，本设计预留接口

## 4. 架构：接入现有 boost 机制

现有引擎支持 **boost 子智能体**（`templates.ts` 的 `injectBefore/injectAfter`，如 `{ before: "video_gen" }`）。预演台作为新 boost stage 注入 **storyboard 与 video_gen 之间**：

```
基础链路：剧本 → 分镜 → [3D 预演台] → 视频生成 → 视觉质检 → 配音 → 剪辑
                          ↑ 注入点
```

### 4.1 Agent 元数据（SEED_AGENTS 新增）

```ts
{ id: "previs", name: "3D 预演台", group: "pre",
  description: "分镜驱动场景摆位与机位规划，渲染深度图/边缘图作为视频生成参考附件",
  status: "active", modelId: "llm", maxIterations: 3,
  usesRag: ["scene-background", "visual-style"], avgScore: 84 }
```

### 4.2 模板注入（templates.ts）

```ts
// boost 条目：挂载在 video_gen 之前，checkpoint 为 true（人工干预节点）
{ agentId: "previs", before: "video_gen", checkpoint: true,
  title: "3D 预演台", description: "场景摆位与机位规划，人工确认后进入视频生成" }
```

## 5. 数据模型

### 5.1 ArtifactKind 扩展

```ts
export type ArtifactKind = ... | "previs"
```

### 5.2 PrevisArtifact（Artifact 扩展可选字段，或新接口）

```ts
export interface PrevisShot {
  shotIndex: number
  camera: { position: [number, number, number]; target: [number, number, number]; fov: number }
  blocking: BlockingItem[]          // 场景摆位（角色/道具/地形）
  previewUrl: string                // 预演帧（程序化渲染）
  depthUrl: string                  // 深度图
  edgeUrl: string                   // 边缘图
}
export interface BlockingItem {
  id: string; kind: "character" | "prop" | "terrain"
  name: string
  position: [number, number, number]; rotationY: number; scale: number
}
```

### 5.3 视频生成消费参考附件

video_gen 阶段新增 `attachments`（可选字段）：`{ kind: "previs", depthUrl, edgeUrl }`，UI 上以「参考附件」徽章 + 缩略图展示。

## 6. 状态流转与用户干预

```
pending → running（自动摆位 + 渲染三图）
        → waiting_approval（checkpoint，人工干预节点）
           ├─ 批准 → video_gen（携带 depth/edge 附件）
           └─ 打回重写（反馈文本 → 下一轮迭代重新摆位）
```

**干预方式（manual 干预模式项目，与现有 L3 手作式一致）**：
- **2D 布景俯视图**：场景平面图上拖拽角色/道具标记（俯视投影与 3D 布局一一映射）
- **机位参数面板**：position/target/FOV 数值或拖杆
- 修改后「重新渲染」：深度/边缘图即时更新，重新评估空间一致性

## 7. 深度/边缘图生成（模拟引擎：程序化渲染）

引擎为模拟的，预演产物用 **canvas 程序化渲染**（不引入 Three.js）：
- 布景俯视图：根据 blocking 数据画平面布局（角色=带朝向箭头圆点、道具=方块、地形=底图）
- 深度图：按相机与物体距离生成灰度渐变（近白远黑）
- 边缘图：按遮挡/轮廓关系生成线稿
- 每镜头按 camera 参数投影渲染，输出 dataURL/blob URL

种子数据：demo 项目「星尘余晖」预置一个 previs 阶段示例（2 镜头，含三图）。

## 8. 图片建模（二期，预留接口）

```ts
interface PrevisProvider {
  buildShot(input: { storyboard: Artifact; image?: File }): Promise<PrevisShot>
}
// 实现一：SimulatedPrevisProvider（默认，程序化渲染）
// 实现二：OnnxPrevisProvider（二期：Depth-Anything 2.5D → 真 3D 网格）
```
UI 上预演台支持「从本地图片生成 3D 模型」上传入口（二期启用，本期置灰）。

## 9. UI 改动清单

1. 工作流画布：新增 previs 节点（pre 组，新图标）
2. 抽屉 ArtifactPanel：previs 展示——预演帧/深度图/边缘图三图并排 + 机位与摆位参数表格 + 参考附件徽章
3. 干预面板（manual 模式）：2D 布景视图 + 机位参数控件 + 「重新渲染」
4. KIND_ICON 映射新增 previs（如 `LandmarkIcon` 或 `BoxIcon`）
5. 质检面板：visual_qa 指标增加「空间一致性」

## 10. 验收标准

- 新建项目（full 模板）流水线含预演台节点，自动产出 预演帧+深度+边缘 三图
- 2D 布景干预（移动/机位调整）后重渲染生效，附件更新
- 批准后 video_gen 展示参考附件；质检含「空间一致性」指标
- `pnpm exec tsc --noEmit` 通过（layout.tsx 既有问题除外）

## 11. 范围外（二期）

- 真实 3D 编辑器（Three.js 嵌入，可复用参考项目 MIT 代码）
- 真实 ONNX 图片→3D 推理（①② 档）
- 真实视频模型 API 对接（Seedance/Veo 结构控制实测）
