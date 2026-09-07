/**
 * UE4 素体骨骼驱动（纯 three，复刻 storyai-3d-director-desk 的 retopology 素体驱动）
 *
 * 移植自 REF（1:1 数值移植源）：
 *   - src/editor/runtime/ue4Mannequin/ue4MannequinRig.ts            （骨映射/缩放表/姿势旋转表）
 *   - src/editor/runtime/ue4Mannequin/ue4MannequinPoseApplication.ts（rest 快照 / 复位+驱动）
 *   - src/editor/runtime/UE4MannequinModel.tsx                      （alignUE4MannequinToGround，纯函数部分）
 *
 * 数值 1:1 约束：角度（度→弧度）、轴向符号、英寸→单位换算系数（1/0.0254）、
 * 每体型 per-bone 缩放表、neutral 双臂微张、贴地 label 锚点、骨骼名均与 REF 逐字一致。
 * REF 的 React/R3F 外壳（useLoader/useMemo/useLayoutEffect/<group scale>）不在本模块。
 *
 * 关于骨骼名（无需适配，已用真实资产集成测试锁定）：
 *   资产 public/models/ue-mannequin-retopology.glb 的 glTF JSON 节点名是空格分隔
 *   （如 "Bip001 Pelvis_03"），但 three GLTFLoader（r185）建节点时经
 *   PropertyBinding.sanitizeNodeName 把所有空白替换为下划线（见
 *   PropertyBinding.sanitizeNodeName = name.replace(/\s/g, '_')），故运行时
 *   骨骼名 = "Bip001_Pelvis_03" —— 与 REF 映射表逐字一致。REF 的 ue4Mannequin 测试
 *   均为纯表断言；本模块测试内 GLTFLoader 集成用例（真实资产解析 → capture → apply）
 *   锁定该绑定，防止资产/加载器行为漂移。
 *
 * 其余形态适配（值不变，按任务 brief 接口约定收口）：
 *   - REF getUE4ModelScale 返回 [n,n,n] 三元组 → 本模块返回 number（三轴同值）
 *   - REF getUE4GroundedLabelY → getUE4LabelAnchorY（brief 命名，表值同）
 *   - REF getUE4PoseBoneRotations 返回 [x,y,z] 弧度三元组 → 本模块返回 THREE.Euler
 *   - REF UE4RestPose = Record<name, 元组> → 本模块 Ue4RestPose = Map<name, Vector3/Quaternion 对象>
 */

import * as THREE from "three";

export type Ue4BodyType =
  | "mannequin"
  | "female"
  | "broad"
  | "muscular"
  | "slim"
  | "teen"
  | "child"
  | "chibi";

export interface Ue4RestPose {
  boneLocal: Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>;
}

/**
 * 移植自 REF ue4MannequinRig.ts:37
 * UE4 Bip001 资产以英寸为单位建模：1 世界米 = 1/0.0254 个本地单位。
 * 用于 body.offsetY（世界米语义）到骨骼本地位置单位的换算（轴向见下方偏移表）。
 */
const BIP001_LOCAL_UNITS_PER_WORLD_METER = 1 / 0.0254;

/** 移植自 REF mannequinPose.ts:4-6（degreesToRadians） */
function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

/**
 * 移植自 REF mannequinPose.ts:12-18（getBodyTypePoseLimit）
 * 姿势限位（度）：chibi ±58 / child ±72 / 其余 ±90（normalize 语义并入默认 90）。
 */
function getBodyTypePoseLimit(bodyType: Ue4BodyType): number {
  switch (bodyType) {
    case "chibi":
      return 58;
    case "child":
      return 72;
    default:
      return 90;
  }
}

/** 移植自 REF ue4MannequinRig.ts:39-46（clamp + radians） */
function clamp(value: number, bodyType: Ue4BodyType) {
  const limit = getBodyTypePoseLimit(bodyType);
  return Math.min(limit, Math.max(-limit, value));
}

function radians(value: number, bodyType: Ue4BodyType) {
  return degreesToRadians(clamp(value, bodyType));
}

/**
 * 移植自 REF ue4MannequinRig.ts:15-31（UE4_MANNEQUIN_BONE_MAP）
 * 逻辑部位 → retopology 资产骨骼名（运行时骨骼名；GLB JSON 中为空格分隔，
 * GLTFLoader 经 sanitizeNodeName 转成下划线，见文件头说明）。
 */
const UE4_BONE_MAP = {
  body: "Bip001_Pelvis_03",
  torso: "Bip001_Spine1_05",
  head: "Bip001_Head_055",
  leftShoulder: "Bip001_L_UpperArm_08",
  rightShoulder: "Bip001_R_UpperArm_032",
  leftElbow: "Bip001_L_Forearm_09",
  rightElbow: "Bip001_R_Forearm_033",
  leftHand: "Bip001_L_Hand_010",
  rightHand: "Bip001_R_Hand_034",
  leftHip: "Bip001_L_Thigh_057",
  rightHip: "Bip001_R_Thigh_061",
  leftKnee: "Bip001_L_Calf_058",
  rightKnee: "Bip001_R_Calf_062",
  leftFoot: "Bip001_L_Foot_059",
  rightFoot: "Bip001_R_Foot_063",
} as const;

/** 弧度三元组 [x, y, z]（REF UE4BoneRotationMap 形态，构建期内部使用） */
type UE4BoneRotationMap = Record<string, [number, number, number]>;

/** 单轴缩放三元组（REF UE4BoneScaleMap 形态，构建期内部使用） */
type UE4BoneScaleMap = Record<string, [number, number, number]>;

// ============================================================================
// 姿势控制 → 骨骼欧拉旋转（每轴经 getBodyTypePoseLimit 对称钳制后转弧度）
// 全部移植自 REF ue4MannequinRig.ts:48-129；轴向符号与 REF 逐字一致（无任何改动）
// ============================================================================

/** 移植自 REF ue4MannequinRig.ts:48-58（ue4SpineRotation；body.* / torso.*） */
function ue4SpineRotation(
  controls: Record<string, number>,
  prefix: string,
  bodyType: Ue4BodyType
): [number, number, number] {
  return [
    radians(controls[`${prefix}.yaw`] ?? 0, bodyType),
    radians(controls[`${prefix}.roll`] ?? 0, bodyType),
    -radians(controls[`${prefix}.pitch`] ?? 0, bodyType),
  ];
}

/** 移植自 REF ue4MannequinRig.ts:60-69（ue4HeadRotation；head.*，pitch 符号为正） */
function ue4HeadRotation(controls: Record<string, number>, bodyType: Ue4BodyType): [number, number, number] {
  return [
    radians(controls["head.yaw"] ?? 0, bodyType),
    radians(controls["head.roll"] ?? 0, bodyType),
    radians(controls["head.pitch"] ?? 0, bodyType),
  ];
}

/** 移植自 REF ue4MannequinRig.ts:71-83（ue4ShoulderRotation；pitch 取负） */
function ue4ShoulderRotation(
  controls: Record<string, number>,
  prefix: "leftShoulder" | "rightShoulder",
  bodyType: Ue4BodyType
): [number, number, number] {
  const spread = controls[`${prefix}.spread`] ?? 0;

  return [
    radians(controls[`${prefix}.twist`] ?? 0, bodyType),
    radians(spread, bodyType),
    -radians(controls[`${prefix}.pitch`] ?? 0, bodyType),
  ];
}

/** 移植自 REF ue4MannequinRig.ts:85-97（ue4HipRotation；spread 取负、pitch 为正） */
function ue4HipRotation(
  controls: Record<string, number>,
  prefix: "leftHip" | "rightHip",
  bodyType: Ue4BodyType
): [number, number, number] {
  const spread = controls[`${prefix}.spread`] ?? 0;

  return [
    radians(controls[`${prefix}.twist`] ?? 0, bodyType),
    -radians(spread, bodyType),
    radians(controls[`${prefix}.pitch`] ?? 0, bodyType),
  ];
}

/** 移植自 REF ue4MannequinRig.ts:99-105（ue4LimbBendRotation；肘/膝单轴 bend，z 取负） */
function ue4LimbBendRotation(
  controls: Record<string, number>,
  key: string,
  bodyType: Ue4BodyType
): [number, number, number] {
  return [0, 0, -radians(controls[key] ?? 0, bodyType)];
}

/** 移植自 REF ue4MannequinRig.ts:107-117（ue4HandRotation；三轴符号均为正） */
function ue4HandRotation(
  controls: Record<string, number>,
  prefix: "leftHand" | "rightHand",
  bodyType: Ue4BodyType
): [number, number, number] {
  return [
    radians(controls[`${prefix}.twist`] ?? 0, bodyType),
    radians(controls[`${prefix}.roll`] ?? 0, bodyType),
    radians(controls[`${prefix}.pitch`] ?? 0, bodyType),
  ];
}

/** 移植自 REF ue4MannequinRig.ts:119-129（ue4FootRotation；三轴符号均为正） */
function ue4FootRotation(
  controls: Record<string, number>,
  prefix: "leftFoot" | "rightFoot",
  bodyType: Ue4BodyType
): [number, number, number] {
  return [
    radians(controls[`${prefix}.twist`] ?? 0, bodyType),
    radians(controls[`${prefix}.roll`] ?? 0, bodyType),
    radians(controls[`${prefix}.pitch`] ?? 0, bodyType),
  ];
}

/**
 * 姿势控制 → 每骨骼弧度三元组（15 根目标骨，固定键集）。
 * 移植自 REF ue4MannequinRig.ts:316-337（getUE4PoseBoneRotations 映射）
 */
function getPoseBoneRotations(
  controls: Record<string, number>,
  bodyType: Ue4BodyType
): UE4BoneRotationMap {
  return {
    [UE4_BONE_MAP.body]: ue4SpineRotation(controls, "body", bodyType),
    [UE4_BONE_MAP.torso]: ue4SpineRotation(controls, "torso", bodyType),
    [UE4_BONE_MAP.head]: ue4HeadRotation(controls, bodyType),
    [UE4_BONE_MAP.leftShoulder]: ue4ShoulderRotation(controls, "leftShoulder", bodyType),
    [UE4_BONE_MAP.rightShoulder]: ue4ShoulderRotation(controls, "rightShoulder", bodyType),
    [UE4_BONE_MAP.leftElbow]: ue4LimbBendRotation(controls, "leftElbow.bend", bodyType),
    [UE4_BONE_MAP.rightElbow]: ue4LimbBendRotation(controls, "rightElbow.bend", bodyType),
    [UE4_BONE_MAP.leftHand]: ue4HandRotation(controls, "leftHand", bodyType),
    [UE4_BONE_MAP.rightHand]: ue4HandRotation(controls, "rightHand", bodyType),
    [UE4_BONE_MAP.leftHip]: ue4HipRotation(controls, "leftHip", bodyType),
    [UE4_BONE_MAP.rightHip]: ue4HipRotation(controls, "rightHip", bodyType),
    [UE4_BONE_MAP.leftKnee]: ue4LimbBendRotation(controls, "leftKnee.bend", bodyType),
    [UE4_BONE_MAP.rightKnee]: ue4LimbBendRotation(controls, "rightKnee.bend", bodyType),
    [UE4_BONE_MAP.leftFoot]: ue4FootRotation(controls, "leftFoot", bodyType),
    [UE4_BONE_MAP.rightFoot]: ue4FootRotation(controls, "rightFoot", bodyType),
  };
}

// ============================================================================
// 体型缩放表
// 全部移植自 REF ue4MannequinRig.ts:131-304（数值逐字）
// ============================================================================

/** 19 根基础骨缩放（默认 1，仅 Spine1_05 带 1.02 量级中性参数） */
function baseBoneScales(): UE4BoneScaleMap {
  return {
    Bip001_Head_055: [1, 1, 1],
    Bip001_Neck_06: [1, 1, 1],
    Bip001_Pelvis_03: [1, 1, 1],
    Bip001_Spine_04: [1, 1, 1],
    Bip001_Spine1_05: [1, 1.02, 1.02],
    Bip001_L_Clavicle_07: [1, 1, 1],
    Bip001_R_Clavicle_031: [1, 1, 1],
    Bip001_L_UpperArm_08: [1, 1, 1],
    Bip001_R_UpperArm_032: [1, 1, 1],
    Bip001_L_Forearm_09: [1, 1, 1],
    Bip001_R_Forearm_033: [1, 1, 1],
    Bip001_L_Hand_010: [1, 1, 1],
    Bip001_R_Hand_034: [1, 1, 1],
    Bip001_L_Thigh_057: [1, 1, 1],
    Bip001_R_Thigh_061: [1, 1, 1],
    Bip001_L_Calf_058: [1, 1, 1],
    Bip001_R_Calf_062: [1, 1, 1],
    Bip001_L_Foot_059: [1, 1, 1],
    Bip001_R_Foot_063: [1, 1, 1],
  };
}

// ============================================================================
// 各体型缩放与整模缩放
// 全部移植自 REF ue4MannequinRig.ts（数值逐字）
// ============================================================================

const BODY_TYPE_SCALE_OVERRIDES: Record<Ue4BodyType, UE4BoneScaleMap> = {
  // mannequin：默认骨架（default 分支，REF ue4MannequinRig.ts:297-300）
  mannequin: {
    Bip001_Pelvis_03: [1, 1.02, 1.02],
    Bip001_Spine1_05: [1, 1.02, 1.02],
  },
  // 移植自 REF ue4MannequinRig.ts:200-212
  female: {
    Bip001_Pelvis_03: [1, 1.04, 1.04],
    Bip001_Spine_04: [0.98, 0.9, 0.94],
    Bip001_Spine1_05: [0.98, 1, 1],
    Bip001_L_Clavicle_07: [0.92, 1, 1],
    Bip001_R_Clavicle_031: [0.92, 1, 1],
    Bip001_L_UpperArm_08: [0.9, 0.9, 0.9],
    Bip001_R_UpperArm_032: [0.9, 0.9, 0.9],
    Bip001_L_Forearm_09: [1, 0.88, 0.9],
    Bip001_R_Forearm_033: [1, 0.88, 0.9],
    Bip001_L_Thigh_057: [1, 0.96, 0.96],
    Bip001_R_Thigh_061: [1, 0.96, 0.96],
  },
  // 移植自 REF ue4MannequinRig.ts:213-224
  broad: {
    Bip001_Pelvis_03: [1.02, 1.12, 1.08],
    Bip001_Spine1_05: [1.02, 1.22, 1.1],
    Bip001_L_Clavicle_07: [1.12, 1, 1],
    Bip001_R_Clavicle_031: [1.12, 1, 1],
    Bip001_L_UpperArm_08: [1, 1.12, 1.12],
    Bip001_R_UpperArm_032: [1, 1.12, 1.12],
    Bip001_L_Forearm_09: [1, 1.08, 1.08],
    Bip001_R_Forearm_033: [1, 1.08, 1.08],
    Bip001_L_Thigh_057: [1.02, 1.1, 1.08],
    Bip001_R_Thigh_061: [1.02, 1.1, 1.08],
  },
  // 移植自 REF ue4MannequinRig.ts:225-237
  muscular: {
    Bip001_Pelvis_03: [1, 1.04, 1.04],
    Bip001_Spine_04: [1.02, 1.1, 1.06],
    Bip001_Spine1_05: [1.02, 1.26, 1.1],
    Bip001_L_Clavicle_07: [1.16, 1, 1],
    Bip001_R_Clavicle_031: [1.16, 1, 1],
    Bip001_L_UpperArm_08: [1, 1.18, 1.18],
    Bip001_R_UpperArm_032: [1, 1.18, 1.18],
    Bip001_L_Forearm_09: [1, 1.12, 1.12],
    Bip001_R_Forearm_033: [1, 1.12, 1.12],
    Bip001_L_Thigh_057: [1, 1.12, 1.12],
    Bip001_R_Thigh_061: [1, 1.12, 1.12],
  },
  // 移植自 REF ue4MannequinRig.ts:238-252
  slim: {
    Bip001_Pelvis_03: [0.98, 0.75, 0.9],
    Bip001_Spine_04: [0.98, 1, 1],
    Bip001_Spine1_05: [0.98, 1, 1],
    Bip001_L_Clavicle_07: [0.9, 1, 0.9],
    Bip001_R_Clavicle_031: [0.9, 1, 0.9],
    Bip001_L_UpperArm_08: [0.96, 0.96, 0.96],
    Bip001_R_UpperArm_032: [0.96, 0.96, 0.96],
    Bip001_L_Forearm_09: [1, 1, 0.78],
    Bip001_R_Forearm_033: [1, 1, 0.78],
    Bip001_L_Thigh_057: [1, 0.84, 0.84],
    Bip001_R_Thigh_061: [1, 0.84, 0.84],
    Bip001_L_Calf_058: [1, 1, 1],
    Bip001_R_Calf_062: [1, 1, 1],
  },
  // 移植自 REF ue4MannequinRig.ts:253-261
  teen: {
    Bip001_Head_055: [1.12, 1.12, 1.12],
    Bip001_Pelvis_03: [0.96, 0.94, 0.94],
    Bip001_Spine1_05: [0.96, 0.94, 0.94],
    Bip001_L_UpperArm_08: [0.96, 0.9, 0.9],
    Bip001_R_UpperArm_032: [0.96, 0.9, 0.9],
    Bip001_L_Thigh_057: [0.96, 0.9, 0.9],
    Bip001_R_Thigh_061: [0.96, 0.9, 0.9],
  },
  // 移植自 REF ue4MannequinRig.ts:262-275
  child: {
    Bip001_Head_055: [1.34, 1.34, 1.34],
    Bip001_Pelvis_03: [0.88, 0.9, 0.9],
    Bip001_Spine_04: [1.2, 1.2, 1.2],
    Bip001_Spine1_05: [0.84, 0.86, 0.86],
    Bip001_L_UpperArm_08: [0.84, 1.1, 1.1],
    Bip001_R_UpperArm_032: [0.84, 1.1, 1.1],
    Bip001_L_Forearm_09: [1, 0.8, 0.8],
    Bip001_R_Forearm_033: [1, 0.8, 0.8],
    Bip001_L_Thigh_057: [0.7, 0.9, 0.9],
    Bip001_R_Thigh_061: [0.7, 0.9, 0.9],
    Bip001_L_Calf_058: [0.82, 0.9, 0.9],
    Bip001_R_Calf_062: [0.82, 0.9, 0.9],
  },
  // 移植自 REF ue4MannequinRig.ts:276-296
  chibi: {
    Bip001_Head_055: [4, 4, 4],
    Bip001_Neck_06: [0.72, 0.76, 0.76],
    Bip001_Pelvis_03: [0.92, 1.22, 1.22],
    Bip001_Spine_04: [0.68, 1, 1],
    Bip001_Spine1_05: [1, 0.9, 0.9],
    Bip001_L_Clavicle_07: [1.24, 0.9, 0.9],
    Bip001_R_Clavicle_031: [1.24, 0.9, 0.9],
    Bip001_L_UpperArm_08: [1.2, 1.3, 1.3],
    Bip001_R_UpperArm_032: [1.2, 1.3, 1.3],
    Bip001_L_Forearm_09: [0.7, 1, 1],
    Bip001_R_Forearm_033: [0.7, 1, 1],
    Bip001_L_Hand_010: [1.45, 1, 1],
    Bip001_R_Hand_034: [1.45, 1, 1],
    Bip001_L_Thigh_057: [0.62, 0.8, 0.8],
    Bip001_R_Thigh_061: [0.62, 0.8, 0.8],
    Bip001_L_Calf_058: [0.7, 0.9, 0.9],
    Bip001_R_Calf_062: [0.7, 0.9, 0.9],
    Bip001_L_Foot_059: [1.06, 0.82, 1.16],
    Bip001_R_Foot_063: [1.06, 0.82, 1.16],
  },
};

/**
 * 整模等比缩放。
 * 移植自 REF ue4MannequinRig.ts:155-166（REF 返回 [n,n,n] 三元组，本模块按 brief 返回 n）
 */
export function getUE4ModelScale(bodyType: Ue4BodyType = "mannequin"): number {
  switch (bodyType) {
    case "teen":
      return 0.88;
    case "child":
      return 0.72;
    case "chibi":
      return 0.56;
    default:
      return 1;
  }
}

/**
 * 贴地 label 锚点高度表（角色名标签的参考 Y）。
 * 移植自 REF ue4MannequinRig.ts:168-185（getUE4GroundedLabelY，按 brief 命名 getUE4LabelAnchorY）
 */
export function getUE4LabelAnchorY(bodyType: Ue4BodyType = "mannequin"): number {
  switch (bodyType) {
    case "female":
    case "slim":
      return 1.98;
    case "broad":
    case "muscular":
      return 2.08;
    case "teen":
      return 1.78;
    case "child":
      return 1.46;
    case "chibi":
      return 1.18;
    default:
      return 2.04;
  }
}

/**
 * 每体型 per-bone 缩放表（19 根骨；apply 时 rest scale × 表值）。
 * 移植自 REF ue4MannequinRig.ts:196-304（数值逐字；返回值形态按 brief 为 Vector3）
 */
export function getUE4BodyBoneScales(bodyType: Ue4BodyType = "mannequin"): Record<string, THREE.Vector3> {
  const scales = baseBoneScales();
  const overrides = BODY_TYPE_SCALE_OVERRIDES[bodyType] ?? BODY_TYPE_SCALE_OVERRIDES.mannequin;

  const result: Record<string, THREE.Vector3> = {};
  for (const [bone, [x, y, z]] of Object.entries(scales)) {
    const override = overrides[bone];
    result[bone] = new THREE.Vector3(
      override ? override[0] : x,
      override ? override[1] : y,
      override ? override[2] : z
    );
  }
  return result;
}

/**
 * body.offsetY（世界米）→ 骨盆骨骼本地位置偏移（英寸换算，沿骨骼本地 z）。
 * 移植自 REF ue4MannequinRig.ts:306-314（getUE4PoseBonePositionOffsets）
 */
function getPoseBonePositionOffsets(controls: Record<string, number>): Record<string, [number, number, number]> {
  const bodyOffsetY = controls["body.offsetY"] ?? 0;

  if (bodyOffsetY === 0) return {};

  return {
    [UE4_BONE_MAP.body]: [0, 0, bodyOffsetY * BIP001_LOCAL_UNITS_PER_WORLD_METER],
  };
}

/**
 * 姿势控制 → 每骨骼欧拉旋转（默认体型钳制 ±90，同 REF 无 bodyType 参数时的行为）。
 * 移植自 REF ue4MannequinRig.ts:316-337（数值与映射逐字；返回值形态按 brief 为 Euler）
 */
export function getUE4PoseBoneRotations(controls: Record<string, number>): Record<string, THREE.Euler> {
  const rotations = getPoseBoneRotations(controls, "mannequin");
  const result: Record<string, THREE.Euler> = {};
  for (const [bone, [x, y, z]] of Object.entries(rotations)) {
    result[bone] = new THREE.Euler(x, y, z);
  }
  return result;
}

// ============================================================================
// neutral 双臂微张（应用于无姿势控制的 rest 之上）
// 移植自 REF ue4MannequinRig.ts:187-194（getUE4NeutralPoseBoneRotations）
// ============================================================================

function getUE4NeutralPoseBoneRotations(): UE4BoneRotationMap {
  return {
    [UE4_BONE_MAP.leftShoulder]: [0, degreesToRadians(25), 0],
    [UE4_BONE_MAP.rightShoulder]: [0, degreesToRadians(-25), 0],
    [UE4_BONE_MAP.leftElbow]: [0, 0, degreesToRadians(25)],
    [UE4_BONE_MAP.rightElbow]: [0, 0, degreesToRadians(25)],
  };
}

// ============================================================================
// rest 快照 / 复位 + 驱动（场景遍历版）
// 移植自 REF ue4MannequinPoseApplication.ts（语义逐字；返回值形态按 brief 收口）
// ============================================================================

/** 移植自 REF ue4MannequinPoseApplication.ts:24-26 */
function isBone(object: THREE.Object3D): object is THREE.Object3D & { isBone: true } {
  return "isBone" in object && object.isBone === true;
}

/** 移植自 REF ue4MannequinPoseApplication.ts:28-30 */
function applyRotationOffset(object: THREE.Object3D, rotation: [number, number, number]) {
  object.quaternion.multiply(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]))
  );
}

/**
 * 快照场景内全部骨骼的本地 position/quaternion/scale。
 * 移植自 REF ue4MannequinPoseApplication.ts:32-46（captureUE4RestPose）
 */
export function captureUE4RestPose(scene: THREE.Object3D): Ue4RestPose {
  const boneLocal = new Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>();

  scene.traverse((object) => {
    if (!isBone(object)) return;

    boneLocal.set(object.name, {
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
    });
  });

  return { boneLocal };
}

/**
 * 对场景应用整套 UE4 rig（仅处理 restPose 内登记过的骨骼）：
 *   重置 rest → body.offsetY 位置偏移（英寸换算，骨盆本地 z）→ 体型骨缩放（rest × 表值）
 *   → neutral 双臂微张 → 姿势旋转（每骨四元数乘法，Euler XYZ）。
 * 顺序/语义移植自 REF ue4MannequinPoseApplication.ts:48-91（applyUE4RestPoseAndRig）。
 */
export function applyUE4Rig(
  scene: THREE.Object3D,
  rest: Ue4RestPose,
  controls: Record<string, number>,
  bodyType: Ue4BodyType = "mannequin"
): void {
  const bodyScales = getUE4BodyBoneScales(bodyType);
  const positionOffsets = getPoseBonePositionOffsets(controls);
  const neutralRotations = getUE4NeutralPoseBoneRotations();
  const poseRotations = getPoseBoneRotations(controls, bodyType);

  scene.traverse((object) => {
    if (!isBone(object)) return;

    const boneRest = rest.boneLocal.get(object.name);
    if (!boneRest) return;

    // 1) 复位到 rest（REF ue4MannequinPoseApplication.ts:63-65）
    object.position.copy(boneRest.position);
    object.quaternion.copy(boneRest.quaternion);
    object.scale.copy(boneRest.scale);

    // 2) body.offsetY 位置偏移（英寸换算；仅骨盆，REF :67-74）
    const positionOffset = positionOffsets[object.name];
    if (positionOffset) {
      object.position.set(
        boneRest.position.x + positionOffset[0],
        boneRest.position.y + positionOffset[1],
        boneRest.position.z + positionOffset[2]
      );
    }

    // 3) 体型骨缩放：rest × 表值（REF :76-79）
    const scale = bodyScales[object.name];
    if (scale) {
      object.scale.set(boneRest.scale.x * scale.x, boneRest.scale.y * scale.y, boneRest.scale.z * scale.z);
    }

    // 4) neutral 双臂微张（REF :81-84）
    const neutralRotation = neutralRotations[object.name];
    if (neutralRotation) {
      applyRotationOffset(object, neutralRotation);
    }

    // 5) 姿势旋转（REF :86-89）
    const rotation = poseRotations[object.name];
    if (rotation) {
      applyRotationOffset(object, rotation);
    }
  });
}

// ============================================================================
// 贴地（bounds 迭代 ≤5 次）
// 移植自 REF UE4MannequinModel.tsx:77-125（getBoundsInParentLocal + alignUE4MannequinToGround，
// 纯函数部分；REF 返回最终 y，本模块按 brief 约定返回 void）
// ============================================================================

/**
 * 以父节点本地空间测量 scene 的包围盒（含父级缩放/旋转）。
 * 移植自 REF UE4MannequinModel.tsx:77-100（getBoundsInParentLocal）
 */
function getBoundsInParentLocal(object: THREE.Object3D) {
  (object.parent ?? object).updateMatrixWorld(true);

  const worldBounds = new THREE.Box3().setFromObject(object, true);
  if (!object.parent || worldBounds.isEmpty()) return worldBounds;

  const parentInverse = new THREE.Matrix4().copy(object.parent.matrixWorld).invert();
  const bounds = new THREE.Box3().makeEmpty();
  const vertex = new THREE.Vector3();
  const xValues = [worldBounds.min.x, worldBounds.max.x];
  const yValues = [worldBounds.min.y, worldBounds.max.y];
  const zValues = [worldBounds.min.z, worldBounds.max.z];

  xValues.forEach((x) => {
    yValues.forEach((y) => {
      zValues.forEach((z) => {
        vertex.set(x, y, z).applyMatrix4(parentInverse);
        bounds.expandByPoint(vertex);
      });
    });
  });

  return bounds;
}

/**
 * 迭代抬升/下移 scene 直至其底边贴地（y≈0），最多 5 次。
 * 移植自 REF UE4MannequinModel.tsx:102-125（alignUE4MannequinToGround）
 */
export function alignToGround(scene: THREE.Object3D): void {
  const rootX = scene.position.x;
  const rootZ = scene.position.z;

  function measureBoundsInParentLocal() {
    return getBoundsInParentLocal(scene);
  }

  scene.position.set(rootX, 0, rootZ);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const bounds = measureBoundsInParentLocal();
    const correctionY = bounds.isEmpty() || !Number.isFinite(bounds.min.y) ? 0 : -bounds.min.y;

    if (Math.abs(correctionY) < 0.00001) break;

    scene.position.set(rootX, scene.position.y + correctionY, rootZ);
  }

  scene.position.set(rootX, scene.position.y, rootZ);
  (scene.parent ?? scene).updateMatrixWorld(true);
}
