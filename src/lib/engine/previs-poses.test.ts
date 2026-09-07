import { describe, expect, it } from "vitest"
import type { Ue4BodyType } from "./previs-ue4-rig"
import { getUE4LabelAnchorY } from "./previs-ue4-rig"
import {
  BODY_TYPE_BY_ID,
  BODY_TYPES,
  POSE_GROUPS,
  POSE_LIMIT_BY_BODY_TYPE,
  POSE_PRESETS,
  POSE_PRESET_BY_ID,
  POSE_VOCAB,
} from "./previs-poses"

/** REF viewportLabels.ts VIEWPORT_OBJECT_LABEL_VERTICAL_GAP（BODY_TYPES.height 推导用） */
const LABEL_GAP = 0.18

/** 预设 id（顺序 = REF poseSchema.ts POSE_PRESET_IDS 逐字） */
const PRESET_IDS = [
  "stand",
  "t-pose",
  "walk",
  "run",
  "sit",
  "crouch",
  "kneel-one",
  "kneel-two",
  "hands-on-hips",
  "lean",
  "bow",
  "think",
  "fight",
  "kick",
  "throw",
  "push",
  "wave",
  "reach",
  "cross-arms",
  "phone",
] as const

/** 预设名（顺序 = REF presets/mannequinPosePresets.test.ts label 断言逐字） */
const PRESET_NAMES = [
  "站立",
  "T型",
  "行走",
  "跑步",
  "坐姿",
  "蹲下",
  "单膝跪",
  "双膝跪",
  "叉腰",
  "倚靠",
  "鞠躬",
  "思考",
  "格斗",
  "踢球",
  "投掷",
  "推进",
  "招手",
  "伸手",
  "抱臂",
  "看手机",
] as const

describe("词表 POSE_VOCAB", () => {
  it("恰好 38 键且无重复（skeletonMappings 25 + offsetY + hand/foot 各三轴）", () => {
    expect(POSE_VOCAB).toHaveLength(38)
    expect(new Set(POSE_VOCAB).size).toBe(38)
  })

  it("按 spec 词表逐字锁定：部位轴键齐全、顺序稳定", () => {
    expect(POSE_VOCAB).toEqual([
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
      "body.offsetY",
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
    ])
  })

  it("11 组滑杆键全部在词表内", () => {
    for (const group of POSE_GROUPS) {
      for (const slider of group.sliders) {
        expect(POSE_VOCAB, `${group.id}.${slider.key}`).toContain(slider.key)
      }
    }
  })
})

describe("姿势预设 POSE_PRESETS（与 REF 逐字）", () => {
  it("恰好 20 款且 id/名称/顺序与 REF 一致", () => {
    expect(POSE_PRESETS).toHaveLength(20)
    expect(POSE_PRESETS.map((p) => p.id)).toEqual([...PRESET_IDS])
    expect(POSE_PRESETS.map((p) => p.name)).toEqual([...PRESET_NAMES])
  })

  it("每款 controls 键 ⊆ POSE_VOCAB 且值无 NaN", () => {
    for (const p of POSE_PRESETS) {
      for (const [key, value] of Object.entries(p.controls)) {
        expect(POSE_VOCAB, `${p.id}.${key}`).toContain(key)
        expect(Number.isNaN(value), `${p.id}.${key}=${value}`).toBe(false)
      }
    }
  })

  it("词表单值字典语义：每款 controls 是字符串键 → number（无数组三元组残留）", () => {
    for (const p of POSE_PRESETS) {
      for (const value of Object.values(p.controls)) {
        expect(typeof value).toBe("number")
      }
    }
  })

  // REF 校准测试直移（1:1 锁）：T型逐字 + 蹲下/单膝跪/双膝跪/叉腰 toMatchObject
  it("校准 T 型（REF mannequinPosePresets.test 直移）", () => {
    const tPose = POSE_PRESETS.find((p) => p.id === "t-pose")
    expect(tPose?.controls).toEqual({
      "leftShoulder.spread": -70,
      "rightShoulder.spread": 70,
      "leftShoulder.pitch": 15,
      "rightShoulder.pitch": 15,
      "leftElbow.bend": 10,
      "rightElbow.bend": 10,
    })
  })

  it("校准蹲下（含 body.offsetY 负数下蹲，REF 直移）", () => {
    const crouch = POSE_PRESETS.find((p) => p.id === "crouch")
    expect(crouch?.controls).toMatchObject({
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
    })
  })

  it("校准单膝跪 / 双膝跪 / 叉腰（含 foot/hand 键，REF 直移）", () => {
    const kneelOne = POSE_PRESETS.find((p) => p.id === "kneel-one")
    expect(kneelOne?.controls).toMatchObject({
      "leftFoot.pitch": 20,
      "rightFoot.pitch": 60,
      "rightHip.pitch": -15,
      "leftShoulder.twist": -10,
    })
    const kneelTwo = POSE_PRESETS.find((p) => p.id === "kneel-two")
    expect(kneelTwo?.controls).toMatchObject({ "body.offsetY": -0.4, "leftKnee.bend": 126, "rightKnee.bend": 126 })
    const hips = POSE_PRESETS.find((p) => p.id === "hands-on-hips")
    expect(hips?.controls).toMatchObject({ "leftShoulder.twist": 80, "rightShoulder.twist": -80, "leftHand.roll": -35, "rightHand.roll": 35 })
  })

  it("站立为默认空 controls", () => {
    expect(POSE_PRESET_BY_ID.stand?.controls).toEqual({})
  })
})

describe("预设索引 POSE_PRESET_BY_ID", () => {
  it("覆盖 20 款全部 id 且指向同一对象", () => {
    expect(Object.keys(POSE_PRESET_BY_ID).sort()).toEqual([...PRESET_IDS].sort())
    for (const p of POSE_PRESETS) {
      expect(POSE_PRESET_BY_ID[p.id]).toBe(p)
    }
  })
})

describe("体型 BODY_TYPES（storyai 8 款）", () => {
  const BODY_IDS = ["mannequin", "female", "broad", "muscular", "slim", "teen", "child", "chibi"]

  it("恰好 8 款且 id 集合正确", () => {
    expect(BODY_TYPES).toHaveLength(8)
    expect(BODY_TYPES.map((b) => b.id)).toEqual(BODY_IDS)
  })

  it("名称与 REF bodyTypes.ts label 逐字一致", () => {
    expect(BODY_TYPES.map((b) => b.name)).toEqual([
      "男性素体",
      "女性素体",
      "宽厚素体",
      "健壮素体",
      "纤细素体",
      "少年素体",
      "儿童素体",
      "二头身",
    ])
  })

  it("height 为正数且按体型递减（chibi < child < teen < 全尺寸）", () => {
    for (const b of BODY_TYPES) {
      expect(b.height).toBeGreaterThan(0)
    }
    const byId = (id: string) => BODY_TYPE_BY_ID[id].height
    expect(byId("chibi")).toBeLessThan(byId("child"))
    expect(byId("child")).toBeLessThan(byId("teen"))
    expect(byId("teen")).toBeLessThan(byId("mannequin"))
  })

  it("height = UE4 贴地 label 锚点 − 0.18（推导自 rig 锚点表，见模块注释）", () => {
    for (const b of BODY_TYPES) {
      expect(b.height, b.id).toBeCloseTo(getUE4LabelAnchorY(b.id) - LABEL_GAP, 2)
    }
  })

  it("BODY_TYPE_BY_ID 覆盖 8 款全部 id", () => {
    for (const id of BODY_IDS) {
      expect(BODY_TYPE_BY_ID[id]?.name, id).toBeTruthy()
    }
  })
})

describe("滑杆组 POSE_GROUPS（REF CharacterPanel 11 组 + brief 身体含 offsetY）", () => {
  it("恰好 11 组且 id/标签齐全", () => {
    expect(POSE_GROUPS).toHaveLength(11)
    expect(POSE_GROUPS.map((g) => g.id)).toEqual([
      "body",
      "torso",
      "head",
      "leftShoulder",
      "rightShoulder",
      "leftElbow",
      "rightElbow",
      "leftHip",
      "rightHip",
      "leftKnee",
      "rightKnee",
    ])
    expect(POSE_GROUPS.map((g) => g.label)).toEqual([
      "身体",
      "躯干",
      "头部",
      "左肩",
      "右肩",
      "左肘",
      "右肘",
      "左髋",
      "右髋",
      "左膝",
      "右膝",
    ])
  })

  it("身体组滑杆 = pitch/yaw/roll + body.offsetY", () => {
    const body = POSE_GROUPS.find((g) => g.id === "body")
    expect(body?.sliders.map((s) => s.key)).toEqual(["body.pitch", "body.yaw", "body.roll", "body.offsetY"])
  })

  it("肩/髋组含 pitch/spread/twist 三键，肘/膝为 bend 单键", () => {
    for (const id of ["leftShoulder", "rightShoulder", "leftHip", "rightHip"]) {
      expect(POSE_GROUPS.find((g) => g.id === id)?.sliders.map((s) => s.key)).toEqual([
        `${id}.pitch`,
        `${id}.spread`,
        `${id}.twist`,
      ])
    }
    for (const id of ["leftElbow", "rightElbow", "leftKnee", "rightKnee"]) {
      expect(POSE_GROUPS.find((g) => g.id === id)?.sliders.map((s) => s.key)).toEqual([`${id}.bend`])
    }
  })

  it("躯干/头部组为 pitch/yaw/roll", () => {
    for (const id of ["torso", "head"]) {
      expect(POSE_GROUPS.find((g) => g.id === id)?.sliders.map((s) => s.key)).toEqual([
        `${id}.pitch`,
        `${id}.yaw`,
        `${id}.roll`,
      ])
    }
  })

  it("转角滑杆范围 ±90（REF 面板常量），offsetY 范围含全部预设下蹲值", () => {
    for (const group of POSE_GROUPS) {
      for (const s of group.sliders) {
        expect(s.min, `${group.id}.${s.key}`).toBeLessThan(s.max)
        if (s.key === "body.offsetY") {
          for (const p of POSE_PRESETS) {
            const v = p.controls[s.key]
            if (v !== undefined) {
              expect(v, `${p.id}.offsetY`).toBeGreaterThanOrEqual(s.min)
              expect(v, `${p.id}.offsetY`).toBeLessThanOrEqual(s.max)
            }
          }
        } else {
          expect(s.min).toBe(-90)
          expect(s.max).toBe(90)
        }
      }
    }
  })
})

describe("体型限位 POSE_LIMIT_BY_BODY_TYPE", () => {
  it("chibi ±58 / child ±72 / 其余 ±90（REF mannequinPose 直移）", () => {
    expect(POSE_LIMIT_BY_BODY_TYPE.chibi).toBe(58)
    expect(POSE_LIMIT_BY_BODY_TYPE.child).toBe(72)
    const fullScale: Ue4BodyType[] = ["mannequin", "female", "broad", "muscular", "slim", "teen"]
    for (const id of fullScale) {
      expect(POSE_LIMIT_BY_BODY_TYPE[id], id).toBe(90)
    }
  })
})
