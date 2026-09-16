import { describe, expect, it } from "vitest"

import type { PrevisLight } from "@/lib/types"
import {
  DEFAULT_LIGHT_INTENSITY,
  LIGHT_INTENSITY_RANGE,
  SHADOW_COVER_MARGIN,
  SHADOW_DEPTH_PAD,
  STAGE_MARGIN,
  STAGE_MIN_RADIUS,
  clampLightIntensity,
  fitShadowCamera,
  lightOwnerId,
  makeLight,
  nextLightName,
  parseLightOwnerId,
  stageRadius,
  type PrevisLightPose,
} from "./previs-light"

const light = (id: string, name: string): PrevisLight => ({
  id,
  name,
  position: [1, 2, 3],
  target: [0, 0, 0],
  intensity: 1,
  castShadow: true,
})

describe("previs-light 拾取哨兵", () => {
  it("ownerId 往返：lightOwnerId → parseLightOwnerId 得回原 id", () => {
    expect(parseLightOwnerId(lightOwnerId("lt-1"))).toBe("lt-1")
  })

  it("非光源 owner 一律 null（图元 id / 机位 / 地面 / 空）", () => {
    expect(parseLightOwnerId("ch-abc")).toBeNull()
    expect(parseLightOwnerId("__camera__")).toBeNull()
    expect(parseLightOwnerId("__ground__")).toBeNull()
    expect(parseLightOwnerId(null)).toBeNull()
    expect(parseLightOwnerId("__light__:")).toBeNull()
  })
})

describe("previs-light 命名与默认值", () => {
  it("空列表 → 光源01；按首个空闲编号补齐，删除中间项后不重名", () => {
    expect(nextLightName([])).toBe("光源01")
    expect(nextLightName([light("a", "光源01")])).toBe("光源02")
    // 删掉 01 只剩 02 → 新增补 01（不是 02 重名）
    expect(nextLightName([light("b", "光源02")])).toBe("光源01")
    expect(nextLightName([light("a", "光源01"), light("c", "光源03")])).toBe("光源02")
  })

  it("自定义名不参与编号占位（按表内自有名判断，不做数字解析）", () => {
    expect(nextLightName([light("a", "太阳")])).toBe("光源01")
  })

  it("clampLightIntensity：量程内原样、越界夹回、非有限值回落默认强度", () => {
    expect(clampLightIntensity(2.5)).toBe(2.5)
    expect(clampLightIntensity(-3)).toBe(LIGHT_INTENSITY_RANGE.min)
    expect(clampLightIntensity(99)).toBe(LIGHT_INTENSITY_RANGE.max)
    expect(clampLightIntensity(Number.NaN)).toBe(DEFAULT_LIGHT_INTENSITY)
    expect(clampLightIntensity(Number.POSITIVE_INFINITY)).toBe(DEFAULT_LIGHT_INTENSITY)
  })

  it("makeLight：默认位姿 + 强度 + 投影，且与入参不共享数组引用", () => {
    const l = makeLight("lt-1", [])
    expect(l.id).toBe("lt-1")
    expect(l.name).toBe("光源01")
    expect(l.intensity).toBe(DEFAULT_LIGHT_INTENSITY)
    expect(l.castShadow).toBe(true)
    expect(l.position).toHaveLength(3)
    const other = makeLight("lt-2", [l])
    expect(other.position).not.toBe(l.position) // 新数组：改一盏不会牵动另一盏
  })
})

describe("previs-light 阴影相机拟合", () => {
  it("半宽 = 舞台半径 × 覆盖余量", () => {
    const pose: PrevisLightPose = { position: [6, 8, 4], target: [0, 0, 0] }
    expect(fitShadowCamera(pose, 8).halfExtent).toBe(8 * SHADOW_COVER_MARGIN)
  })

  it("near/far 按灯距 ± 半径收放：远灯也罩得住球（far > 灯距 + 半径）", () => {
    const pose: PrevisLightPose = { position: [0, 10, 0], target: [0, 0, 0] }
    const fit = fitShadowCamera(pose, 6)
    expect(fit.near).toBeCloseTo(10 - 6, 6)
    expect(fit.far).toBeCloseTo(10 + 6 + SHADOW_DEPTH_PAD, 6)
    // 球的最远点仍在 far 之内
    expect(fit.far).toBeGreaterThan(10 + 6)
  })

  it("灯在球内：near 夹到 0.1 且 far 仍为正", () => {
    const fit = fitShadowCamera({ position: [1, 1, 0], target: [0, 0, 0] }, 20)
    expect(fit.near).toBe(0.1)
    expect(fit.far).toBeGreaterThan(20)
  })

  it("灯与目标重合不产生负 near / NaN", () => {
    const fit = fitShadowCamera({ position: [0, 0, 0], target: [0, 0, 0] }, 6)
    expect(fit.near).toBe(0.1)
    expect(Number.isFinite(fit.far)).toBe(true)
  })
})

describe("previs-light 舞台包围球", () => {
  it("空场景取半径下限", () => {
    expect(stageRadius([], [0, 0, 0])).toBe(STAGE_MIN_RADIUS)
  })

  it("取最远布景项的水平距离 + 余量", () => {
    expect(stageRadius([{ position: [0, 0, 0] }, { position: [10, 3, 0] }], [0, 0, 0])).toBe(
      10 + STAGE_MARGIN,
    )
  })

  it("球心跟光源 target 走：target 移到布景处则收缩到下限，移远则必须把布景包进来", () => {
    const items: { position: [number, number, number] }[] = [{ position: [2, 0, 0] }]
    // target 落在布景附近（距离 2 < 下限）→ 半径下限
    expect(stageRadius(items, [2, 0, 0])).toBe(STAGE_MIN_RADIUS)
    // target 移远 → 半径必须罩住布景（否则阴影区会被裁掉）
    expect(stageRadius([{ position: [0, 0, 0] }], [0, 0, 50])).toBe(50 + STAGE_MARGIN)
  })

  it("只看水平距离：高度不参与（垂直分量交给 near/far）", () => {
    expect(stageRadius([{ position: [4, 100, 0] }], [0, 0, 0])).toBe(4 + STAGE_MARGIN)
  })
})
