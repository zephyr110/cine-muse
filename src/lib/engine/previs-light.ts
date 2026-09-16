/**
 * 附加光源（平行光）纯逻辑：命名 / 默认值 / 阴影相机拟合 / 拾取哨兵。
 *
 * 与机位同构：position → target 定方向，故拖动语义直接复用 previs-camera 的 reframeCamera
 * （视距保持）——「移动光源」= 平移整条光线，朝向只由 rotate 改变。
 *
 * 阴影相机不能沿用默认主光的固定 ±10 盒：附加光源的位姿由用户随意摆放，固定盒会让
 * 移远的光源失去阴影（视锥覆盖不到舞台）。故按「以 target 为球心、覆盖全部布景项的
 * 包围球」拟合正交视锥——球内任意点沿光轴的投影必落在半径内，半径即半宽。
 */

import type { PrevisLight } from "@/lib/types"

/** 位姿（光源的几何子集；fov 无对应物） */
export interface PrevisLightPose {
  position: [number, number, number]
  target: [number, number, number]
}

/** 视口 userData.itemId 哨兵：命中盒 → ownerId → 光源 id（机位用 __camera__，光源需带 id） */
export const LIGHT_OWNER_PREFIX = "__light__:"

export function lightOwnerId(id: string): string {
  return `${LIGHT_OWNER_PREFIX}${id}`
}

/** ownerId 反解：非光源（图元/机位/空）返回 null */
export function parseLightOwnerId(owner: string | null): string | null {
  if (!owner || !owner.startsWith(LIGHT_OWNER_PREFIX)) return null
  const id = owner.slice(LIGHT_OWNER_PREFIX.length)
  return id === "" ? null : id
}

/** 默认位姿：右上前方照向舞台中心（与默认主光同象限，新增即有形，不必先拖） */
export const DEFAULT_LIGHT_POSE: PrevisLightPose = { position: [6, 8, 4], target: [0, 0, 0] }
export const DEFAULT_LIGHT_INTENSITY = 1.2
/** 强度滑杆/输入范围（0 = 关灯但保留摆位；上限防误输入把场景打爆） */
export const LIGHT_INTENSITY_RANGE = { min: 0, max: 8 } as const

/** 光源名：取第一个未被占用的 光源NN —— 删除中间某盏后再新增不会重名（列表以名相称） */
export function nextLightName(lights: readonly PrevisLight[]): string {
  const used = new Set(lights.map((l) => l.name))
  for (let n = 1; ; n++) {
    const name = `光源${String(n).padStart(2, "0")}`
    if (!used.has(name)) return name
  }
}

/** 强度收口：滑杆与输入框共用（越界/NaN 一律夹回量程，非有限值回落到默认强度） */
export function clampLightIntensity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LIGHT_INTENSITY
  return Math.min(LIGHT_INTENSITY_RANGE.max, Math.max(LIGHT_INTENSITY_RANGE.min, value))
}

/** 新增光源（id 由调用方生成，便于沿用编辑器的 randomItemId 惯例） */
export function makeLight(id: string, lights: readonly PrevisLight[]): PrevisLight {
  return {
    id,
    name: nextLightName(lights),
    position: [...DEFAULT_LIGHT_POSE.position],
    target: [...DEFAULT_LIGHT_POSE.target],
    intensity: DEFAULT_LIGHT_INTENSITY,
    castShadow: true,
  }
}

/** 舞台包围球半径下限：空场景/单点布景也要有可辨认的阴影范围 */
export const STAGE_MIN_RADIUS = 6
/** 包围球余量：布景项自身有体积，且留一点边缘，免得贴边物体的阴影被裁掉 */
export const STAGE_MARGIN = 3

/**
 * 以 center（光源 target）为球心、罩住全部布景项的包围球半径。
 * 只取 position 的水平距离——布景项高度远小于舞台跨度，垂直分量由 near/far 覆盖。
 */
export function stageRadius(
  items: readonly { position: readonly [number, number, number] }[],
  center: readonly [number, number, number],
): number {
  let far = 0
  for (const item of items) {
    const d = Math.hypot(item.position[0] - center[0], item.position[2] - center[2])
    if (d > far) far = d
  }
  return Math.max(STAGE_MIN_RADIUS, far + STAGE_MARGIN)
}

/** 阴影贴图覆盖余量（半宽 = 半径 × 该系数）：正交视锥贴边处采样精度最低，留一点富裕 */
export const SHADOW_COVER_MARGIN = 1.15
/** 深度方向余量：near/far 沿光轴以「灯距 ± 半径」收放，再各留一点 */
export const SHADOW_DEPTH_PAD = 4
/** 灯与目标重合时的最小灯距（防 near/far 退化） */
const MIN_LIGHT_DISTANCE = 0.1

/**
 * 平行光阴影相机拟合：正交视锥半宽 = 舞台半径 × 余量；near/far 按灯距 ± 半径。
 * 灯在球内（灯距 < 半径）时 near 夹到 0.1——近裁面在球内不影响覆盖（球被相机包住）。
 */
export function fitShadowCamera(
  pose: PrevisLightPose,
  radius: number,
): { halfExtent: number; near: number; far: number } {
  const distance = Math.max(
    Math.hypot(
      pose.position[0] - pose.target[0],
      pose.position[1] - pose.target[1],
      pose.position[2] - pose.target[2],
    ),
    MIN_LIGHT_DISTANCE,
  )
  return {
    halfExtent: radius * SHADOW_COVER_MARGIN,
    near: Math.max(0.1, distance - radius),
    far: distance + radius + SHADOW_DEPTH_PAD,
  }
}
