import { describe, expect, it } from "vitest"
import { BODY_TYPES, JOINT_LIMITS, POSE_PRESETS } from "./previs-poses"

const JOINTS = ["head", "torso", "armL", "armR", "legL", "legR"] as const

describe("姿势预设", () => {
  it("恰好 20 个预设且 id 唯一", () => {
    expect(POSE_PRESETS).toHaveLength(20)
    expect(new Set(POSE_PRESETS.map((p) => p.id)).size).toBe(20)
  })

  it("每个预设覆盖全部 6 关节且角度在滑杆范围内", () => {
    for (const p of POSE_PRESETS) {
      for (const j of JOINTS) {
        const rot = p.controls[j]
        expect(rot, `${p.id}.${j}`).toHaveLength(3)
        const [x, y, z] = rot
        const [min, max] = JOINT_LIMITS[j]
        for (const v of [x, y, z]) {
          expect(v, `${p.id}.${j}=${v}`).toBeGreaterThanOrEqual(min)
          expect(v, `${p.id}.${j}=${v}`).toBeLessThanOrEqual(max)
        }
      }
    }
  })
})

describe("体型", () => {
  it("8 种体型且比例为正数", () => {
    expect(BODY_TYPES).toHaveLength(8)
    for (const b of BODY_TYPES) {
      expect(b.height).toBeGreaterThan(0)
      expect(b.width).toBeGreaterThan(0)
      expect(b.headSize).toBeGreaterThan(0)
    }
  })
})
