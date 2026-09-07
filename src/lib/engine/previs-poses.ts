/**
 * 角色姿势系统（storyai UE4 词表 v3，控件数据 = 单值字典）：
 * - controls 形状 v3：`Record<string, number>`——键 = 词表（见 POSE_VOCAB）、值 = 度；
 *   其中 `body.offsetY` 为长度单位（米，负数下蹲），语义同 REF
 * - 词表/预设/体型数值 1:1 移植自 REF：
 *   - src/editor/presets/skeletonMappings.ts（词表骨架 25 键）
 *   - src/editor/presets/mannequinPosePresets.ts（20 预设，controls 逐字）
 *   - src/editor/runtime/mannequin/bodyTypes.ts（8 体型 id/名称）
 *   - src/editor/runtime/mannequin/mannequinPose.ts（姿势限位：chibi ±58 / child ±72 / 其余 ±90）
 *   - src/editor/panels/CharacterPanel.tsx（11 组滑杆定义与文案：组标题/键/滑杆 label）
 * - 词表滑杆范围照 REF 面板常量（CharacterPanel：全部 ±90、step 1）；
 *   运行时限位（±58/72/90，bodyType 相关）在 previs-ue4-rig 应用时生效（见该模块）
 *
 * 数值 1:1 约束：预设 id/名称/controls 逐字；体型 id/名称与 REF 一致。
 * BODY_TYPES.height 为「展示/程序化参考身高」（骨缩放以 previs-ue4-rig 表为准），
 * 推导见 BODY_TYPES 注释。
 */

import type { Ue4BodyType } from "./previs-ue4-rig"

/** 词表键（数据定义键集合；运行期字符串） */
export type PoseKey = string

/**
 * 词表全键（38）：
 * 1) REF presets/skeletonMappings.ts HUMANOID_CONTROL_KEYS 25 键逐字（顺序一致）；
 * 2) body.offsetY（REF 预设下蹲键，米）；
 * 3) hand/foot 各三轴（UE4 rig 驱动键：left/rightHand/Foot.{pitch,roll,twist}，
 *    REF ue4MannequinRig 每骨旋转表消费；presets 已用 roll/pitch，twist 留待滑杆扩展）。
 */
export const POSE_VOCAB: readonly string[] = [
  // —— REF skeletonMappings.ts（25 键，逐字）——
  "body.pitch",
  "body.yaw",
  "body.roll",
  "torso.pitch",
  "torso.yaw",
  "torso.roll",
  "head.pitch",
  "head.yaw",
  "head.roll",
  "leftShoulder.pitch",
  "leftShoulder.spread",
  "leftShoulder.twist",
  "rightShoulder.pitch",
  "rightShoulder.spread",
  "rightShoulder.twist",
  "leftElbow.bend",
  "rightElbow.bend",
  "leftHip.pitch",
  "leftHip.spread",
  "leftHip.twist",
  "rightHip.pitch",
  "rightHip.spread",
  "rightHip.twist",
  "leftKnee.bend",
  "rightKnee.bend",
  // —— body.offsetY（长度单位米；REF 预设 -0.43..-0.12）——
  "body.offsetY",
  // —— hand/foot 三轴（REF ue4MannequinRig 驱动键）——
  "leftHand.pitch",
  "leftHand.roll",
  "leftHand.twist",
  "rightHand.pitch",
  "rightHand.roll",
  "rightHand.twist",
  "leftFoot.pitch",
  "leftFoot.roll",
  "leftFoot.twist",
  "rightFoot.pitch",
  "rightFoot.roll",
  "rightFoot.twist",
]

export interface PosePreset {
  id: string
  name: string
  controls: Record<string, number>
}

/**
 * 20 个姿势预设（数值/名称逐字移植自 REF mannequinPosePresets.ts；
 * REF 的 label 字段按 brief 命名 name 收口）。controls 单值字典（度；body.offsetY 为米）。
 * 说明：个别预设值超出滑杆 ±90（如 kneel-two 膝 bend 126、crouch 112、push 肩 pitch 92）——
 * REF 同表同语义：按原值存储，应用时按体型限位钳制（chibi/child ±58/±72、其余 ±90）。
 */
export const POSE_PRESETS: PosePreset[] = [
  { id: "stand", name: "站立", controls: {} },
  {
    id: "t-pose",
    name: "T型",
    controls: {
      "leftShoulder.spread": -70,
      "rightShoulder.spread": 70,
      "leftShoulder.pitch": 15,
      "rightShoulder.pitch": 15,
      "leftElbow.bend": 10,
      "rightElbow.bend": 10,
    },
  },
  {
    id: "walk",
    name: "行走",
    controls: {
      "leftShoulder.pitch": 20,
      "rightShoulder.pitch": -20,
      "leftHip.pitch": -20,
      "rightHip.pitch": 20,
      "leftKnee.bend": 12,
      "rightKnee.bend": 4,
    },
  },
  {
    id: "run",
    name: "跑步",
    controls: {
      "leftShoulder.pitch": 42,
      "rightShoulder.pitch": -42,
      "leftHip.pitch": -35,
      "rightHip.pitch": 40,
      "leftKnee.bend": 28,
      "rightKnee.bend": 18,
    },
  },
  {
    id: "sit",
    name: "坐姿",
    controls: {
      "torso.pitch": -10,
      "leftHip.pitch": 80,
      "rightHip.pitch": 80,
      "leftKnee.bend": 90,
      "rightKnee.bend": 90,
    },
  },
  {
    id: "crouch",
    name: "蹲下",
    controls: {
      "body.offsetY": -0.43,
      "body.pitch": -26,
      "torso.pitch": -24,
      "head.pitch": 22,
      "leftHip.pitch": 92,
      "rightHip.pitch": 92,
      "leftKnee.bend": 112,
      "rightKnee.bend": 112,
      "leftShoulder.pitch": 52,
      "rightShoulder.pitch": 50,
      "leftShoulder.spread": -10,
      "rightShoulder.spread": 10,
      "leftElbow.bend": 80,
      "rightElbow.bend": 76,
    },
  },
  {
    id: "kneel-one",
    name: "单膝跪",
    controls: {
      "body.offsetY": -0.42,
      "body.pitch": -16,
      "torso.pitch": -10,
      "head.pitch": 12,
      "leftHip.pitch": 68,
      "leftKnee.bend": 86,
      "leftFoot.pitch": 20,
      "rightHip.pitch": -15,
      "rightKnee.bend": 80,
      "rightFoot.pitch": 60,
      "leftShoulder.pitch": 5,
      "leftShoulder.spread": 10,
      "leftShoulder.twist": -10,
      "leftElbow.bend": 30,
      "rightShoulder.pitch": -18,
      "rightShoulder.spread": 10,
      "rightElbow.bend": 18,
    },
  },
  {
    id: "kneel-two",
    name: "双膝跪",
    controls: {
      "body.offsetY": -0.4,
      "body.pitch": 2,
      "torso.pitch": 8,
      "head.pitch": -2,
      "leftShoulder.pitch": -10,
      "rightShoulder.pitch": -10,
      "leftShoulder.spread": -5,
      "rightShoulder.spread": 5,
      "leftElbow.bend": 8,
      "rightElbow.bend": 8,
      "leftHip.pitch": -8,
      "rightHip.pitch": -8,
      "leftKnee.bend": 126,
      "rightKnee.bend": 126,
      "leftFoot.pitch": -20,
      "rightFoot.pitch": -20,
    },
  },
  {
    id: "hands-on-hips",
    name: "叉腰",
    controls: {
      "leftShoulder.pitch": -36,
      "rightShoulder.pitch": -36,
      "leftShoulder.spread": 0,
      "rightShoulder.spread": 0,
      "leftShoulder.twist": 80,
      "rightShoulder.twist": -80,
      "leftElbow.bend": 86,
      "rightElbow.bend": 86,
      "leftHand.roll": -35,
      "rightHand.roll": 35,
    },
  },
  {
    id: "lean",
    name: "倚靠",
    controls: {
      "body.roll": -10,
      "leftHip.spread": -8,
      "rightHip.spread": 8,
      "head.roll": 6,
    },
  },
  {
    id: "bow",
    name: "鞠躬",
    controls: {
      "body.pitch": -46,
      "torso.pitch": -10,
      "head.pitch": 20,
      "leftHip.pitch": 49,
      "rightHip.pitch": 49,
      "leftShoulder.pitch": 5,
      "rightShoulder.pitch": 5,
      "leftShoulder.spread": 10,
      "rightShoulder.spread": -10,
      "leftElbow.bend": 12,
      "rightElbow.bend": 12,
    },
  },
  {
    id: "think",
    name: "思考",
    controls: {
      "rightShoulder.pitch": 8,
      "rightShoulder.spread": 0,
      "rightShoulder.twist": -40,
      "rightElbow.bend": 90,
      "rightHand.roll": -40,
      "rightHand.pitch": 15,
      "rightHand.twist": -10,
      "leftShoulder.pitch": 8,
      "leftShoulder.spread": 0,
      "leftShoulder.twist": 40,
      "leftElbow.bend": 90,
    },
  },
  {
    id: "fight",
    name: "格斗",
    controls: {
      "body.yaw": -10,
      "body.pitch": 5,
      "torso.yaw": 8,
      "head.yaw": 8,
      "leftShoulder.pitch": 48,
      "leftShoulder.spread": -16,
      "leftShoulder.twist": 22,
      "rightShoulder.pitch": 30,
      "rightShoulder.spread": 0,
      "rightShoulder.twist": -22,
      "leftElbow.bend": 86,
      "rightElbow.bend": 84,
      "leftHip.spread": -18,
      "rightHip.spread": 22,
      "leftHip.pitch": 4,
      "rightHip.pitch": -6,
      "leftKnee.bend": 12,
      "rightKnee.bend": 18,
    },
  },
  {
    id: "kick",
    name: "踢球",
    controls: {
      "leftHip.pitch": -8,
      "rightHip.pitch": 58,
      "rightKnee.bend": 35,
      "leftShoulder.pitch": 18,
      "rightShoulder.pitch": -24,
    },
  },
  {
    id: "throw",
    name: "投掷",
    controls: {
      "body.offsetY": -0.12,
      "body.pitch": 5,
      "body.yaw": 14,
      "torso.yaw": -10,
      "head.yaw": 8,
      "rightShoulder.pitch": 76,
      "rightShoulder.spread": -14,
      "rightShoulder.twist": 28,
      "rightElbow.bend": 86,
      "rightHand.roll": 18,
      "rightHand.pitch": -12,
      "leftShoulder.pitch": 34,
      "leftShoulder.spread": 10,
      "leftShoulder.twist": 8,
      "leftElbow.bend": 54,
      "leftHand.pitch": -10,
      "leftHip.spread": -12,
      "rightHip.spread": 18,
      "leftHip.pitch": 24,
      "rightHip.pitch": -10,
      "leftKnee.bend": 30,
      "rightKnee.bend": 14,
      "leftFoot.pitch": -8,
      "rightFoot.roll": 6,
    },
  },
  {
    id: "push",
    name: "推进",
    controls: {
      "body.offsetY": -0.16,
      "body.pitch": 5,
      "body.yaw": 38,
      "torso.pitch": -4,
      "head.pitch": 6,
      "leftShoulder.pitch": 92,
      "rightShoulder.pitch": 92,
      "leftShoulder.spread": -11,
      "rightShoulder.spread": 11,
      "leftShoulder.twist": 6,
      "rightShoulder.twist": -6,
      "leftElbow.bend": 6,
      "rightElbow.bend": 6,
      "leftHand.pitch": -14,
      "rightHand.pitch": -14,
      "leftHip.spread": -12,
      "rightHip.spread": 14,
      "leftHip.pitch": 38,
      "rightHip.pitch": -20,
      "leftKnee.bend": 42,
      "rightKnee.bend": 20,
      "leftFoot.pitch": -6,
      "rightFoot.roll": 8,
    },
  },
  {
    id: "wave",
    name: "招手",
    controls: {
      "rightShoulder.pitch": 60,
      "rightShoulder.spread": 0,
      "rightShoulder.twist": 30,
      "rightElbow.bend": 90,
      "rightHand.roll": -20,
      "rightHand.pitch": 12,
      "rightHand.twist": 10,
      "leftShoulder.pitch": -10,
      "leftShoulder.spread": 8,
      "leftElbow.bend": 18,
      "leftHand.pitch": -8,
    },
  },
  {
    id: "reach",
    name: "伸手",
    controls: {
      "rightShoulder.pitch": 50,
      "rightElbow.bend": 12,
      "body.pitch": 0,
    },
  },
  {
    id: "cross-arms",
    name: "抱臂",
    controls: {
      "leftShoulder.pitch": 50,
      "leftShoulder.spread": -55,
      "leftShoulder.twist": 75,
      "leftElbow.bend": 50,
      "leftHand.roll": 0,
      "leftHand.pitch": -10,
      "rightShoulder.pitch": 90,
      "rightShoulder.spread": 55,
      "rightShoulder.twist": -45,
      "rightElbow.bend": 50,
      "rightHand.roll": 18,
      "rightHand.pitch": -10,
    },
  },
  {
    id: "phone",
    name: "看手机",
    controls: {
      "head.pitch": 18,
      "rightShoulder.pitch": 20,
      "rightShoulder.spread": -4,
      "rightShoulder.twist": -30,
      "rightElbow.bend": 82,
      "rightHand.roll": -30,
      "rightHand.pitch": 14,
      "rightHand.twist": 60,
      "leftShoulder.pitch": -10,
      "leftShoulder.spread": 8,
      "leftElbow.bend": 16,
      "leftHand.pitch": -8,
    },
  },
]

export const POSE_PRESET_BY_ID: Record<string, PosePreset> = Object.fromEntries(
  POSE_PRESETS.map((p) => [p.id, p]),
)

export interface BodyTypeEntry {
  id: Ue4BodyType
  /** 展示名（REF bodyTypes.ts label 逐字） */
  name: string
  /**
   * 展示/程序化回退参考身高（米）。UE4 骨缩放与整模缩放以 previs-ue4-rig 为准，
   * 本表仅为 UI 列表与程序化 fallback 的「贴地 crown 高」提示。
   * REF 无 UE4 素体逐型总高字段；按 REF 语义推导：
   *   height = getUE4LabelAnchorY(type)（REF ue4MannequinRig getUE4GroundedLabelY 整型表，
   *             = 运行时 bounds.max.y + label 空隙 0.18）
   *          − 0.18（REF schema/viewportLabels.ts VIEWPORT_OBJECT_LABEL_VERTICAL_GAP）
   * 即贴地素体中性站姿 crown 高度 ≈ 表值 − 0.18；与整模缩放系自洽
   * （如 chibi 0.56×1.86 ≈ 1.04 ≈ 1.0，teen 0.88×1.86 ≈ 1.64 ≈ 1.6）。
   */
  height: number
}

/** 8 款体型（id/名称逐字移植自 REF bodyTypes.ts CHARACTER_BODY_PRESETS） */
export const BODY_TYPES: BodyTypeEntry[] = [
  { id: "mannequin", name: "男性素体", height: 1.86 },
  { id: "female", name: "女性素体", height: 1.8 },
  { id: "broad", name: "宽厚素体", height: 1.9 },
  { id: "muscular", name: "健壮素体", height: 1.9 },
  { id: "slim", name: "纤细素体", height: 1.8 },
  { id: "teen", name: "少年素体", height: 1.6 },
  { id: "child", name: "儿童素体", height: 1.28 },
  { id: "chibi", name: "二头身", height: 1.0 },
]

export const BODY_TYPE_BY_ID: Record<string, BodyTypeEntry> = Object.fromEntries(
  BODY_TYPES.map((b) => [b.id, b]),
)

export interface PoseSliderDef {
  key: PoseKey
  label: string
  min: number
  max: number
}

export interface PoseGroup {
  id: string
  label: string
  sliders: PoseSliderDef[]
}

/** 转角滑杆范围（度）：REF 面板常量逐字（CharacterPanel InspectorRangeNumberField min=-90 max=90 step=1） */
const ROT: [number, number] = [-90, 90]

/**
 * 11 组滑杆（组标题/键序/滑杆 label 逐字移植自 REF CharacterPanel poseGroups，75-147 行；
 * 「身体」组按 brief 增 body.offsetY）。
 * 说明：
 * - 全部转角滑杆 ±90（同 REF 面板；REF 运行时按体型限位 ±58/±72/±90 钳制，见 previs-ue4-rig）；
 * - body.offsetY 无 REF 面板常量（REF 面板不暴露该键）——本表为 UI 数据自选：
 *   min −1（≈ 1.86m 素体半高，预设下蹲深 −0.43 的 2 倍余量）/ max 0.5（向上偏移实验，
 *   UE4 贴地会对正浮空模型吸地），单位米；Task 6 面板可再精调。
 */
export const POSE_GROUPS: PoseGroup[] = [
  {
    id: "body",
    label: "身体",
    sliders: [
      { key: "body.pitch", label: "前倾", min: ROT[0], max: ROT[1] },
      { key: "body.yaw", label: "转身", min: ROT[0], max: ROT[1] },
      { key: "body.roll", label: "侧倾", min: ROT[0], max: ROT[1] },
      { key: "body.offsetY", label: "垂直偏移", min: -1, max: 0.5 },
    ],
  },
  {
    id: "torso",
    label: "躯干",
    sliders: [
      { key: "torso.pitch", label: "前倾", min: ROT[0], max: ROT[1] },
      { key: "torso.yaw", label: "扭转", min: ROT[0], max: ROT[1] },
      { key: "torso.roll", label: "侧倾", min: ROT[0], max: ROT[1] },
    ],
  },
  {
    id: "head",
    label: "头部",
    sliders: [
      { key: "head.pitch", label: "点头", min: ROT[0], max: ROT[1] },
      { key: "head.yaw", label: "转头", min: ROT[0], max: ROT[1] },
      { key: "head.roll", label: "歪头", min: ROT[0], max: ROT[1] },
    ],
  },
  {
    id: "leftShoulder",
    label: "左肩",
    sliders: [
      { key: "leftShoulder.pitch", label: "前举", min: ROT[0], max: ROT[1] },
      { key: "leftShoulder.spread", label: "外展", min: ROT[0], max: ROT[1] },
      { key: "leftShoulder.twist", label: "扭转", min: ROT[0], max: ROT[1] },
    ],
  },
  {
    id: "rightShoulder",
    label: "右肩",
    sliders: [
      { key: "rightShoulder.pitch", label: "前举", min: ROT[0], max: ROT[1] },
      { key: "rightShoulder.spread", label: "外展", min: ROT[0], max: ROT[1] },
      { key: "rightShoulder.twist", label: "扭转", min: ROT[0], max: ROT[1] },
    ],
  },
  {
    id: "leftElbow",
    label: "左肘",
    sliders: [{ key: "leftElbow.bend", label: "弯曲", min: ROT[0], max: ROT[1] }],
  },
  {
    id: "rightElbow",
    label: "右肘",
    sliders: [{ key: "rightElbow.bend", label: "弯曲", min: ROT[0], max: ROT[1] }],
  },
  {
    id: "leftHip",
    label: "左髋",
    sliders: [
      { key: "leftHip.pitch", label: "前抬", min: ROT[0], max: ROT[1] },
      { key: "leftHip.spread", label: "外展", min: ROT[0], max: ROT[1] },
      { key: "leftHip.twist", label: "扭转", min: ROT[0], max: ROT[1] },
    ],
  },
  {
    id: "rightHip",
    label: "右髋",
    sliders: [
      { key: "rightHip.pitch", label: "前抬", min: ROT[0], max: ROT[1] },
      { key: "rightHip.spread", label: "外展", min: ROT[0], max: ROT[1] },
      { key: "rightHip.twist", label: "扭转", min: ROT[0], max: ROT[1] },
    ],
  },
  {
    id: "leftKnee",
    label: "左膝",
    sliders: [{ key: "leftKnee.bend", label: "弯曲", min: ROT[0], max: ROT[1] }],
  },
  {
    id: "rightKnee",
    label: "右膝",
    sliders: [{ key: "rightKnee.bend", label: "弯曲", min: ROT[0], max: ROT[1] }],
  },
]

/**
 * 各体型转角限位（度）——UI 滑杆数据参考（供 Task 6 面板按体型收窄）。
 * 逐字移植自 REF mannequinPose.ts:12-21（getBodyTypePoseLimit）：
 *   chibi ±58 / child ±72 / 其余 ±90；
 * 运行时限位（真实钳制）在 previs-ue4-rig.ts applyUE4Rig 内生效（同表私有函数）。
 */
export const POSE_LIMIT_BY_BODY_TYPE: Record<Ue4BodyType, number> = {
  mannequin: 90,
  female: 90,
  broad: 90,
  muscular: 90,
  slim: 90,
  teen: 90,
  child: 72,
  chibi: 58,
}
