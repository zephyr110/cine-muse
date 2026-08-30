/**
 * 工作流模板定义 + 模拟产出生成器
 * 对应方案 3.4：full（7 执行节点 + 2 确认节点）、quick（3 节点）
 */

/** 质量门禁通过线（0-100） */
export const GATE_PASS_SCORE = 75
/** 门禁打回上限：连续失败达到该次数后节点 FAILED */
export const GATE_MAX_RETRIES = 3

import type {
  Artifact,
  ArtifactKind,
  AssetCategory,
  NewProjectInput,
  QualityAssessment,
  WorkflowStage,
} from "@/lib/types"

/** 已解析类别的绑定资产（由 reducer 从资产库实体展开） */
export interface BoundAsset {
  assetId: string
  role: string
  category: AssetCategory
}

export interface StageTemplate {
  agentId: string
  title: string
  description: string
  checkpoint?: boolean
  gateAgent?: string // 门禁审查 Agent 名
  artifactKind: ArtifactKind
}

/**
 * 增强 Sub-Agent 插槽：在核心链锚点插入独立环节（full 模板已含的 agent 自动跳过）。
 * after/before 锚定核心环节的 agentId；锚点不存在时追加到链尾。
 */
export interface BoostSlot {
  agentId: string
  title: string
  description: string
  after?: string
  before?: string
  gateAgent?: string
  artifactKind: ArtifactKind
}

export const BOOST_SLOTS: BoostSlot[] = [
  {
    agentId: "script_review",
    title: "剧本审查",
    description: "剧本定稿前增设专项门禁：叙事节奏、冲突密度与角色弧光",
    after: "screenplay",
    gateAgent: "剧本审查",
    artifactKind: "script",
  },
  {
    agentId: "style_design",
    title: "风格与角色设定",
    description: "先于画面生成产出视觉风格指南与角色参考图，让成片更有锚点",
    after: "screenplay",
    artifactKind: "style_guide",
  },
  {
    agentId: "scene_gen",
    title: "场景生成",
    description: "视频生成前产出关键场景概念图，提升场景还原度",
    before: "video_gen",
    artifactKind: "scene",
  },
  {
    agentId: "consistency_guard",
    title: "一致性守护",
    description: "建立角色/场景视觉参考库，视频生成前统一跨镜头比对口径",
    before: "video_gen",
    gateAgent: "一致性守护",
    artifactKind: "storyboard",
  },
  {
    agentId: "visual_qa",
    title: "视觉质检",
    description: "视频片段生成后逐镜质检画面稳定性与语义匹配",
    after: "video_gen",
    gateAgent: "视觉质检",
    artifactKind: "video",
  },
]

/** full 流水线：剧本→门禁→分镜→门禁→风格(人工)→场景→视频→门禁→配音→剪辑(人工) */
export const FULL_PIPELINE: StageTemplate[] = [
  {
    agentId: "screenplay",
    title: "剧本撰写",
    description: "基于创意大纲生成三幕结构完整剧本",
    gateAgent: "剧本审查",
    artifactKind: "script",
  },
  {
    agentId: "storyboard",
    title: "分镜脚本",
    description: "逐场景拆解镜头，标注景别与运镜",
    gateAgent: "一致性守护",
    artifactKind: "storyboard",
  },
  {
    agentId: "style_design",
    title: "风格与角色设定",
    description: "视觉风格指南、角色外观与参考图",
    checkpoint: true,
    artifactKind: "style_guide",
  },
  {
    agentId: "scene_gen",
    title: "场景生成",
    description: "关键场景概念设计与背景图生成",
    artifactKind: "scene",
  },
  {
    agentId: "video_gen",
    title: "视频生成",
    description: "分镜驱动逐镜头生成视频片段",
    gateAgent: "视觉质检",
    artifactKind: "video",
  },
  {
    agentId: "voiceover",
    title: "配音合成",
    description: "角色对白与旁白 TTS 合成",
    artifactKind: "voiceover",
  },
  {
    agentId: "editing",
    title: "剪辑合成",
    description: "镜头剪辑、音画同步与成片渲染",
    checkpoint: true,
    artifactKind: "final_cut",
  },
]

/** 快速预览模板：剧本 → 视频 → 成片 */
export const QUICK_PIPELINE: StageTemplate[] = [
  {
    agentId: "screenplay",
    title: "剧本撰写",
    description: "生成精简剧本与分镜要点",
    gateAgent: "剧本审查",
    artifactKind: "script",
  },
  {
    agentId: "video_gen",
    title: "视频生成",
    description: "关键镜头视频快速生成",
    gateAgent: "视觉质检",
    artifactKind: "video",
  },
  {
    agentId: "editing",
    title: "成片合成",
    description: "粗剪合成成片预览",
    checkpoint: true,
    artifactKind: "final_cut",
  },
]

export function buildStages(input: NewProjectInput): WorkflowStage[] {
  const tpl = input.template === "quick" ? QUICK_PIPELINE : FULL_PIPELINE
  // 增强 Sub-Agent：按锚点插入核心链；已在链上的 agent（full 模板）跳过避免重复
  const stages: StageTemplate[] = [...tpl]
  for (const b of BOOST_SLOTS) {
    if (!input.boostAgentIds?.includes(b.agentId)) continue
    if (tpl.some((t) => t.agentId === b.agentId)) continue
    const beforeIdx = b.before ? stages.findIndex((t) => t.agentId === b.before) : -1
    const afterIdx = b.after ? stages.findIndex((t) => t.agentId === b.after) : -1
    const idx = beforeIdx >= 0 ? beforeIdx : afterIdx >= 0 ? afterIdx + 1 : -1
    const { agentId, title, description, gateAgent, artifactKind } = b
    stages.splice(idx < 0 ? stages.length : idx, 0, { agentId, title, description, gateAgent, artifactKind })
  }
  return stages.map((t, i) => ({
    id: `stg-${i}-${t.agentId}`,
    agentId: t.agentId,
    title: t.title,
    description: t.description,
    status: "pending" as const,
    isCheckpoint: !!t.checkpoint,
    gate: t.gateAgent ? true : undefined,
    gateAgentName: t.gateAgent,
    iterations: [],
    reviews: [],
    gateRetries: 0,
    progress: 0,
  }))
}

/* ---------- 模拟产出 ---------- */

export const STYLE_LIBRARY: Record<string, string> = {
  赛博朋克: "霓虹蓝紫高对比、雨夜反光、复古未来主义",
  黑色电影: "低照度硬光、阴影切割、冷峻色调",
  治愈系: "暖调柔光、自然饱和度、留白构图",
  古风: "水墨质感、低饱和青灰、对称构图",
  赛博国风: "霓虹 + 水墨融合、青金配色",
  纪实: "自然光、手持晃动、真实颗粒感",
  动画: "高饱和色彩、风格化形变、夸张透视",
}

export const GENRE_LIBRARY: Record<string, string> = {
  科幻: "硬核科幻与人文关怀交织",
  悬疑: "层层递进的谜团与反转",
  爱情: "克制而细腻的情感叙事",
  动作: "高速剪辑与张力节奏",
  家庭: "日常细节中的情感共振",
  奇幻: "想象力驱动的世界观",
  犯罪: "灰色地带的人性博弈",
  战争: "宏大叙事下的个体视角",
}

const STAGE_CONTENT: Record<string, (p: NewProjectInput) => Artifact> = {
  screenplay: (p) => ({
    kind: "script",
    title: `${p.title} · 剧本全稿`,
    summary: `三幕结构 · ${p.genre}类型 · ${Math.round(p.durationSec / 60)} 分钟`,
    scenes: 12,
    words: 4200,
    content: [
      `【第一幕】开场：以 ${p.premise} 为引子，在 ${STYLE_LIBRARY[p.style] ?? "统一视觉基调"} 下建立主角困境。`,
      `【节拍】第 1 场：日常世界被打破；第 3 场：核心冲突露出苗头；第 5 场：第一幕转折（主角做出关键选择）。`,
      `【第二幕】第 6-9 场：目标明确但阻力升级，两个次要角色的动机交织成副线。`,
      `【第三幕】第 10 场：真相揭示（${GENRE_LIBRARY[p.genre] ?? "类型主题"}）；第 11-12 场：高潮对决与情绪收束。`,
      `【对白风格】短句为主，潜台词多于直白表露；关键对白在全片三处呼应。`,
    ].join("\n"),
  }),
  storyboard: (p) => ({
    kind: "storyboard",
    title: `${p.title} · 分镜脚本`,
    summary: `12 场 · 34 镜 · 含景别/运镜标注`,
    shots: 34,
    content: [
      "S01  全景  固定机位     雨夜街景，霓虹倒影，主角背影入画",
      "S02  中景  缓推         主角抬头，眼神揭示意图",
      "S03  特写  手持微晃     关键道具特写（伏笔）",
      "S04  中近景 平移跟拍     追逐戏第一拍，节奏 0.8x",
      "S05  过肩  正反打       对峙对话，构图留出头顶空间",
      "S06  全景  无人机俯拍   环境交代，城市规模感",
      "S07  近景  推镜         情绪高潮前的静默",
      "S08  特写  固定         决定性瞬间（反转点）",
      "S09  中景  手持         动作场面，碎片化剪辑预备",
      "S10  远景  缓拉         情绪余韵，画面留白",
      "S11  特写  微距         细节收束呼应 S03 伏笔",
      "S12  全景  固定         片尾定帧，字幕区预留",
    ].join("\n"),
  }),
  style_design: (p) => ({
    kind: "style_guide",
    title: `${p.title} · 视觉风格指南`,
    summary: `${p.style} · 主角色 2 名 · 场景基调 ${Math.max(3, Math.round(p.durationSec / 60 / 2))} 类`,
    content: [
      `【色彩基调】${STYLE_LIBRARY[p.style] ?? "统一视觉基调"}`,
      `【主角 A】性别女，28 岁，冷色系服装，面部特征：锐利眼神 + 不对称刘海；贯穿全片。`,
      `【主角 B】性别男，34 岁，暖色点缀，面部特征：胡茬 + 深色大衣。`,
      `【光影】主光 45° 侧逆光，夜景场景补霓虹环境色；日景偏自然散射。`,
      `【质感】胶片颗粒 8%，轻微色散；禁止过度美颜滤镜。`,
    ].join("\n"),
  }),
  scene_gen: (p) => ({
    kind: "scene",
    title: `${p.title} · 场景概念图`,
    summary: `6 个关键场景 · ${p.aspectRatio} 比例 · ${p.quality} 画质`,
    scenes: 6,
    content: "1. 雨夜主干道（外景）  2. 霓虹天台（外景）  3. 逼仄办公室（内景）  4. 隧道追逐（外景）  5. 旧工厂仓库（内景）  6. 日出江边（外景）",
  }),
  video_gen: (p) => ({
    kind: "video",
    title: `${p.title} · 视频片段`,
    summary: `34 镜合成 ${Math.round(p.durationSec / 60)} 段 · 关键帧抽帧已比对`,
    scenes: 12,
    durationSec: p.durationSec,
    content: "已生成 34 段镜头视频（Seedance v2 渲染），含运动控制与关键帧一致性对齐。",
  }),
  voiceover: (p) => ({
    kind: "voiceover",
    title: `${p.title} · 配音音轨`,
    summary: `对白 18 条 + 旁白 2 条 · 双声线`,
    durationSec: Math.round(p.durationSec * 0.82),
    content: "声线 A（女主）：清亮偏冷；声线 B（男主）：低沉磁性；旁白：中性纪录片质感。已对齐台词口型时间轴。",
  }),
  editing: (p) => ({
    kind: "final_cut",
    title: `${p.title} · 成片`,
    summary: `${Math.round(p.durationSec / 60)} 分钟 · ${p.aspectRatio} · ${p.quality} 画质 · 含字幕与混音`,
    durationSec: p.durationSec,
    scenes: 12,
    content: "剪辑合成完成：34 镜剪辑、音画同步、氛围混音、片头片尾与字幕。",
  }),
  script_review: (p) => ({
    kind: "script",
    title: `${p.title} · 剧本审查报告`,
    summary: `叙事节奏 · 冲突密度 · 角色弧光 专项审查`,
    words: 680,
    content: [
      `【审查对象】${p.title} · ${GENRE_LIBRARY[p.genre] ?? "类型主题"} · 三幕结构`,
      `【叙事节奏】第一幕信息密度适中；第二幕中段存在一处拖沓，建议删减一场过渡戏。`,
      `【冲突密度】核心冲突浮现偏晚（第 4 场），建议前移一次小的预演冲突。`,
      `【角色弧光】主角弧光完整，配角动机需在第三幕前再给出一次行动支撑。`,
      `【结论】本稿可进入分镜，上述意见作为修订指引伴随流程。`,
    ].join("\n"),
  }),
  consistency_guard: (p) => ({
    kind: "storyboard",
    title: `${p.title} · 视觉参考库`,
    summary: `角色卡 2 名 · 场景基调 4 类 · 风格锚点`,
    content: [
      `【角色参考】主角外观锚点：${p.style} 基调下的主色与发型特征；配角提供 2 套服装备选。`,
      `【场景基调】主场景明度/色温区间、关键道具位置图。`,
      `【风格锚点】${STYLE_LIBRARY[p.style] ?? "统一视觉基调"}，跨镜头比对以此为口径。`,
    ].join("\n"),
  }),
  visual_qa: (p) => ({
    kind: "video",
    title: `${p.title} · 质检报告`,
    summary: `逐镜质检 · 画面稳定性 · 语义匹配`,
    durationSec: Math.round(p.durationSec / 2),
    content: `【质检结论】全部镜头通过：稳定性 ≥ 80，语义匹配 ≥ 85，跨镜头一致性通过。`,
  }),
}

/** 该环节会消费的资产类别（agent 资产消费链的锚点） */
const AGENT_ASSET_CATEGORIES: Record<string, AssetCategory[]> = {
  screenplay: ["prop", "character"], // 道具/角色影响叙事动机
  storyboard: ["scene"],
  style_design: ["character", "style"],
  scene_gen: ["scene", "style"],
  video_gen: ["character", "scene", "prop"], // 一致性守护的比对锚点
  voiceover: ["character"],
}

/** 组装"已消费资产"上下文行 */
function assetContext(bindings: BoundAsset[], categories: AssetCategory[] | undefined): string {
  if (!categories?.length) return ""
  const matched = bindings.filter((b) => categories.includes(b.category))
  if (!matched.length) return ""
  return `\n【已消费资产】${matched.map((b) => `${b.role}（${b.assetId}）`).join("、")}`
}

export function buildArtifact(
  stage: WorkflowStage,
  input: NewProjectInput,
  bindings: BoundAsset[] = [],
): Artifact {
  const gen = STAGE_CONTENT[stage.agentId]
  const context = assetContext(bindings, AGENT_ASSET_CATEGORIES[stage.agentId])
  if (!gen) {
    return {
      kind: "scene",
      title: `${input.title} · 产出`,
      summary: "已生成",
      content: `已生成${context}`,
    }
  }
  const artifact = gen(input)
  return context && artifact.content
    ? { ...artifact, content: `${artifact.content}${context}` }
    : artifact
}

/* ---------- 质量评估模拟 ---------- */

export const METRIC_BY_AGENT: Record<string, { key: string; label: string }[]> = {
  screenplay: [
    { key: "structure", label: "结构完整度" },
    { key: "conflict", label: "冲突密度" },
    { key: "dialogue", label: "对白质量" },
  ],
  storyboard: [
    { key: "shot_logic", label: "镜头逻辑" },
    { key: "coverage", label: "叙事覆盖" },
    { key: "camera", label: "运镜专业度" },
  ],
  style_design: [
    { key: "cohesion", label: "视觉统一性" },
    { key: "character", label: "角色辨识度" },
  ],
  scene_gen: [
    { key: "fidelity", label: "还原度" },
    { key: "atmosphere", label: "氛围感" },
  ],
  video_gen: [
    { key: "stability", label: "画面稳定性" },
    { key: "match", label: "分镜匹配度" },
    { key: "consistency", label: "角色一致性" },
  ],
  voiceover: [
    { key: "synced", label: "口型同步" },
    { key: "emotion", label: "情绪传达" },
  ],
  editing: [
    { key: "pacing", label: "节奏把控" },
    { key: "sync", label: "音画同步" },
    { key: "continuity", label: "连续性" },
  ],
  script_review: [
    { key: "pacing", label: "叙事节奏" },
    { key: "conflict", label: "冲突密度" },
    { key: "arc", label: "角色弧光" },
  ],
  consistency_guard: [
    { key: "character", label: "角色一致性" },
    { key: "scene", label: "场景连续性" },
    { key: "style", label: "风格统一性" },
  ],
  visual_qa: [
    { key: "stability", label: "画面稳定性" },
    { key: "match", label: "语义匹配度" },
    { key: "continuity", label: "跨镜头一致性" },
  ],
}

/** 绑定资产对各环节的质量加成（资产 = 一致性锚点，提升产出与门禁表现） */
const ASSET_BOOST: Record<string, { score: number; metric: string; text: string }> = {
  screenplay: { score: 3, metric: "structure", text: "道具/角色资产为叙事动机提供了锚点。" },
  style_design: { score: 4, metric: "character", text: "角色卡直接约束了外观设定，辨识度提升。" },
  scene_gen: { score: 4, metric: "fidelity", text: "场景卡保证了环境还原度。" },
  video_gen: { score: 3, metric: "consistency", text: "角色/场景资产作为跨镜头比对锚点，一致性提升。" },
  voiceover: { score: 3, metric: "emotion", text: "角色卡声线设定提升了情绪传达。" },
}

/** 生成质量评估；iteratingRound > 0 时分数显著回升（模拟改进）；bindings 提供资产加成 */
export function simulateAssessment(
  stage: WorkflowStage,
  now: string,
  iteratingRound: number,
  bindings: BoundAsset[] = [],
): QualityAssessment {
  const boost = ASSET_BOOST[stage.agentId]
  const categories = AGENT_ASSET_CATEGORIES[stage.agentId]
  const hasAsset = boost ? bindings.some((b) => categories?.includes(b.category)) : false
  const assetLift = boost && hasAsset ? boost.score : 0
  const base = 66 + Math.random() * 26 // 66-92
  // 首轮 ±浮动使门禁失败可达（触发修复流程）；迭代轮显著回升，必然通过
  const lift = iteratingRound > 0 ? 8 + iteratingRound * 4 + Math.random() * 6 : Math.random() * 16 - 6
  const score = Math.min(97, Math.round(base + lift + assetLift))
  const metrics = (METRIC_BY_AGENT[stage.agentId] ?? []).map((m) => ({
    ...m,
    value: Math.max(
      45,
      Math.min(99, Math.round(score + (Math.random() * 14 - 7) + (boost && m.key === boost.metric ? 6 : 0))),
    ),
  }))
  return {
    score,
    confidence: Math.round(70 + Math.random() * 25),
    feedback: [
      score >= GATE_PASS_SCORE
        ? "产出符合预期，关键要素齐备，建议直接进入下一环节。"
        : score >= 60
          ? "整体可用，但存在明显短板：细节打磨不足，建议针对性修改后重审。"
          : "基础要素尚可，叙事/视觉关键点偏差较大，建议本轮大幅返工。",
      boost && hasAsset ? `（${boost.text}）` : "",
    ].join(""),
    metrics,
  }
}

/** 门禁审查意见（gate 节点在 assessment 基础上附加审查 Agent 视角） */
export function gateFeedback(stage: WorkflowStage, score: number): string {
  const reviewer = stage.gate ? stage.gateAgentName : undefined
  const base =
    score >= GATE_PASS_SCORE
      ? "审查通过：关键维度达标，无阻塞项。"
      : score >= 60
        ? `审查打回：以下维度未达通过线（≥${GATE_PASS_SCORE}）——建议补充细节并加强一致性。`
        : "审查打回：与项目设定存在明显偏差，建议重写本轮产出。"
  return reviewer ? `【${reviewer}】${base}` : base
}
