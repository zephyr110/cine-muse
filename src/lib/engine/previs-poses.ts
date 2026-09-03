/**
 * 角色姿势系统（复刻 storyai-3d-director-desk 的"控制词表"设计）：
 * - 姿势是关节角度字典（{poseId, controls: JointName → [x,y,z] 度}），纯 JSON 可序列化，
 *   与骨骼/图元解耦——同一份预设驱动程序化人偶
 * - 体型为比例因子表（身高/肩宽/头围），作用于人偶几何
 */

export type JointName = "head" | "torso" | "armL" | "armR" | "legL" | "legR"
export type BodyType =
  | "standard" | "tall" | "short" | "heavy" | "slim" | "child" | "elder" | "hero"

export type JointRot = [number, number, number] // [x, y, z] 度
export type PoseControls = Record<JointName, JointRot>

export interface PosePreset {
  id: string
  name: string
  controls: PoseControls
}

const R: (deg: number) => number = (d) => d

export const BODY_TYPES: { id: BodyType; name: string; height: number; width: number; headSize: number }[] = [
  { id: "standard", name: "标准", height: 1.8, width: 1, headSize: 0.34 },
  { id: "tall", name: "高挑", height: 2.05, width: 0.98, headSize: 0.35 },
  { id: "short", name: "矮小", height: 1.5, width: 0.95, headSize: 0.33 },
  { id: "heavy", name: "壮实", height: 1.85, width: 1.35, headSize: 0.4 },
  { id: "slim", name: "纤细", height: 1.75, width: 0.8, headSize: 0.31 },
  { id: "child", name: "孩童", height: 1.1, width: 0.72, headSize: 0.32 },
  { id: "elder", name: "长者", height: 1.65, width: 0.95, headSize: 0.36 },
  { id: "hero", name: "英雄", height: 1.95, width: 1.2, headSize: 0.37 },
]

const ZERO: JointRot = [0, 0, 0]

/** 20 个姿势预设：关节角度字典（度） */
export const POSE_PRESETS: PosePreset[] = [
  { id: "stand", name: "站立", controls: { head: ZERO, torso: ZERO, armL: ZERO, armR: ZERO, legL: ZERO, legR: ZERO } },
  { id: "walk", name: "行走", controls: { head: [0, 0, 0], torso: [0, 0, -5], armL: [R(15), 0, 0], armR: [R(-15), 0, 0], legL: [R(25), 0, 0], legR: [R(-25), 0, 0] } },
  { id: "run", name: "奔跑", controls: { head: [0, 0, 0], torso: [R(-10), 0, 0], armL: [R(35), 0, 0], armR: [R(-35), 0, 0], legL: [R(45), 0, 0], legR: [R(-45), 0, 0] } },
  { id: "sit", name: "坐下", controls: { head: [0, 0, 0], torso: [R(-5), 0, 0], armL: [R(-10), 0, 0], armR: [R(-10), 0, 0], legL: [R(-90), 0, 0], legR: [R(-90), 0, 0] } },
  { id: "kneel", name: "跪地", controls: { head: [0, 0, 0], torso: [R(-10), 0, 0], armL: [R(-20), 0, 0], armR: [R(-20), 0, 0], legL: [R(-80), 0, 0], legR: [R(-80), 0, 0] } },
  { id: "lie", name: "躺卧", controls: { head: [R(-15), 0, 0], torso: [R(90), 0, 0], armL: [R(20), 0, 0], armR: [R(20), 0, 0], legL: ZERO, legR: ZERO } },
  { id: "jump", name: "跳跃", controls: { head: [0, 0, 0], torso: [R(-5), 0, 0], armL: [R(-90), 0, 0], armR: [R(-90), 0, 0], legL: [R(-20), 0, 0], legR: [R(-20), 0, 0] } },
  { id: "bow", name: "鞠躬", controls: { head: [R(-20), 0, 0], torso: [R(-60), 0, 0], armL: ZERO, armR: ZERO, legL: ZERO, legR: ZERO } },
  { id: "wave", name: "挥手", controls: { head: [0, 0, 0], torso: ZERO, armL: ZERO, armR: [R(-110), 0, R(20)], legL: ZERO, legR: ZERO } },
  { id: "point", name: "指向前方", controls: { head: [0, R(30), 0], torso: ZERO, armL: ZERO, armR: [R(-80), 0, 0], legL: ZERO, legR: ZERO } },
  { id: "think", name: "思考", controls: { head: [0, R(15), 0], torso: ZERO, armL: [0, 0, R(80)], armR: [0, 0, R(-60)], legL: ZERO, legR: ZERO } },
  { id: "talk", name: "交谈", controls: { head: [0, 0, R(10)], torso: ZERO, armL: [R(10), 0, 0], armR: [R(10), 0, 0], legL: ZERO, legR: ZERO } },
  { id: "greet", name: "致意", controls: { head: [0, 0, 0], torso: ZERO, armL: ZERO, armR: [R(-45), 0, 0], legL: ZERO, legR: ZERO } },
  { id: "fight", name: "战斗姿态", controls: { head: [0, 0, 0], torso: [0, 0, 0], armL: [R(-40), 0, R(20)], armR: [R(-40), 0, R(-20)], legL: [R(10), 0, 0], legR: [R(-10), 0, 0] } },
  { id: "hold", name: "持物", controls: { head: [0, 0, 0], torso: ZERO, armL: [R(-90), 0, 0], armR: [R(-90), 0, 0], legL: ZERO, legR: ZERO } },
  { id: "back", name: "背对", controls: { head: [0, R(30), 0], torso: [0, R(180), 0], armL: ZERO, armR: ZERO, legL: ZERO, legR: ZERO } },
  { id: "side", name: "侧身", controls: { head: [0, R(45), 0], torso: [0, R(90), 0], armL: ZERO, armR: ZERO, legL: ZERO, legR: ZERO } },
  { id: "dance", name: "起舞", controls: { head: [0, 0, 0], torso: [0, 0, R(10)], armL: [R(-60), 0, R(30)], armR: [R(-60), 0, R(-30)], legL: [R(20), 0, 0], legR: [R(-20), 0, 0] } },
  { id: "squat", name: "蹲踞", controls: { head: [0, 0, 0], torso: [R(-20), 0, 0], armL: [R(-10), 0, 0], armR: [R(-10), 0, 0], legL: [R(-60), 0, 0], legR: [R(-60), 0, 0] } },
  { id: "cheer", name: "欢呼", controls: { head: [R(10), 0, 0], torso: ZERO, armL: [R(-135), 0, 0], armR: [R(-135), 0, 0], legL: ZERO, legR: ZERO } },
]

export const POSE_PRESET_BY_ID: Record<string, PosePreset> = Object.fromEntries(
  POSE_PRESETS.map((p) => [p.id, p]),
)

export const BODY_TYPE_BY_ID: Record<string, (typeof BODY_TYPES)[number]> = Object.fromEntries(
  BODY_TYPES.map((b) => [b.id, b]),
)

/** 关节滑杆范围（度） */
export const JOINT_LIMITS: Record<JointName, [number, number]> = {
  head: [-60, 60],
  torso: [-180, 180], // y 轴支持水平转身（背对/侧身）
  armL: [-180, 90],
  armR: [-180, 90],
  legL: [-120, 45],
  legR: [-120, 45],
}

export const JOINT_LABELS: Record<JointName, string> = {
  head: "头部",
  torso: "躯干",
  armL: "左臂",
  armR: "右臂",
  legL: "左腿",
  legR: "右腿",
}
