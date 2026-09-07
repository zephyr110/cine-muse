/**
 * UE4 素体骨骼驱动测试。
 *
 * 移植自 REF 测试：
 *   - ue4MannequinRig.test.ts（纯表断言：缩放表/姿势旋转符号/锚点）
 *   - ue4MannequinPoseApplication.test.ts（Bone 场景：rest 复位/pose 偏移/neutral/不累积）
 * 纯 three 断言（不依赖 GLB/DOM）直接移植；REF 中依赖真实 GLB 才能覆盖的
 * 「表 ↔ 资产」绑定改为真实资产集成测试（node + GLTFLoader.parseAsync，
 * 资产内嵌 PNG 在 node 无法解码，故 parse 前剥离纹理引用——见 stripGltfTextures）。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  alignToGround,
  applyUE4Rig,
  captureUE4RestPose,
  getUE4BodyBoneScales,
  getUE4LabelAnchorY,
  getUE4ModelScale,
  getUE4PoseBoneRotations,
  type Ue4BodyType,
  type Ue4RestPose,
} from "./previs-ue4-rig";

/** 资产内 15 根核心骨（运行时骨骼名——GLTFLoader sanitizeNodeName 将空格转下划线） */
const CORE_BONES = [
  "Bip001_Pelvis_03",
  "Bip001_Spine1_05",
  "Bip001_Head_055",
  "Bip001_L_UpperArm_08",
  "Bip001_R_UpperArm_032",
  "Bip001_L_Forearm_09",
  "Bip001_R_Forearm_033",
  "Bip001_L_Hand_010",
  "Bip001_R_Hand_034",
  "Bip001_L_Thigh_057",
  "Bip001_R_Thigh_061",
  "Bip001_L_Calf_058",
  "Bip001_R_Calf_062",
  "Bip001_L_Foot_059",
  "Bip001_R_Foot_063",
] as const;

const ALL_BODY_TYPES: Ue4BodyType[] = [
  "mannequin",
  "female",
  "broad",
  "muscular",
  "slim",
  "teen",
  "child",
  "chibi",
];

function degToRad(value: number) {
  return (value * Math.PI) / 180;
}

function quaternionFromDegrees(x: number, y: number, z: number) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(degToRad(x), degToRad(y), degToRad(z)));
}

function expectQuaternionClose(actual: THREE.Quaternion, expected: THREE.Quaternion) {
  expect(actual.angleTo(expected)).toBeLessThan(0.000001);
}

function makeBone(name: string) {
  const bone = new THREE.Bone();
  bone.name = name;
  return bone;
}

// ---------------------------------------------------------------------------
// 姿势旋转表（REF ue4MannequinRig.test.ts 移植 + 键位完整性）
// ---------------------------------------------------------------------------

describe("UE4 姿势旋转表", () => {
  it("覆盖典型控制键对应的全部 15 根目标骨", () => {
    const rotations = getUE4PoseBoneRotations({
      "body.pitch": -30,
      "body.yaw": 5,
      "body.roll": 3,
      "torso.pitch": -18,
      "head.pitch": 18,
      "head.yaw": 20,
      "head.roll": 4,
      "leftShoulder.spread": -30,
      "rightShoulder.spread": 30,
      "leftShoulder.twist": 6,
      "rightShoulder.pitch": 56,
      "leftElbow.bend": 45,
      "rightElbow.bend": 80,
      "leftHand.roll": -35,
      "rightHand.twist": 10,
      "leftHip.spread": -12,
      "rightHip.spread": 12,
      "leftHip.pitch": -18,
      "rightHip.pitch": 24,
      "leftKnee.bend": 30,
      "rightKnee.bend": 42,
      "leftFoot.pitch": 58,
      "rightFoot.pitch": 45,
    });

    expect(Object.keys(rotations).sort()).toEqual([...CORE_BONES].sort());
    // 每个典型控制键驱动对应骨：任意一根目标骨都不应为零旋转（上面各键均非零）
    for (const bone of CORE_BONES) {
      const e = rotations[bone];
      expect(e, bone).toBeDefined();
      expect(Math.abs(e.x) + Math.abs(e.y) + Math.abs(e.z), bone).toBeGreaterThan(0);
    }
  });

  it("映射现有点位姿势控制键到骨骼旋转（轴向符号与 REF 一致）", () => {
    const rotations = getUE4PoseBoneRotations({
      "body.pitch": -30,
      "torso.pitch": -18,
      "head.pitch": 18,
      "head.yaw": 20,
      "rightShoulder.pitch": 56,
      "leftShoulder.spread": -30,
      "rightShoulder.spread": 30,
      "rightElbow.bend": 80,
      "leftHip.pitch": -18,
      "rightHip.pitch": 24,
      "leftHip.spread": -12,
      "rightHip.spread": 12,
      "rightKnee.bend": 42,
    });

    const r = rotations;
    // body/torso/head pitch: 躯干系取负（pitch -30/-18 → z 正），头 pitch 取正
    expect(r["Bip001_Head_055"].x).toBeGreaterThan(0);
    expect(r["Bip001_Head_055"].z).toBeGreaterThan(0);
    expect(r["Bip001_Pelvis_03"].z).toBeGreaterThan(0);
    expect(r["Bip001_Spine1_05"].z).toBeGreaterThan(0);
    // 肩：pitch 取负、spread 直接映射（左右反向张开）
    expect(r["Bip001_R_UpperArm_032"].z).toBeLessThan(0);
    expect(r["Bip001_L_UpperArm_08"].y).toBeLessThan(0);
    expect(r["Bip001_R_UpperArm_032"].y).toBeGreaterThan(0);
    // 肘：单轴 bend（z 取负）
    expect(r["Bip001_R_Forearm_033"].x).toBeCloseTo(0);
    expect(r["Bip001_R_Forearm_033"].z).toBeLessThan(0);
    // 髋：pitch 取正、spread 取负（内外侧反向）
    expect(r["Bip001_L_Thigh_057"].z).toBeLessThan(0);
    expect(r["Bip001_R_Thigh_061"].z).toBeGreaterThan(0);
    expect(r["Bip001_L_Thigh_057"].y).toBeGreaterThan(0);
    expect(r["Bip001_R_Thigh_061"].y).toBeLessThan(0);
    // 膝：单轴 bend（z 取负）
    expect(r["Bip001_R_Calf_062"].x).toBeCloseTo(0);
    expect(r["Bip001_R_Calf_062"].z).toBeLessThan(0);
  });

  it("足部 pitch 控制用于跪姿/弓步：z 轴按角度精确换算", () => {
    const rotations = getUE4PoseBoneRotations({
      "leftFoot.pitch": 58,
      "rightFoot.pitch": 45,
    });

    expect(rotations["Bip001_L_Foot_059"].z).toBeCloseTo(degToRad(58));
    expect(rotations["Bip001_R_Foot_063"].z).toBeCloseTo(degToRad(45));
  });

  it("手部 roll 控制直接驱动手掌朝向（不改 IK 目标）", () => {
    const rotations = getUE4PoseBoneRotations({
      "leftHand.roll": -35,
      "rightHand.roll": 35,
    });

    expect(rotations["Bip001_L_Hand_010"].y).toBeCloseTo(degToRad(-35));
    expect(rotations["Bip001_R_Hand_034"].y).toBeCloseTo(degToRad(35));
  });

  it("T-pose 双臂 spread 让两臂向外张开", () => {
    const rotations = getUE4PoseBoneRotations({
      "leftShoulder.spread": -90,
      "rightShoulder.spread": 90,
    });

    expect(rotations["Bip001_L_UpperArm_08"].y).toBeLessThan(0);
    expect(rotations["Bip001_R_UpperArm_032"].y).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 体型缩放表 + 整模缩放 + 锚点（REF ue4MannequinRig.test.ts 移植）
// ---------------------------------------------------------------------------

describe("UE4 体型缩放表", () => {
  it("8 种体型均返回完整 19 根骨且缩放分量为正", () => {
    for (const bodyType of ALL_BODY_TYPES) {
      const scales = getUE4BodyBoneScales(bodyType);
      expect(Object.keys(scales).length, bodyType).toBe(19);
      for (const [bone, v] of Object.entries(scales)) {
        expect(v.x, `${bodyType}:${bone}`).toBeGreaterThan(0);
        expect(v.y, `${bodyType}:${bone}`).toBeGreaterThan(0);
        expect(v.z, `${bodyType}:${bone}`).toBeGreaterThan(0);
      }
    }
  });

  it("mannequin 基准：仅骨盆与脊柱 1.02 量级，其余为 1", () => {
    const scales = getUE4BodyBoneScales("mannequin");
    expect(scales["Bip001_Pelvis_03"].x).toBeCloseTo(1);
    expect(scales["Bip001_Pelvis_03"].y).toBeCloseTo(1.02);
    expect(scales["Bip001_Pelvis_03"].z).toBeCloseTo(1.02);
    expect(scales["Bip001_Spine1_05"].y).toBeCloseTo(1.02);
    expect(scales["Bip001_Head_055"].x).toBeCloseTo(1);
    expect(scales["Bip001_L_UpperArm_08"].y).toBeCloseTo(1);
    expect(scales["Bip001_L_Thigh_057"].z).toBeCloseTo(1);
    expect(scales["Bip001_L_Calf_058"].x).toBeCloseTo(1);
    expect(scales["Bip001_L_Foot_059"].x).toBeCloseTo(1);
  });

  it("不同体型轮廓：脊柱收窄、骨盆与头部分级放大", () => {
    const adult = getUE4BodyBoneScales("mannequin");
    const female = getUE4BodyBoneScales("female");
    const child = getUE4BodyBoneScales("child");
    const chibi = getUE4BodyBoneScales("chibi");

    expect(adult["Bip001_Spine1_05"].y).toBeGreaterThan(female["Bip001_Spine1_05"].y);
    expect(female["Bip001_Pelvis_03"].y).toBeGreaterThan(adult["Bip001_Pelvis_03"].y);
    expect(child["Bip001_Head_055"].x).toBeGreaterThan(adult["Bip001_Head_055"].x);
    expect(chibi["Bip001_Head_055"].x).toBeGreaterThan(child["Bip001_Head_055"].x);
    expect(getUE4ModelScale("chibi")).toBeLessThan(getUE4ModelScale("mannequin"));
  });

  it("chibi 反向放大手掌：缩短的前臂仍保留可见手掌", () => {
    const chibi = getUE4BodyBoneScales("chibi");
    const lHand = chibi["Bip001_L_Hand_010"];
    const rHand = chibi["Bip001_R_Hand_034"];
    const lForearm = chibi["Bip001_L_Forearm_09"];

    expect(lHand.x).toBeCloseTo(rHand.x);
    expect(lHand.x).toBeGreaterThan(1.2);
    expect(lForearm.x * lHand.x).toBeGreaterThanOrEqual(0.88);
    expect(lForearm.y * lHand.y).toBeGreaterThanOrEqual(0.9);
    expect(lForearm.z * lHand.z).toBeGreaterThanOrEqual(0.9);
  });

  it("chibi 肩锚点保持在圆润躯干外沿之外，避免手掌被遮挡", () => {
    const chibi = getUE4BodyBoneScales("chibi");
    expect(chibi["Bip001_L_Clavicle_07"].x).toBeCloseTo(chibi["Bip001_R_Clavicle_031"].x);
    expect(chibi["Bip001_L_Clavicle_07"].x).toBeGreaterThanOrEqual(chibi["Bip001_Pelvis_03"].y);
  });

  it("成年（mannequin）双臂保持资产作者原始自然长度（~1）", () => {
    const adult = getUE4BodyBoneScales("mannequin");
    const broad = getUE4BodyBoneScales("broad");
    const muscular = getUE4BodyBoneScales("muscular");

    expect(adult["Bip001_L_UpperArm_08"].x).toBeCloseTo(1);
    expect(adult["Bip001_R_UpperArm_032"].x).toBeCloseTo(1);
    expect(adult["Bip001_L_Forearm_09"].x).toBeCloseTo(1);
    expect(adult["Bip001_R_Forearm_033"].x).toBeCloseTo(1);
    expect(broad["Bip001_L_UpperArm_08"].x).toBeCloseTo(1);
    expect(muscular["Bip001_L_UpperArm_08"].x).toBeCloseTo(1);
  });

  it("整模缩放：teen 0.88 / child 0.72 / chibi 0.56 / 其余 1", () => {
    expect(getUE4ModelScale("teen")).toBeCloseTo(0.88);
    expect(getUE4ModelScale("child")).toBeCloseTo(0.72);
    expect(getUE4ModelScale("chibi")).toBeCloseTo(0.56);
    for (const bodyType of ["mannequin", "female", "broad", "muscular", "slim"] as const) {
      expect(getUE4ModelScale(bodyType)).toBe(1);
    }
  });
});

describe("UE4 贴地 label 锚点表", () => {
  it("成年素体锚点位于 GLB 头顶上方", () => {
    expect(getUE4LabelAnchorY("mannequin")).toBeGreaterThan(1.8);
    expect(getUE4LabelAnchorY("mannequin")).toBeLessThan(2.3);
    expect(getUE4LabelAnchorY("teen")).toBeLessThan(getUE4LabelAnchorY("mannequin"));
    expect(getUE4LabelAnchorY("chibi")).toBeLessThan(getUE4LabelAnchorY("child"));
  });

  it("各体型表值与 REF 逐字一致", () => {
    expect(getUE4LabelAnchorY("female")).toBeCloseTo(1.98);
    expect(getUE4LabelAnchorY("slim")).toBeCloseTo(1.98);
    expect(getUE4LabelAnchorY("broad")).toBeCloseTo(2.08);
    expect(getUE4LabelAnchorY("muscular")).toBeCloseTo(2.08);
    expect(getUE4LabelAnchorY("mannequin")).toBeCloseTo(2.04);
    expect(getUE4LabelAnchorY("teen")).toBeCloseTo(1.78);
    expect(getUE4LabelAnchorY("child")).toBeCloseTo(1.46);
    expect(getUE4LabelAnchorY("chibi")).toBeCloseTo(1.18);
  });
});

// ---------------------------------------------------------------------------
// applyUE4Rig：rest 复位 → offsetY 英寸换算 → 骨缩放 → neutral → pose
// （REF ue4MannequinPoseApplication.test.ts 移植，语义 1:1）
// ---------------------------------------------------------------------------

describe("applyUE4Rig（rest 复位 + 姿势驱动）", () => {
  it("先按 rest 复位骨骼本地姿态，再乘体型缩放", () => {
    const scene = new THREE.Group();
    const spine = makeBone("Bip001_Spine1_05");
    spine.rotation.set(0.1, 0.2, 0.3);
    spine.scale.set(1.2, 1.1, 0.9);
    scene.add(spine);

    const rest = captureUE4RestPose(scene);
    const restQuaternion = spine.quaternion.clone();

    spine.rotation.set(0, 0, 0);
    spine.scale.set(9, 9, 9);

    applyUE4Rig(scene, rest, {}, "mannequin");

    // Spine1 无 neutral/pose 项：四元数应还原为 rest 值
    expectQuaternionClose(spine.quaternion, restQuaternion);
    expect(spine.scale.x).toBeCloseTo(1.2);
    expect(spine.scale.y).toBeCloseTo(1.1 * 1.02);
    expect(spine.scale.z).toBeCloseTo(0.9 * 1.02);
  });

  it("pose 控制以四元数乘法叠加在 bind 姿态之上", () => {
    const scene = new THREE.Group();
    const head = makeBone("Bip001_Head_055");
    head.rotation.set(0.2, -0.15, 0.08);
    scene.add(head);

    const rest = captureUE4RestPose(scene);
    const expected = head.quaternion
      .clone()
      .multiply(quaternionFromDegrees(20, 0, 0)); // head.yaw: 20 → x 轴

    applyUE4Rig(scene, rest, { "head.yaw": 20 }, "mannequin");

    expectQuaternionClose(head.quaternion, expected);
  });

  it("body.offsetY 经英寸换算沿骨盆本地 z 轴位移", () => {
    const scene = new THREE.Group();
    const pelvis = makeBone("Bip001_Pelvis_03");
    pelvis.position.set(1, 2, 3);
    scene.add(pelvis);

    const rest = captureUE4RestPose(scene);

    applyUE4Rig(scene, rest, { "body.offsetY": -0.22 }, "mannequin");

    expect(pelvis.position.x).toBeCloseTo(1);
    expect(pelvis.position.y).toBeCloseTo(2);
    expect(pelvis.position.z).toBeCloseTo(3 - 0.22 / 0.0254);
  });

  it("无用户姿势控制时应用 neutral 双臂微张修正", () => {
    const scene = new THREE.Group();
    const leftUpperArm = makeBone("Bip001_L_UpperArm_08");
    const leftForearm = makeBone("Bip001_L_Forearm_09");
    leftUpperArm.rotation.set(-0.24, 0.36, 0.12);
    leftForearm.rotation.set(0.1, -0.2, 0.3);
    scene.add(leftUpperArm);
    leftUpperArm.add(leftForearm);

    const rest = captureUE4RestPose(scene);
    const expectedUpperArm = leftUpperArm.quaternion.clone().multiply(quaternionFromDegrees(0, 25, 0));
    const expectedForearm = leftForearm.quaternion.clone().multiply(quaternionFromDegrees(0, 0, 25));

    applyUE4Rig(scene, rest, {}, "mannequin");

    expectQuaternionClose(leftUpperArm.quaternion, expectedUpperArm);
    expectQuaternionClose(leftForearm.quaternion, expectedForearm);
  });

  it("重复应用 pose 控制不会累积偏移", () => {
    const scene = new THREE.Group();
    const leftArm = makeBone("Bip001_L_UpperArm_08");
    leftArm.rotation.set(-0.4, 0.65, 0.18);
    scene.add(leftArm);

    const rest = captureUE4RestPose(scene);
    const expectedFirstPose = leftArm.quaternion
      .clone()
      .multiply(quaternionFromDegrees(0, 25, 0))
      .multiply(quaternionFromDegrees(0, -12, -18));
    const expectedSecondPose = leftArm.quaternion
      .clone()
      .multiply(quaternionFromDegrees(0, 25, 0))
      .multiply(quaternionFromDegrees(0, 6, 8));

    applyUE4Rig(scene, rest, { "leftShoulder.pitch": 18, "leftShoulder.spread": -12 }, "mannequin");
    applyUE4Rig(scene, rest, { "leftShoulder.pitch": -8, "leftShoulder.spread": 6 }, "mannequin");

    expectQuaternionClose(leftArm.quaternion, expectedSecondPose);
    expect(leftArm.quaternion.angleTo(expectedFirstPose)).toBeGreaterThan(0.1);
  });

  it("最小 3 骨骨架不抛错且骨骼旋转符号符合预期", () => {
    const scene = new THREE.Group();
    const root = makeBone("Bip001_Pelvis_03");
    const rightThigh = makeBone("Bip001_R_Thigh_061");
    const rightForearm = makeBone("Bip001_R_Forearm_033");
    scene.add(root);
    root.add(rightThigh);
    rightThigh.add(rightForearm);

    const rest = captureUE4RestPose(scene);

    expect(() =>
      applyUE4Rig(
        scene,
        rest,
        { "rightHip.pitch": 24, "rightHip.spread": 12, "rightElbow.bend": 45 },
        "chibi"
      )
    ).not.toThrow();

    // 髋 pitch 为正 → 髋绕 +z；forearm 先 neutral(+z25°) 再 bend(z 负)
    expectQuaternionClose(
      rightThigh.quaternion,
      rest.boneLocal.get("Bip001_R_Thigh_061")!.quaternion
        .clone()
        .multiply(quaternionFromDegrees(0, -12, 24))
    );
    expectQuaternionClose(
      rightForearm.quaternion,
      rest.boneLocal.get("Bip001_R_Forearm_033")!.quaternion
        .clone()
        .multiply(quaternionFromDegrees(0, 0, 25))
        .multiply(quaternionFromDegrees(0, 0, -45))
    );
  });

  it("chibi/child 姿势限位（±58/±72）在 apply 时生效", () => {
    const scene = new THREE.Group();
    const forearm = makeBone("Bip001_L_Forearm_09");
    scene.add(forearm);
    const rest = captureUE4RestPose(scene);

    applyUE4Rig(scene, rest, { "leftElbow.bend": 90 }, "chibi");
    // bend 90 → 钳制 58；叠加 neutral z+25°
    expectQuaternionClose(
      forearm.quaternion,
      rest.boneLocal.get("Bip001_L_Forearm_09")!.quaternion
        .clone()
        .multiply(quaternionFromDegrees(0, 0, 25))
        .multiply(quaternionFromDegrees(0, 0, -58))
    );

    applyUE4Rig(scene, rest, { "leftElbow.bend": 90 }, "child");
    expectQuaternionClose(
      forearm.quaternion,
      rest.boneLocal.get("Bip001_L_Forearm_09")!.quaternion
        .clone()
        .multiply(quaternionFromDegrees(0, 0, 25))
        .multiply(quaternionFromDegrees(0, 0, -72))
    );
  });

  it("未登记的骨骼（非 rest 内骨骼）保持不动", () => {
    const scene = new THREE.Group();
    const stranger = makeBone("Some Other Bone");
    stranger.rotation.set(0.3, -0.2, 0.1);
    stranger.scale.set(2, 2, 2);
    scene.add(stranger);

    const rest = captureUE4RestPose(scene);
    const quaternion = stranger.quaternion.clone();

    applyUE4Rig(scene, rest, { "head.yaw": 40, "body.offsetY": -0.22 }, "chibi");

    expectQuaternionClose(stranger.quaternion, quaternion);
    expect(stranger.scale.x).toBeCloseTo(2);
  });
});

// ---------------------------------------------------------------------------
// captureUE4RestPose
// ---------------------------------------------------------------------------

describe("captureUE4RestPose", () => {
  it("只登记 isBone 对象并保存 local position/quaternion/scale", () => {
    const scene = new THREE.Group();
    const pelvis = makeBone("Bip001_Pelvis_03");
    pelvis.position.set(1, 2, 3);
    pelvis.rotation.set(0.2, 0.3, 0.4);
    pelvis.scale.set(2, 3, 4);
    scene.add(pelvis);
    scene.add(new THREE.Object3D()); // 非骨骼对象不应被登记

    const rest: Ue4RestPose = captureUE4RestPose(scene);
    const entry = rest.boneLocal.get("Bip001_Pelvis_03");

    expect(rest.boneLocal.size).toBe(1);
    expect(entry).toBeDefined();
    expect(entry!.position.toArray()).toEqual([1, 2, 3]);
    expect(entry!.scale.toArray()).toEqual([2, 3, 4]);
    expectQuaternionClose(entry!.quaternion, pelvis.quaternion.clone());
  });
});

// ---------------------------------------------------------------------------
// alignToGround（bounds 迭代 ≤5 次，REF UE4MannequinModel.tsx 移植）
// ---------------------------------------------------------------------------

describe("alignToGround", () => {
  /** 网格：盒子底边位于组原点下方 bottomOffsetY 处（模拟 GLB 原点在腰部、脚在负 Y） */
  function meshWithLocalBottom(bottomOffsetY: number, sizeX = 0.5, sizeY = 1, sizeZ = 0.5) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sizeX, sizeY, sizeZ), new THREE.MeshBasicMaterial());
    mesh.position.y = bottomOffsetY + sizeY / 2;
    return mesh;
  }

  it("抬升对象迭代贴地：底边世界 y 收敛到 ≈0", () => {
    const scene = new THREE.Group();
    scene.position.set(0.4, 1.5, -0.3);
    scene.add(meshWithLocalBottom(-0.3));

    alignToGround(scene);

    // 底边本地 -0.3 → 目标 scene.y = 0.3（底边世界 y = 0）
    expect(scene.position.y).toBeCloseTo(0.3, 6);
    // 保持 x/z 不动
    expect(scene.position.x).toBeCloseTo(0.4);
    expect(scene.position.z).toBeCloseTo(-0.3);
  });

  it("已贴地对象幂等：二次调用不再移动", () => {
    const scene = new THREE.Group();
    scene.position.set(0, 1.5, 0);
    scene.add(meshWithLocalBottom(-0.3));
    alignToGround(scene);
    const yAfterFirst = scene.position.y;
    alignToGround(scene);
    expect(scene.position.y).toBeCloseTo(yAfterFirst, 9);
    expect(scene.position.y).toBeCloseTo(0.3);
  });

  it("嵌套在缩放父组内时按父空间贴地：单调收敛且不越界到负", () => {
    const scaledParent = new THREE.Group();
    scaledParent.scale.set(0.5, 0.6, 0.5);
    const scene = new THREE.Group();
    scene.position.y = 2;
    scene.add(meshWithLocalBottom(-1, 0.5, 2, 0.5)); // 底边在 scene 原点下 1 单位
    scaledParent.add(scene);

    const measureBottomInParentLocal = () => {
      scaledParent.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(scene, true);
      return bounds.min.y / 0.6; // 世界底边折算回父空间（父 scale.y=0.6、无位移）
    };

    const before = measureBottomInParentLocal();
    expect(before).toBeCloseTo(1.0); // 底边本地 y=-1、scene 原点父空间 y=2 → 2 + (-1)
    alignToGround(scene);

    // 目标 scene.y=1（底边父空间 0）；迭代按 (1-0.6) 衰减、5 次内逼近
    const after = measureBottomInParentLocal();
    expect(after).toBeGreaterThan(-1e-9); // 不越界到地下
    expect(after).toBeLessThan(before); // 单调收敛
    expect(after).toBeLessThan(0.02); // 已贴近地面（余量 < 2% 父空间单位）
    expect(scene.position.y).toBeGreaterThan(0.99);
    expect(scene.position.y).toBeLessThan(2);
  });

  it("无网格对象为空包围盒：按 REF 语义落回 y=0 且不抛错", () => {
    const scene = new THREE.Group();
    scene.position.set(0, 4, 0);
    expect(() => alignToGround(scene)).not.toThrow();
    expect(scene.position.y).toBeCloseTo(0);
  });
});

// ---------------------------------------------------------------------------
// 真实资产集成：rig 表 ↔ public/models/ue-mannequin-retopology.glb 绑定
// ---------------------------------------------------------------------------

const GLB_PATH = path.join(process.cwd(), "public", "models", "ue-mannequin-retopology.glb");
const LICENSE_PATH = path.join(process.cwd(), "public", "models", "ue-mannequin-retopology.license.txt");

/** 提取 GLB 首 JSON chunk */
function readGltfJsonChunk(buffer: Buffer) {
  const jsonLength = buffer.readUInt32LE(12);
  return JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength)) as Record<string, unknown> & {
    nodes?: { name?: string }[];
    materials?: Record<string, unknown>[];
    images?: unknown[];
    textures?: unknown[];
  };
}

/** 去除材质纹理引用（node 无 image 解码能力，parse 前剥离内嵌 PNG） */
function stripGltfTextures(buffer: Buffer) {
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength)) as Record<string, unknown> & {
    materials?: Record<string, unknown>[];
    images?: unknown[];
    textures?: unknown[];
  };

  for (const material of json.materials ?? []) {
    const pbr = material.pbrMetallicRoughness as Record<string, unknown> | undefined;
    if (pbr) {
      delete pbr.baseColorTexture;
      delete pbr.metallicRoughnessTexture;
    }
    delete material.emissiveTexture;
    delete material.normalTexture;
    delete material.occlusionTexture;
    delete material.alphaTexture;
  }
  delete json.images;
  delete json.textures;

  const jsonRaw = Buffer.from(JSON.stringify(json), "utf8");
  const newJsonLength = Math.ceil(jsonRaw.length / 4) * 4;

  // 原 BIN chunk（原 JSON chunk 数据区紧随其后）
  const binChunkStart = 20 + jsonLength + 8;
  const binChunkLength = buffer.readUInt32LE(20 + jsonLength + 4);

  const out = Buffer.alloc(12 + 8 + newJsonLength + 8 + binChunkLength);
  out.write("glTF", 0, "ascii");
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(newJsonLength, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonRaw.copy(out, 20);
  out.fill(0x20, 20 + jsonRaw.length, 20 + newJsonLength); // 对齐填充空格（合法 JSON 空白）
  out.writeUInt32LE(binChunkLength, 20 + newJsonLength);
  out.writeUInt32LE(0x004e4942, 24 + newJsonLength);
  buffer.copy(out, 28 + newJsonLength, binChunkStart, binChunkStart + binChunkLength);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

describe("资产集成：rig 表 ↔ 真实 GLB", () => {
  it("随包资产存在且含 Sketchfab 许可", () => {
    const glb = readFileSync(GLB_PATH);
    expect(glb.length).toBeGreaterThan(500_000);
    expect(glb.toString("ascii", 0, 4)).toBe("glTF");

    const license = readFileSync(LICENSE_PATH, "utf8");
    expect(license).toMatch(/SKETCHFAB/i);
    expect(license).toMatch(/William Luque/);
  });

  it("GLB JSON 节点名经 GLTFLoader sanitize 后与 rig 表键完全一致", () => {
    const glb = readFileSync(GLB_PATH);
    const json = readGltfJsonChunk(glb);
    const rawNodeNames = new Set((json.nodes ?? []).map((node) => node.name));

    // glTF JSON 里节点名是空格分隔且数字后缀仍带下划线（如 "Bip001 Spine1_05"）；
    // 故把词间下划线（后随字母）还原为空格后应能在原始节点名中找到
    for (const bone of CORE_BONES) {
      const rawName = bone.replace(/_(?=[A-Za-z])/g, " ");
      expect(rawNodeNames.has(rawName), `JSON 缺节点: ${rawName}`).toBe(true);
    }
    // 但 GLTFLoader 用 PropertyBinding.sanitizeNodeName 将空白转下划线（r185），
    // 因此运行时骨骼名即 REF/本模块映射表键——下面真实加载用例继续锁定
    expect(rawNodeNames.has(CORE_BONES[0]), "原始 JSON 不应直接含下划线名").toBe(false);
  });

  it("GLTFLoader.parse 后 rig 完整驱动真实骨架（缩放/位移/旋转绑定）", async () => {
    const glb = readFileSync(GLB_PATH);
    const gltf = await new GLTFLoader().parseAsync(stripGltfTextures(glb), "");

    const bonesByName = new Map<string, THREE.Bone>();
    gltf.scene.traverse((object) => {
      if ("isBone" in object && object.isBone === true) {
        bonesByName.set(object.name, object as THREE.Bone);
      }
    });
    expect(bonesByName.size).toBeGreaterThanOrEqual(67);

    for (const bone of CORE_BONES) {
      expect(bonesByName.has(bone), `骨架缺骨: ${bone}`).toBe(true);
    }

    const rest = captureUE4RestPose(gltf.scene);
    expect(rest.boneLocal.size).toBe(bonesByName.size);

    applyUE4Rig(
      gltf.scene,
      rest,
      { "body.offsetY": -0.22, "head.yaw": 20, "rightElbow.bend": 45, "rightHip.pitch": 24 },
      "chibi"
    );

    // chibi 头骨缩放 ×4（叠加 rest）
    const head = bonesByName.get("Bip001_Head_055")!;
    const headRest = rest.boneLocal.get("Bip001_Head_055")!;
    expect(head.scale.x).toBeCloseTo(headRest.scale.x * 4);
    expect(head.scale.y).toBeCloseTo(headRest.scale.y * 4);

    // pelvis 本地 z 沿 offsetY 英寸换算位移
    const pelvis = bonesByName.get("Bip001_Pelvis_03")!;
    const pelvisRest = rest.boneLocal.get("Bip001_Pelvis_03")!;
    expect(pelvis.position.z).toBeCloseTo(pelvisRest.position.z - 0.22 / 0.0254);
    expect(pelvis.position.x).toBeCloseTo(pelvisRest.position.x);
    expect(pelvis.position.y).toBeCloseTo(pelvisRest.position.y);

    // head.yaw: 20 → +x 轴叠加（头无 neutral）
    const headExpected = headRest.quaternion.clone().multiply(quaternionFromDegrees(20, 0, 0));
    expectQuaternionClose(head.quaternion, headExpected);

    // right forearm：neutral(z+25°) × bend(z−45°)；chibi 限位 58 未触及
    const forearm = bonesByName.get("Bip001_R_Forearm_033")!;
    const forearmRest = rest.boneLocal.get("Bip001_R_Forearm_033")!;
    const forearmExpected = forearmRest.quaternion
      .clone()
      .multiply(quaternionFromDegrees(0, 0, 25))
      .multiply(quaternionFromDegrees(0, 0, -45));
    expectQuaternionClose(forearm.quaternion, forearmExpected);

    // right thigh：hip spread 反向、pitch 正向
    const thigh = bonesByName.get("Bip001_R_Thigh_061")!;
    const thighRest = rest.boneLocal.get("Bip001_R_Thigh_061")!;
    const thighExpected = thighRest.quaternion.clone().multiply(quaternionFromDegrees(0, 0, 24));
    expectQuaternionClose(thigh.quaternion, thighExpected);

    // 未随 chibi 缩放的骨应保持 rest 数值
    const calf = bonesByName.get("Bip001_R_Calf_062")!;
    const calfRest = rest.boneLocal.get("Bip001_R_Calf_062")!;
    expect(calf.scale.y).toBeCloseTo(calfRest.scale.y * 0.9);
  });
});
