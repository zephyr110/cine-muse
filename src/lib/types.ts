/**
 * Cine Muse 领域模型
 * 与《02-产品化实施方案》第五章对齐；引擎契约见 engine/reducer.ts
 */

export type StageStatus =
  | "pending"
  | "running"
  | "iterating" // 门禁打回后重跑中
  | "waiting_approval" // 人工确认节点挂起
  | "approved" // 人工批准
  | "rejected" // 人工打回（将重跑）
  | "completed" // 门禁通过 / 非门禁节点完成
  | "failed"
  | "skipped"

export type ArtifactKind =
  | "script"
  | "storyboard"
  | "style_guide"
  | "scene"
  | "video"
  | "voiceover"
  | "final_cut"
  | "previs"

export interface QualityMetric {
  key: string
  label: string
  value: number // 0-100
}

export interface QualityAssessment {
  score: number // 0-100
  metrics: QualityMetric[]
  confidence: number // 0-100
  feedback: string // 自评意见
  reviewer?: string // 门禁审查 Agent 名
}

export interface Artifact {
  kind: ArtifactKind
  title: string
  summary: string
  content?: string // 文本产出（剧本/分镜/风格指南）
  shots?: number // 分镜数
  words?: number // 字数
  durationSec?: number // 视频/配音/成片时长
  scenes?: number
}

export interface BlockingItem {
  id: string
  kind: "character" | "prop" | "terrain"
  name: string
  position: [number, number, number]
  rotationY: number
  scale: number
}

export interface PrevisShot {
  shotIndex: number
  camera: { position: [number, number, number]; target: [number, number, number]; fov: number }
  blocking: BlockingItem[]
  previewSvg: string
  depthSvg: string
  edgeSvg: string
}

/** 判别联合：previs 专用载荷，与通用 Artifact 平级 */
export interface PrevisArtifact extends Artifact {
  kind: "previs"
  shots: PrevisShot[]
}

export interface Iteration {
  round: number
  reason?: string // 打回原因（门禁/人工）
  assessment: QualityAssessment
  at: string // ISO
}

export interface ReviewComment {
  at: string
  from: "engine" | "human"
  text: string
}

export interface WorkflowStage {
  id: string
  agentId: string // 对应 AgentMeta.id
  title: string
  description: string
  status: StageStatus
  isCheckpoint: boolean // 人工确认节点
  gate?: boolean // 有质量门禁
  gateAgentName?: string // 门禁审查 Agent 名
  artifact?: Artifact
  assessment?: QualityAssessment
  iterations: Iteration[] // 含首轮的完整迭代记录
  reviews: ReviewComment[]
  gateRetries: number // 门禁打回次数（上限 3）
  progress: number // 0-100（running 时动画推进）
  /** 参考附件：上游 previs 产物注入（只读快照，重流转时更新） */
  references?: { kind: "previs"; depthUrl: string; edgeUrl: string }[]
  startedAt?: string
  finishedAt?: string
}

export type ProjectStatus =
  | "draft"
  | "queued"
  | "executing"
  | "waiting_approval"
  | "completed"
  | "failed"

export type WorkflowTemplate = "full" | "quick"

/* ---------- 资产库（角色/场景/道具/风格 素材） ---------- */

export type AssetCategory = "character" | "scene" | "prop" | "style"

export const ASSET_CATEGORY_LABEL: Record<AssetCategory, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
  style: "风格",
}

/** 素材文件类型（主流格式白名单见 server/index.js FILE_TYPE_RULES） */
export type AssetFileKind = "image" | "video" | "audio"

export interface AssetFile {
  url: string // 相对路径 /uploads/xxx.ext，渲染时拼接 API_URL
  kind: AssetFileKind
  mimeType: string
  size: number // 字节
  name: string // 原始文件名
}

export interface Asset {
  id: string
  name: string
  category: AssetCategory
  description: string // 视觉/设定描述（真实版为素材文件 + 元数据）
  tags: string[] // 检索标签（genre/风格/年代等）
  color: string // 封面渐变色占位（无文件时展示）
  file?: AssetFile // 用户上传的素材文件；无文件时保持描述卡
  createdAt: string
  updatedAt: string
}

/** 项目对资产库的引用（资产全局维护，项目按需绑定） */
export interface AssetBinding {
  assetId: string
  role: string // 在本项目中的用途说明，如"主角阿岚"/"雨夜回收站"
}

/* ---------- 干预深度谱系 ----------
 * L0 auto   全自动：流程零打断，不消费资产绑定
 * L1 guided 引导式（默认）：不打断流程，但 agents 消费绑定资产作为强约束
 * L2 review 审查式：关键节点（风格设定/成片）暂停人工确认
 * L3 manual 手作式：审查式 + 每个环节产出允许手动改写
 */
export type InterventionMode = "auto" | "guided" | "review" | "manual"

/** 干预模式展示名（单一事实来源：reducer 事件文案 / wizard / 项目卡共用） */
export const MODE_LABEL: Record<InterventionMode, string> = {
  auto: "全自动",
  guided: "引导式",
  review: "审查式",
  manual: "手作式",
}

export interface Project {
  id: string
  title: string
  premise: string // 一句话创意
  genre: string
  style: string // 风格预设
  durationSec: number
  aspectRatio: "16:9" | "9:16" | "1:1"
  quality: "draft" | "standard" | "hd"
  template: WorkflowTemplate
  interventionMode: InterventionMode
  assets: AssetBinding[]
  /** 创建时选择的增强 Sub-Agent（旧数据可缺省） */
  boostAgentIds?: string[]
  status: ProjectStatus
  stages: WorkflowStage[]
  progress: number // 完成度 0-100
  avgScore?: number
  cover: string // 渐变色占位
  createdAt: string
  updatedAt: string
}

export type EventKind =
  | "project_created"
  | "project_started"
  | "stage_started"
  | "stage_completed"
  | "gate_passed"
  | "gate_rejected"
  | "waiting_approval"
  | "approved"
  | "rejected"
  | "skipped"
  | "retry"
  | "project_completed"
  | "project_failed"
  | "mode_changed"
  | "asset_bound"
  | "asset_unbound"
  | "artifact_edited"

export interface EngineEvent {
  id: string
  projectId: string
  projectTitle: string
  kind: EventKind
  text: string
  at: string // ISO
}

export interface KnowledgeBase {
  id: string
  name: string
  description: string
  entries: number
  enabled: boolean
  icon: string // lucide 图标名（由组件映射）
  serves: string[] // 服务对象（Agent 名）
  updatedAt: string
}

export type AgentGroup = "pre" | "production" | "post" | "qa"

export const AGENT_GROUP_LABEL: Record<AgentGroup, string> = {
  pre: "前期筹备组",
  production: "拍摄制作组",
  post: "后期制作组",
  qa: "质量保障组",
}

export interface AgentMeta {
  id: string
  name: string
  group: AgentGroup
  description: string
  status: "active" | "degraded" | "disabled"
  modelId: string // 绑定的模型适配器 id
  maxIterations: number
  usesRag: string[] // 使用的知识库 id
  avgScore?: number
}

export type ModelKind = "llm" | "video" | "tts"

export interface ModelOption {
  id: string
  label: string
}

export interface ModelConfig {
  id: ModelKind
  name: string
  provider: string
  options: ModelOption[]
  selected: string
  apiKeyConfigured: boolean
  status: "connected" | "not_configured" | "error"
}

export interface AppState {
  assets: Asset[]
  projects: Project[]
  events: EngineEvent[] // 倒序（新在前）
  knowledgeBases: KnowledgeBase[]
  agents: AgentMeta[]
  models: ModelConfig[]
  user: { email: string; name: string } | null
}

/* ---------- Action 契约（引擎与 UI 通信边界） ---------- */

export interface NewProjectInput {
  title: string
  premise: string
  genre: string
  style: string
  durationSec: number
  aspectRatio: Project["aspectRatio"]
  quality: Project["quality"]
  template: WorkflowTemplate
  interventionMode: InterventionMode
  assetIds: string[] // 绑定的资产 id（角色/场景/道具/风格卡）
  boostAgentIds: string[] // 增强 Sub-Agent id 列表（按锚点插入核心链，见 templates.BOOST_SLOTS）
}

export type Action =
  | { type: "HYDRATE"; state: AppState }
  | { type: "CREATE_PROJECT"; input: NewProjectInput; now: string }
  | { type: "START_PROJECT"; projectId: string; now: string }
  | { type: "TICK"; now: string }
  | { type: "APPROVE_STAGE"; projectId: string; stageId: string; now: string }
  | {
      type: "REJECT_STAGE"
      projectId: string
      stageId: string
      reason: string
      now: string
    }
  | { type: "SKIP_STAGE"; projectId: string; stageId: string; now: string }
  | { type: "TOGGLE_KNOWLEDGE_BASE"; kbId: string; now: string }
  | { type: "SELECT_MODEL"; kind: ModelKind; modelId: string; now: string }
  | { type: "RESET_DEMO"; now: string }
  | {
      type: "CREATE_ASSET"
      input: Omit<Asset, "id" | "createdAt" | "updatedAt">
      now: string
    }
  | { type: "UPDATE_ASSET"; assetId: string; patch: Partial<Asset>; now: string }
  | { type: "DELETE_ASSET"; assetId: string; now: string }
  | {
      type: "BIND_ASSET"
      projectId: string
      assetId: string
      role?: string
      now: string
    }
  | { type: "UNBIND_ASSET"; projectId: string; assetId: string; now: string }
  | {
      type: "SET_INTERVENTION_MODE"
      projectId: string
      mode: InterventionMode
      now: string
    }
  | {
      type: "EDIT_ARTIFACT"
      projectId: string
      stageId: string
      content: string
      now: string
    }
  | { type: "LOGIN"; email: string; name: string }
  | { type: "LOGOUT" }
