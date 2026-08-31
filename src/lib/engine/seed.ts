/**
 * 种子数据：首次启动时初始化演示环境
 * - 项目 1「星尘余晖」进行中：停在"风格与角色设定"人工确认节点（演示 Human-in-the-loop）
 * - 项目 2「雾港迷案」已完成：全链路通过（演示完成态与成片）
 * - 项目 3「夏日来信」待启动：快速模板（演示 quick pipeline）
 */

import type {
  AgentMeta,
  AppState,
  Asset,
  EngineEvent,
  KnowledgeBase,
  ModelConfig,
  Project,
  WorkflowStage,
} from "@/lib/types"

let seq = 0
export function uid(prefix = "id"): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 7)}`
}

export const SEED_AGENTS: AgentMeta[] = [
  { id: "screenplay", name: "剧本撰写", group: "pre", description: "三幕结构拆解、对白打磨，检索剧本结构库与优秀范例库", status: "active", modelId: "llm", maxIterations: 3, usesRag: ["script-structure", "exemplars"], avgScore: 88 },
  { id: "script_review", name: "剧本审查", group: "qa", description: "从叙事节奏、冲突密度、角色弧光评估剧本并给出门禁结论", status: "active", modelId: "llm", maxIterations: 3, usesRag: ["script-structure"], avgScore: 91 },
  { id: "storyboard", name: "分镜脚本", group: "pre", description: "逐场景拆解镜头，标注景别、构图与运镜", status: "active", modelId: "llm", maxIterations: 3, usesRag: ["exemplars"], avgScore: 85 },
  { id: "consistency_guard", name: "一致性守护", group: "qa", description: "维护角色/场景视觉参考库，贯穿全流程比对校验", status: "active", modelId: "llm", maxIterations: 3, usesRag: ["character-bible", "scene-background"], avgScore: 90 },
  { id: "style_design", name: "风格设计", group: "pre", description: "视觉风格指南与角色设定，检索视觉风格库与服化道图鉴", status: "active", modelId: "llm", maxIterations: 3, usesRag: ["visual-style", "costume"], avgScore: 87 },
  { id: "scene_gen", name: "场景生成", group: "production", description: "关键场景概念设计与背景图生成", status: "active", modelId: "llm", maxIterations: 3, usesRag: ["scene-background"], avgScore: 85 },
  { id: "video_gen", name: "视频生成", group: "production", description: "封装 Seedance/Veo 等视频模型，分镜驱动逐镜头生成", status: "active", modelId: "video", maxIterations: 3, usesRag: [], avgScore: 82 },
  { id: "visual_qa", name: "视觉质检", group: "qa", description: "画面清晰度、语义匹配度与跨镜头一致性检查", status: "active", modelId: "llm", maxIterations: 3, usesRag: [], avgScore: 89 },
  { id: "voiceover", name: "配音合成", group: "post", description: "多声线 TTS 合成、口型对齐与情绪演绎", status: "active", modelId: "tts", maxIterations: 3, usesRag: [], avgScore: 86 },
  { id: "editing", name: "剪辑合成", group: "post", description: "剪辑节奏、音画同步、混音与成片渲染", status: "active", modelId: "llm", maxIterations: 3, usesRag: [], avgScore: 88 },
  { id: "previs", name: "空间预演台", group: "pre", description: "分镜驱动场景摆位与机位规划，渲染深度图/边缘图作为视频生成参考附件", status: "active", modelId: "llm", maxIterations: 3, usesRag: ["scene-background", "visual-style"], avgScore: 84 },
]

export const SEED_KNOWLEDGE: KnowledgeBase[] = [
  { id: "script-structure", name: "剧本结构库", description: "三幕剧结构、节拍表、类型模板", entries: 128, enabled: true, icon: "book-open", serves: ["剧本撰写", "剧本审查"], updatedAt: "2026-08-20" },
  { id: "exemplars", name: "优秀范例库", description: "获奖剧本、经典对白片段", entries: 96, enabled: true, icon: "award", serves: ["剧本撰写", "分镜脚本"], updatedAt: "2026-08-18" },
  { id: "visual-style", name: "视觉风格库", description: "流派配色、大师光影参考图", entries: 214, enabled: true, icon: "palette", serves: ["风格设计"], updatedAt: "2026-08-22" },
  { id: "costume", name: "服化道图鉴", description: "历史服饰、职业装束、道具参考", entries: 342, enabled: true, icon: "shirt", serves: ["风格设计"], updatedAt: "2026-08-15" },
  { id: "character-bible", name: "角色设定库", description: "性格原型、职业档案与角色弧光模板", entries: 87, enabled: true, icon: "users", serves: ["剧本撰写", "一致性守护"], updatedAt: "2026-08-21" },
  { id: "scene-background", name: "场景背景库", description: "不同年代/地域场景参考图", entries: 176, enabled: true, icon: "landmark", serves: ["场景生成", "一致性守护"], updatedAt: "2026-08-19" },
  { id: "sound-fx", name: "音效素材库", description: "环境音、拟音与情绪音乐素材", entries: 503, enabled: true, icon: "music", serves: ["配音合成", "剪辑合成"], updatedAt: "2026-08-23" },
]

export const SEED_MODELS: ModelConfig[] = [
  { id: "llm", name: "大语言模型", provider: "DeepSeek / Anthropic / OpenAI", options: [
    { id: "deepseek-v4-flash", label: "DeepSeek-V4-Flash" },
    { id: "deepseek-v4-pro", label: "DeepSeek-V4-Pro" },
    { id: "claude-sonnet", label: "Claude Sonnet 4.6" },
    { id: "gpt-4o", label: "GPT-4o" },
  ], selected: "deepseek-v4-flash", apiKeyConfigured: true, status: "connected" },
  { id: "video", name: "视频生成模型", provider: "Seedance / Google / Kuaishou", options: [
    { id: "seedance-v2", label: "Seedance v2.0" },
    { id: "veo-3.1", label: "Veo 3.1" },
    { id: "kling-2.5", label: "Kling 2.5" },
  ], selected: "seedance-v2", apiKeyConfigured: true, status: "connected" },
  { id: "tts", name: "语音合成", provider: "ElevenLabs / Azure / Volcano", options: [
    { id: "elevenlabs", label: "ElevenLabs" },
    { id: "azure-tts", label: "Azure TTS" },
    { id: "volcano", label: "火山引擎" },
  ], selected: "elevenlabs", apiKeyConfigured: true, status: "connected" },
]

/** 资产库种子：角色/场景/道具/风格 素材卡（真实版为本地素材文件，此处文本描述 + 渐变封面） */
export const SEED_ASSETS: Asset[] = [
  // —— 角色卡 ——
  { id: "ast-aruan", name: "阿岚", category: "character", description: "拾荒者 · 女 28 岁 · 旧军大衣 + 金属义手 · 眼神锐利、不对称刘海", tags: ["科幻", "赛博朋克", "女性", "主角"], color: "from-indigo-500/30 to-violet-500/20", createdAt: "2026-08-10", updatedAt: "2026-08-10" },
  { id: "ast-ghostgirl", name: "影像女孩", category: "character", description: "投影形态小女孩 · 8 岁 · 白裙 · 半透明发光质感", tags: ["科幻", "虚影", "儿童"], color: "from-fuchsia-500/30 to-pink-500/20", createdAt: "2026-08-10", updatedAt: "2026-08-10" },
  { id: "ast-chenmo", name: "陈默", category: "character", description: "港口档案员 · 男 40 岁 · 深色风衣 · 寡言、观察者气质", tags: ["悬疑", "黑色电影", "男性", "主角"], color: "from-slate-500/30 to-cyan-500/20", createdAt: "2026-08-11", updatedAt: "2026-08-11" },
  { id: "ast-suvan", name: "苏晚", category: "character", description: "调查记者 · 女 32 岁 · 短发 · 干练锐利", tags: ["悬疑", "记者", "女性"], color: "from-cyan-500/30 to-blue-500/20", createdAt: "2026-08-11", updatedAt: "2026-08-11" },
  { id: "ast-linche", name: "林澈", category: "character", description: "笔友 · 男 35 岁 · 温和书卷气 · 毛衣 + 圆框眼镜", tags: ["爱情", "治愈系", "男性"], color: "from-amber-500/30 to-orange-400/20", createdAt: "2026-08-12", updatedAt: "2026-08-12" },
  // —— 场景卡 ——
  { id: "ast-rainyard", name: "雨夜回收站", category: "scene", description: "报废卫星堆场 · 雨夜 · 霓虹倒影 · 铁皮棚", tags: ["赛博朋克", "夜景", "外景"], color: "from-blue-700/30 to-slate-900/30", createdAt: "2026-08-10", updatedAt: "2026-08-10" },
  { id: "ast-rooftop", name: "霓虹天台", category: "scene", description: "城市天台 · 巨型霓虹牌 · 天际线尽收眼底", tags: ["赛博朋克", "夜景", "外景"], color: "from-purple-600/30 to-indigo-900/30", createdAt: "2026-08-10", updatedAt: "2026-08-10" },
  { id: "ast-fogharbor", name: "雾港码头", category: "scene", description: "浓雾港口 · 渔船桅灯 · 灯塔剪影 · 铁锈与盐味", tags: ["黑色电影", "港口", "夜景", "外景"], color: "from-slate-600/30 to-slate-900/40", createdAt: "2026-08-11", updatedAt: "2026-08-11" },
  { id: "ast-oldpost", name: "老邮局", category: "scene", description: "木地板大厅 · 阳光尘埃 · 铁栅栏柜台", tags: ["治愈系", "室内", "日景"], color: "from-amber-400/30 to-yellow-600/20", createdAt: "2026-08-12", updatedAt: "2026-08-12" },
  // —— 道具卡 ——
  { id: "ast-glowfilm", name: "发光胶片", category: "prop", description: "报废卫星残骸中的发光胶片 · 全片关键伏笔道具", tags: ["科幻", "关键道具"], color: "from-emerald-500/30 to-teal-500/20", createdAt: "2026-08-10", updatedAt: "2026-08-10" },
  { id: "ast-oldletter", name: "旧信件", category: "prop", description: "泛黄信纸 + 旧邮票 · 迟到二十年的信", tags: ["爱情", "关键道具"], color: "from-orange-300/30 to-rose-400/20", createdAt: "2026-08-12", updatedAt: "2026-08-12" },
  // —— 风格卡 ——
  { id: "ast-cyberpunk", name: "赛博朋克霓虹", category: "style", description: "霓虹蓝紫高对比 · 雨夜反光 · 复古未来主义", tags: ["赛博朋克", "高对比"], color: "from-fuchsia-500/30 via-violet-500/20 to-blue-600/30", createdAt: "2026-08-10", updatedAt: "2026-08-10" },
  { id: "ast-noir", name: "黑色电影光影", category: "style", description: "低照度硬光 · 阴影切割 · 冷峻色调", tags: ["黑色电影", "低照度"], color: "from-slate-700/30 via-slate-500/20 to-cyan-800/30", createdAt: "2026-08-11", updatedAt: "2026-08-11" },
  { id: "ast-healing", name: "治愈系暖调", category: "style", description: "暖调柔光 · 自然饱和度 · 留白构图", tags: ["治愈系", "柔光"], color: "from-amber-300/30 via-orange-200/20 to-rose-300/30", createdAt: "2026-08-12", updatedAt: "2026-08-12" },
]

function stage(
  id: string,
  agentId: string,
  title: string,
  description: string,
  status: WorkflowStage["status"],
  opts: Partial<WorkflowStage> = {},
): WorkflowStage {
  return {
    id,
    agentId,
    title,
    description,
    status,
    isCheckpoint: false,
    iterations: [],
    reviews: [],
    gateRetries: 0,
    progress: status === "completed" || status === "approved" ? 100 : 0,
    ...opts,
  }
}

// 种子时间戳在每次 createSeedState 时刷新（RESET_DEMO 重置后为当下而非模块加载时刻）。
// SSR 与客户端首帧一致性由 store 恢复流程保证（未水合前 AppShell 返回 null，不渲染时间文本）。
let now = new Date()

/** 项目 1：星尘余晖（进行中，停在风格确认节点） */
export function buildStardustProject(): Project {
  const t0 = new Date(now.getTime() - 1000 * 60 * 38).toISOString()
  const t3 = new Date(now.getTime() - 1000 * 60 * 16).toISOString()
  const t4 = new Date(now.getTime() - 1000 * 60 * 12).toISOString()
  const t5 = new Date(now.getTime() - 1000 * 60 * 9).toISOString()

  return {
    id: "prj-stardust",
    title: "星尘余晖",
    premise: "一个回收站的拾荒者在报废卫星中发现了地球最后的影像",
    genre: "科幻",
    style: "赛博朋克",
    durationSec: 180,
    aspectRatio: "16:9",
    quality: "hd",
    template: "full",
    interventionMode: "review",
    assets: [
      { assetId: "ast-aruan", role: "主角阿岚" },
      { assetId: "ast-ghostgirl", role: "影像中的女孩" },
      { assetId: "ast-glowfilm", role: "关键道具：发光胶片" },
      { assetId: "ast-cyberpunk", role: "全片视觉基调" },
    ],
    status: "waiting_approval",
    progress: 29,
    avgScore: 84,
    cover: "from-indigo-500/20 via-violet-500/10 to-fuchsia-500/20",
    createdAt: t0,
    updatedAt: t5,
    stages: [
      stage("st0", "screenplay", "剧本撰写", "基于创意大纲生成三幕结构完整剧本", "completed", {
        gate: true, gateAgentName: "剧本审查",
        artifact: { kind: "script", title: "星尘余晖 · 剧本全稿", summary: "三幕结构 · 科幻类型 · 3 分钟", scenes: 12, words: 4200, content: "【第一幕】开场：拾荒者阿岚在报废卫星中发现地球最后影像。\n【第二幕】阿岚循着影像线索深入城市，发现影像中的小女孩是自己的母亲。\n【第三幕】阿岚选择将影像公之于众，城市在晨光中苏醒。" },
        assessment: { score: 88, confidence: 92, feedback: "结构完整，冲突递进清晰，对白克制有力。", reviewer: "剧本审查", metrics: [
          { key: "structure", label: "结构完整度", value: 90 },
          { key: "conflict", label: "冲突密度", value: 86 },
          { key: "dialogue", label: "对白质量", value: 88 },
        ] },
        iterations: [{ round: 1, assessment: { score: 88, confidence: 92, feedback: "结构完整，冲突递进清晰，对白克制有力。", metrics: [] }, at: t3 }],
        startedAt: t0, finishedAt: t3,
      }),
      stage("st1", "storyboard", "分镜脚本", "逐场景拆解镜头，标注景别与运镜", "completed", {
        gate: true, gateAgentName: "一致性守护",
        artifact: { kind: "storyboard", title: "星尘余晖 · 分镜脚本", summary: "12 场 · 34 镜 · 含景别/运镜标注", shots: 34, content: "S01 全景 固定 雨夜回收站，霓虹反光\nS02 特写 推镜 卫星残骸中的发光胶片\nS03 中景 跟拍 阿岚穿越夜市\nS04 过肩 正反打 与黑市贩子的交易\nS05 全景 俯拍 城市全景与天际线\nS06 近景 缓推 阿岚凝视投影影像\nS07 特写 固定 影像中小女孩的脸（与阿岚相仿）\nS08 中景 手持 追逐戏\nS09 全景 固定 天台对峙\nS10 特写 微距 胶片在手中融化\nS11 近景 缓拉 阿岚的释然微笑\nS12 全景 固定 晨光中的城市定帧" },
        assessment: { score: 82, confidence: 85, feedback: "镜头逻辑顺畅，叙事覆盖完整；夜场镜头的曝光层次建议统一。", reviewer: "一致性守护", metrics: [
          { key: "shot_logic", label: "镜头逻辑", value: 85 },
          { key: "coverage", label: "叙事覆盖", value: 88 },
          { key: "camera", label: "运镜专业度", value: 80 },
        ] },
        iterations: [{ round: 1, assessment: { score: 82, confidence: 85, feedback: "镜头逻辑顺畅，叙事覆盖完整。", metrics: [] }, at: t4 }],
        startedAt: t3, finishedAt: t4,
      }),
      stage("st2", "style_design", "风格与角色设定", "视觉风格指南、角色外观与参考图", "waiting_approval", {
        isCheckpoint: true,
        artifact: { kind: "style_guide", title: "星尘余晖 · 视觉风格指南", summary: "赛博朋克 · 主角色 2 名 · 场景基调 3 类", content: "【色彩基调】霓虹蓝紫高对比、雨夜反光、复古未来主义\n【主角 A】阿岚 · 女 28 岁 · 旧军大衣 + 金属义手\n【主角 B】小女孩 · 女 8 岁 · 白裙（投影形态）\n【光影】夜景霓虹环境色为主，日景仅出现在结尾晨光\n【质感】胶片颗粒 8%，轻色散" },
        assessment: { score: 84, confidence: 88, feedback: "角色辨识度高，视觉统一性强；建议确认主角 A 的义手配色。", metrics: [
          { key: "cohesion", label: "视觉统一性", value: 86 },
          { key: "character", label: "角色辨识度", value: 82 },
        ] },
        iterations: [{ round: 1, assessment: { score: 84, confidence: 88, feedback: "角色辨识度高，视觉统一性强。", metrics: [] }, at: t5 }],
        startedAt: t4,
      }),
      stage("st3", "scene_gen", "场景生成", "关键场景概念设计与背景图生成", "pending"),
      stage("stg-previs-demo", "previs", "空间预演台", "场景摆位与机位规划，人工确认后进入视频生成", "pending", {
        isCheckpoint: true,
      }),
      stage("st4", "video_gen", "视频生成", "分镜驱动逐镜头生成视频片段", "pending", { gate: true, gateAgentName: "视觉质检" }),
      stage("st5", "voiceover", "配音合成", "角色对白与旁白 TTS 合成", "pending"),
      stage("st6", "editing", "剪辑合成", "镜头剪辑、音画同步与成片渲染", "pending", { isCheckpoint: true }),
    ],
  }
}

/** 项目 2：雾港迷案（已完成，全链路通过） */
export function buildFogHarborProject(): Project {
  const d0 = new Date(now.getTime() - 1000 * 60 * 60 * 26).toISOString()
  const d3 = new Date(now.getTime() - 1000 * 60 * 60 * 23).toISOString()
  const d4 = new Date(now.getTime() - 1000 * 60 * 60 * 22).toISOString()
  const d5 = new Date(now.getTime() - 1000 * 60 * 60 * 21).toISOString()
  const d6 = new Date(now.getTime() - 1000 * 60 * 60 * 20).toISOString()
  const d7 = new Date(now.getTime() - 1000 * 60 * 60 * 19).toISOString()
  const d8 = new Date(now.getTime() - 1000 * 60 * 60 * 18).toISOString()

  return {
    id: "prj-fogharbor",
    title: "雾港迷案",
    premise: "港口档案员发现三十年前一桩被掩盖的沉船案与自己身世有关",
    genre: "悬疑",
    style: "黑色电影",
    durationSec: 240,
    aspectRatio: "16:9",
    quality: "standard",
    template: "full",
    interventionMode: "guided",
    assets: [
      { assetId: "ast-chenmo", role: "主角陈默" },
      { assetId: "ast-suvan", role: "配角苏晚" },
      { assetId: "ast-fogharbor", role: "主场景：雾港码头" },
      { assetId: "ast-noir", role: "全片视觉基调" },
    ],
    status: "completed",
    progress: 100,
    avgScore: 89,
    cover: "from-slate-500/25 via-cyan-500/10 to-slate-800/25",
    createdAt: d0,
    updatedAt: d8,
    stages: [
      stage("f0", "screenplay", "剧本撰写", "基于创意大纲生成三幕结构完整剧本", "completed", {
        gate: true, gateAgentName: "剧本审查",
        artifact: { kind: "script", title: "雾港迷案 · 剧本全稿", summary: "三幕结构 · 悬疑类型 · 4 分钟", scenes: 14, words: 5100 },
        assessment: { score: 92, confidence: 95, feedback: "悬念设置精妙，反转有力，三幕节奏专业。", reviewer: "剧本审查", metrics: [
          { key: "structure", label: "结构完整度", value: 93 }, { key: "conflict", label: "冲突密度", value: 90 }, { key: "dialogue", label: "对白质量", value: 92 },
        ] },
        iterations: [{ round: 1, assessment: { score: 92, confidence: 95, feedback: "悬念设置精妙。", metrics: [] }, at: d3 }],
        startedAt: d0, finishedAt: d3,
      }),
      stage("f1", "storyboard", "分镜脚本", "逐场景拆解镜头，标注景别与运镜", "completed", {
        gate: true, gateAgentName: "一致性守护",
        artifact: { kind: "storyboard", title: "雾港迷案 · 分镜脚本", summary: "14 场 · 41 镜 · 含景别/运镜标注", shots: 41 },
        assessment: { score: 87, confidence: 90, feedback: "镜头语言与黑色电影基调高度契合。", reviewer: "一致性守护", metrics: [
          { key: "shot_logic", label: "镜头逻辑", value: 88 }, { key: "coverage", label: "叙事覆盖", value: 90 }, { key: "camera", label: "运镜专业度", value: 85 },
        ] },
        iterations: [{ round: 1, assessment: { score: 87, confidence: 90, feedback: "镜头语言契合基调。", metrics: [] }, at: d4 }],
        startedAt: d3, finishedAt: d4,
      }),
      stage("f2", "style_design", "风格与角色设定", "视觉风格指南、角色外观与参考图", "approved", {
        isCheckpoint: true,
        artifact: { kind: "style_guide", title: "雾港迷案 · 视觉风格指南", summary: "黑色电影 · 主角色 3 名 · 场景基调 4 类" },
        assessment: { score: 90, confidence: 93, feedback: "低照度硬光、阴影切割，角色冷峻。", metrics: [
          { key: "cohesion", label: "视觉统一性", value: 91 }, { key: "character", label: "角色辨识度", value: 89 },
        ] },
        iterations: [{ round: 1, assessment: { score: 90, confidence: 93, feedback: "角色冷峻统一。", metrics: [] }, at: d5 }],
        reviews: [{ at: d5, from: "human", text: "风格设定符合预期，批准进入下一环节。" }],
        startedAt: d4, finishedAt: d5,
      }),
      stage("f3", "scene_gen", "场景生成", "关键场景概念设计与背景图生成", "completed", {
        artifact: { kind: "scene", title: "雾港迷案 · 场景概念图", summary: "7 个关键场景 · 16:9 比例 · standard 画质", scenes: 7 },
        assessment: { score: 85, confidence: 88, feedback: "港口雾景氛围到位。", metrics: [
          { key: "fidelity", label: "还原度", value: 86 }, { key: "atmosphere", label: "氛围感", value: 90 },
        ] },
        iterations: [{ round: 1, assessment: { score: 85, confidence: 88, feedback: "氛围到位。", metrics: [] }, at: d6 }],
        startedAt: d5, finishedAt: d6,
      }),
      stage("f4", "video_gen", "视频生成", "分镜驱动逐镜头生成视频片段", "completed", {
        gate: true, gateAgentName: "视觉质检",
        artifact: { kind: "video", title: "雾港迷案 · 视频片段", summary: "41 镜合成 4 段 · 关键帧抽帧已比对", durationSec: 240 },
        assessment: { score: 86, confidence: 89, feedback: "画面稳定，角色一致性保持良好。", reviewer: "视觉质检", metrics: [
          { key: "stability", label: "画面稳定性", value: 88 }, { key: "match", label: "分镜匹配度", value: 87 }, { key: "consistency", label: "角色一致性", value: 85 },
        ] },
        iterations: [{ round: 1, assessment: { score: 86, confidence: 89, feedback: "画面稳定。", metrics: [] }, at: d7 }],
        startedAt: d6, finishedAt: d7,
      }),
      stage("f5", "voiceover", "配音合成", "角色对白与旁白 TTS 合成", "completed", {
        artifact: { kind: "voiceover", title: "雾港迷案 · 配音音轨", summary: "对白 22 条 + 旁白 3 条 · 三声线", durationSec: 196 },
        assessment: { score: 88, confidence: 90, feedback: "情绪传达准确，口型同步良好。", metrics: [
          { key: "synced", label: "口型同步", value: 90 }, { key: "emotion", label: "情绪传达", value: 87 },
        ] },
        iterations: [{ round: 1, assessment: { score: 88, confidence: 90, feedback: "情绪传达准确。", metrics: [] }, at: d8 }],
        startedAt: d7, finishedAt: d8,
      }),
      stage("f6", "editing", "剪辑合成", "镜头剪辑、音画同步与成片渲染", "approved", {
        isCheckpoint: true,
        artifact: { kind: "final_cut", title: "雾港迷案 · 成片", summary: "4 分钟 · 16:9 · standard 画质 · 含字幕与混音", durationSec: 240, scenes: 14 },
        assessment: { score: 91, confidence: 94, feedback: "节奏紧致，音画同步，可直接交付。", metrics: [
          { key: "pacing", label: "节奏把控", value: 92 }, { key: "sync", label: "音画同步", value: 93 }, { key: "continuity", label: "连续性", value: 89 },
        ] },
        iterations: [{ round: 1, assessment: { score: 91, confidence: 94, feedback: "节奏紧致。", metrics: [] }, at: d8 }],
        reviews: [{ at: d8, from: "human", text: "成片确认，导出交付。" }],
        startedAt: d7, finishedAt: d8,
      }),
    ],
  }
}

/** 项目 3：夏日来信（待启动，快速模板） */
export function buildSummerLetterProject(): Project {
  const c0 = new Date(now.getTime() - 1000 * 60 * 8).toISOString()
  return {
    id: "prj-summer-letter",
    title: "夏日来信",
    premise: "一封迟到二十年的信，把两个曾经的笔友重新联系起来",
    genre: "爱情",
    style: "治愈系",
    durationSec: 60,
    aspectRatio: "9:16",
    quality: "draft",
    template: "quick",
    interventionMode: "auto",
    assets: [
      { assetId: "ast-linche", role: "笔友主角" },
      { assetId: "ast-oldletter", role: "关键道具：旧信件" },
      { assetId: "ast-oldpost", role: "主场景：老邮局" },
      { assetId: "ast-healing", role: "全片视觉基调" },
    ],
    status: "queued",
    progress: 0,
    cover: "from-amber-400/20 via-orange-300/10 to-rose-400/20",
    createdAt: c0,
    updatedAt: c0,
    stages: [
      stage("q0", "screenplay", "剧本撰写", "生成精简剧本与分镜要点", "pending", { gate: true, gateAgentName: "剧本审查" }),
      stage("q1", "video_gen", "视频生成", "关键镜头视频快速生成", "pending", { gate: true, gateAgentName: "视觉质检" }),
      stage("q2", "editing", "成片合成", "粗剪合成成片预览", "pending", { isCheckpoint: true }),
    ],
  }
}

export function buildSeedEvents(projects: Project[]): EngineEvent[] {
  const st = projects[0]
  const fg = projects[1]
  const base = new Date(now.getTime() - 1000 * 60 * 6).toISOString()
  const ev = (
    projectId: string,
    projectTitle: string,
    kind: EngineEvent["kind"],
    text: string,
    at: string,
  ): EngineEvent => ({ id: uid("evt"), projectId, projectTitle, kind, text, at })
  return [
    ev(st.id, st.title, "waiting_approval", "「风格与角色设定」完成自评（84 分），等待人工确认", base),
    ev(st.id, st.title, "stage_completed", "「分镜脚本」通过一致性守护审查（82 分）", new Date(now.getTime() - 1000 * 60 * 12).toISOString()),
    ev(st.id, st.title, "gate_passed", "「剧本撰写」通过剧本审查（88 分）", new Date(now.getTime() - 1000 * 60 * 20).toISOString()),
    ev(fg.id, fg.title, "project_completed", "《雾港迷案》全流程完成，成片已交付", new Date(now.getTime() - 1000 * 60 * 60 * 18).toISOString()),
    ev(fg.id, fg.title, "approved", "「剪辑合成」成片已由人工确认并导出", new Date(now.getTime() - 1000 * 60 * 60 * 18).toISOString()),
  ]
}

export function createSeedState(): AppState {
  now = new Date()
  const stardust = buildStardustProject()
  const fogHarbor = buildFogHarborProject()
  const summer = buildSummerLetterProject()
  return {
    assets: SEED_ASSETS,
    projects: [stardust, fogHarbor, summer],
    events: buildSeedEvents([stardust, fogHarbor]),
    knowledgeBases: SEED_KNOWLEDGE,
    agents: SEED_AGENTS,
    models: SEED_MODELS,
    user: null,
  }
}
