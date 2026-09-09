/**
 * UE4 素体运行时（GLB 加载 / 实例克隆 / 染色 / 程序化回退）
 *
 * 移植自 REF（数值与语义 1:1；React/R3F 外壳换成本仓库的「three 对象 + 手动释放」形态）：
 *   - src/editor/runtime/UE4MannequinModel.tsx             （GLB 加载/克隆/材质隔离+染色/贴地）
 *   - src/editor/runtime/CharacterModel.tsx                （回退语义：UE4 失败 → 程序化人偶）
 *   - src/editor/runtime/mannequin/ProceduralMannequin.tsx （程序化路径：词表 → 关节组旋转映射）
 *   - src/editor/runtime/mannequin/mannequinPose.ts        （getRotationFromControls / getSingleAxisRotation）
 *
 * 两条渲染路径共用同一份 v3 词表（previs-poses.POSE_VOCAB）与同一套限位（±58/72/90）：
 *   - UE4 路径（默认）：SkeletonUtils.clone → 材质克隆+染色（胸 logo 豁免）→ captureUE4RestPose
 *     + applyUE4Rig → alignToGround → 整模缩放组（getUE4ModelScale）
 *   - 程序化路径（GLB 未就绪/失败/实例化异常）：本文件内的精细人偶构建器——几何沿用 parity
 *     交付的胶囊/接缝环/五官外观，四肢拆成 肩/肘、髋/膝 两段 + 手/脚末端，使词表键可驱动
 *
 * 调用方（viewport）负责 item.position/rotation/scale 与 itemId 标注；本模块只保证
 * 「最低点（站立时即脚底）在返回对象本地 y=0」——UE4 与程序化两路一致（v2 语义）。
 *
 * 释放契约：`dispose()` 只释放本实例独占的资源——UE4 路径为克隆材质 + 每个 SkinnedMesh
 * 的 Skeleton（含骨骼纹理；几何/源材质/源骨骼是与 GLB 缓存共享的资源，绝不释放）；
 * 程序化路径为本实例新建的全部几何/材质。
 */

import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js"

import { BODY_TYPE_BY_ID, POSE_LIMIT_BY_BODY_TYPE } from "@/lib/engine/previs-poses"
import {
  alignToGround,
  applyUE4Rig,
  captureUE4RestPose,
  getUE4ModelScale,
  type Ue4BodyType,
} from "@/lib/engine/previs-ue4-rig"
import type { BlockingItem } from "@/lib/types"

/** UE4 素体资产（public/models/；随静态导出与 Electron 打包分发） */
const UE4_MODEL_URL = "/models/ue-mannequin-retopology.glb"

/** 角色默认染色（spec §2.1/§6 默认色 #4F8EF7；= viewport ITEM_COLOR.character，两路共用） */
export const CHARACTER_DEFAULT_TINT = 0x4f8ef7

/** 深色细节（接缝环/五官/手/脚末端）材质色（自 viewport 随程序化构建器迁入） */
const DETAIL_COLOR = 0x070a0f

/** 角色染色：item.color（#rrggbb）优先，缺省 CHARACTER_DEFAULT_TINT——语义同 viewport resolveItemColor 的 character 分支 */
export function resolveCharacterTint(item: BlockingItem): number {
  if (item.color) {
    const n = Number.parseInt(item.color.replace("#", ""), 16)
    if (!Number.isNaN(n)) return n
  }
  return CHARACTER_DEFAULT_TINT
}

/** item.bodyType（string）→ UE4 体型 id（未命中一律回默认素体，同迁移侧宽容策略） */
function normalizeBodyType(bodyType?: string): Ue4BodyType {
  return BODY_TYPE_BY_ID[bodyType ?? "mannequin"]?.id ?? "mannequin"
}

/* ==========================================================================
 * GLB 加载（模块级单次；成功缓存场景，失败永久回退程序化——不重试）
 * ========================================================================== */

let ue4Ready: Promise<THREE.Group> | null = null
let ue4Scene: THREE.Group | null = null

/**
 * 加载 UE4 素体 GLB（幂等：同一 promise 只加载一次）。
 * 失败时 reject（缓存的是同一个已 reject 的 promise → 调用方反复拿到失败，无重试循环）；
 * 内部挂一个空 catch 防止 unhandledrejection，调用方仍可 await/catch 到原始错误。
 */
export function ensureUe4Model(): Promise<THREE.Group> {
  if (!ue4Ready) {
    ue4Ready = new Promise<THREE.Group>((resolve, reject) => {
      new GLTFLoader().load(
        UE4_MODEL_URL,
        (gltf) => {
          ue4Scene = gltf.scene
          resolve(gltf.scene)
        },
        undefined,
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      )
    })
    ue4Ready.catch(() => {})
  }
  return ue4Ready
}

/** UE4 源场景是否已就绪（viewport 用它初始化重建代数，避免二次重建） */
export function isUe4ModelReady(): boolean {
  return ue4Scene !== null
}

/* ==========================================================================
 * 材质隔离 + 染色（移植自 REF UE4MannequinModel.tsx:41-75）
 * ========================================================================== */

/** 胸 logo 材质名（REF :46 逐字；该材质不参与染色） */
const CHEST_LOGO_MATERIAL_NAME = "SK_Mannequin_M_UE4Man_ChestLogo"

/** 移植自 REF UE4MannequinModel.tsx:41-53（tintMaterial）：仅 MeshStandardMaterial 且非胸 logo */
function tintMaterial(material: THREE.Material | THREE.Material[], color: THREE.Color) {
  const materials = Array.isArray(material) ? material : [material]

  materials.forEach((item) => {
    if (item instanceof THREE.MeshStandardMaterial && item.name !== CHEST_LOGO_MATERIAL_NAME) {
      item.color.copy(color)
      item.roughness = 0.68
      item.metalness = 0.04
      item.needsUpdate = true
    }
  })
}

/** 移植自 REF UE4MannequinModel.tsx:55-57（cloneMaterialInstance） */
function cloneMaterialInstance(material: THREE.Material | THREE.Material[]) {
  return Array.isArray(material) ? material.map((item) => item.clone()) : material.clone()
}

/**
 * 实例材质隔离 + 染色：逐 SkinnedMesh 克隆材质（绝不改写 GLB 共享材质）后染色。
 * 移植自 REF UE4MannequinModel.tsx:59-75（isolateAndTintUE4MannequinMaterials）；
 * REF 参数为颜色字符串，本模块收 tint number（调用方已解析）。
 */
export function isolateAndTintUE4MannequinMaterials(scene: THREE.Object3D, tint: number) {
  const nextColor = new THREE.Color(tint)

  scene.traverse((object) => {
    object.frustumCulled = false

    const skinned = object as THREE.SkinnedMesh
    if (!("isSkinnedMesh" in object) || skinned.isSkinnedMesh !== true) return

    skinned.castShadow = true
    skinned.receiveShadow = true

    if (!object.userData.storyAiIsolatedMaterial) {
      skinned.material = cloneMaterialInstance(skinned.material)
      object.userData.storyAiIsolatedMaterial = true
    }

    tintMaterial(skinned.material, nextColor)
  })
}

/**
 * 释放本实例独占的资源：克隆材质（仅 storyAiIsolatedMaterial 标记的克隆体）
 * + 每个 SkinnedMesh 的 Skeleton。SkeletonUtils.clone 逐克隆新建 Skeleton
 * （skeleton.clone()，boneTexture 首次渲染时分配）→ 逐 SkinnedMesh 释放骨骼纹理；
 * 共享几何/源材质/源骨骼不动。
 */
function disposeIsolatedResources(root: THREE.Object3D) {
  root.traverse((object) => {
    const skinned = object as THREE.SkinnedMesh
    if (skinned.isSkinnedMesh) skinned.skeleton?.dispose()

    if (!object.userData.storyAiIsolatedMaterial) return
    const material = (object as THREE.Mesh).material
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else material?.dispose()
  })
}

/* ==========================================================================
 * 创建角色模型（UE4 优先，失败/未就绪 → 程序化）
 * ========================================================================== */

export interface CharacterModelHandle {
  /** 组原点 = 角色最低点（站立时即脚底）；调用方施加 item.position/rotation/scale */
  object: THREE.Object3D
  /** 释放本实例独占资源（见文件头「释放契约」） */
  dispose: () => void
}

export interface CreateCharacterModelOptions {
  /** 覆盖模块缓存的 UE4 源场景（测试注入；缺省 = ensureUe4Model 的缓存结果） */
  ue4Scene?: THREE.Object3D | null
}

/**
 * 角色模型工厂：UE4 素体优先，未就绪或实例化异常 → 程序化精细人偶（同 REF CharacterModel 回退语义）。
 * 两路都消费同一份 v3 controls 与体型 id。
 */
export function createCharacterModel(
  item: BlockingItem,
  options?: CreateCharacterModelOptions,
): CharacterModelHandle {
  const source = options?.ue4Scene !== undefined ? options.ue4Scene : ue4Scene

  if (source) {
    try {
      return buildUe4Mannequin(item, source)
    } catch (err) {
      // 实例化/驱动异常 → 程序化回退（单件级；不影响其他角色）
      console.warn("[previs] UE4 素体实例化失败，回退程序化人偶", err)
    }
  }

  return buildProceduralMannequin(item)
}

/**
 * UE4 路径：克隆 → 染色 → rest 快照 + rig 驱动 → 贴地 → 整模缩放组。
 * 结构：object（调用方位姿）→ scaleGroup（getUE4ModelScale）→ clone（脚底贴本地 y=0）。
 */
function buildUe4Mannequin(item: BlockingItem, source: THREE.Object3D): CharacterModelHandle {
  const bodyType = normalizeBodyType(item.bodyType)
  const clone = cloneSkeleton(source) as THREE.Group
  const dispose = () => disposeIsolatedResources(clone)

  const object = new THREE.Group()
  const scaleGroup = new THREE.Group()
  scaleGroup.scale.setScalar(getUE4ModelScale(bodyType))
  scaleGroup.add(clone)
  object.add(scaleGroup)

  try {
    isolateAndTintUE4MannequinMaterials(clone, resolveCharacterTint(item))
    applyUE4Rig(clone, captureUE4RestPose(clone), item.controls ?? {}, bodyType)
    // 贴地：在 scaleGroup 本地空间测量并修正（同 REF <group scale><primitive/></group> 语义）
    alignToGround(clone)
  } catch (err) {
    dispose()
    throw err
  }

  return { object, dispose }
}

/* ==========================================================================
 * 程序化精细人偶（v3 词表驱动；几何沿用 parity 交付外观）
 * ========================================================================== */

/** 关节填充球半径系数：0.98×段半径——中性站姿下完全藏于两段胶囊内部，弯曲时补上关节缺口 */
const JOINT_FILLER_SCALE = 0.98

/**
 * 程序化人偶：骨盆球 + 躯干双胶囊（腹/胸）+ 深色接缝环 + 头（眼鼻嘴）
 *   + 四肢两段（肩/肘、髋/膝）+ 深色手/脚末端。
 * 层级（组原点 = 脚底平面，高度沿 +y，默认面向 +Z）：
 *   object → groundGroup（贴地对齐目标）→ bodyGroup（body.* 旋转 + body.offsetY 位移）
 *     → 骨盆 + torsoGroup（躯干 + 头 + 双臂）+ 左/右腿组
 * 词表映射（移植 REF mannequinPose.ts 的方向）：
 *   body/torso/head = [pitch, yaw, roll]（getRotationFromControls）
 *   肩/髋 = [pitch, twist, spread]（ProceduralMannequin.getLimbRotation）
 *   肘/膝 = [bend, 0, 0]（getSingleAxisRotation）
 *   手/脚 = [pitch, twist, roll]（REF 程序化路径未驱动手/脚；按 getLimbRotation 同构补全）
 * 全部经体型限位钳制（chibi ±58 / child ±72 / 其余 ±90）。
 */
function buildProceduralMannequin(item: BlockingItem): CharacterModelHandle {
  const bodyType = normalizeBodyType(item.bodyType)
  const limit = POSE_LIMIT_BY_BODY_TYPE[bodyType] ?? 90
  const controls = item.controls ?? {}
  const h = BODY_TYPE_BY_ID[bodyType]?.height ?? 1.86

  const deg = (value: number) => (value * Math.PI) / 180
  const clampDeg = (value: number) => Math.min(limit, Math.max(-limit, value))

  /** 移植自 REF mannequinPose.ts:23-35（getRotationFromControls）：[pitch, yaw, roll] */
  const rotationFrom = (prefix: string): [number, number, number] => [
    deg(clampDeg(controls[`${prefix}.pitch`] ?? 0)),
    deg(clampDeg(controls[`${prefix}.yaw`] ?? 0)),
    deg(clampDeg(controls[`${prefix}.roll`] ?? 0)),
  ]
  /** 移植自 REF ProceduralMannequin.tsx:17-27（getLimbRotation）：[pitch, twist, spread] */
  const limbRotation = (prefix: string): [number, number, number] => [
    deg(clampDeg(controls[`${prefix}.pitch`] ?? 0)),
    deg(clampDeg(controls[`${prefix}.twist`] ?? 0)),
    deg(clampDeg(controls[`${prefix}.spread`] ?? 0)),
  ]
  /** 移植自 REF mannequinPose.ts:37-44（getSingleAxisRotation）：肘/膝单轴 bend */
  const singleAxis = (key: string): [number, number, number] => [deg(clampDeg(controls[key] ?? 0)), 0, 0]
  /** 手/脚（REF 程序化路径未驱动）：pitch/twist/roll → x/y/z，同 getLimbRotation 的轴位约定 */
  const extremityRotation = (prefix: string): [number, number, number] => [
    deg(clampDeg(controls[`${prefix}.pitch`] ?? 0)),
    deg(clampDeg(controls[`${prefix}.twist`] ?? 0)),
    deg(clampDeg(controls[`${prefix}.roll`] ?? 0)),
  ]

  const mat = new THREE.MeshStandardMaterial({ color: resolveCharacterTint(item), metalness: 0.04, roughness: 0.74 })
  const dark = new THREE.MeshStandardMaterial({ color: DETAIL_COLOR, metalness: 0.1, roughness: 0.85 })

  const hipY = h * 0.52
  const shoulderY = h * 0.8
  const dT = shoulderY - hipY // 髋→肩 躯干高度段
  const chestR = 0.3
  const hipR = 0.32
  const armLen = h * 0.33
  const armRad = 0.09
  const legRad = 0.13
  const shoulderX = 0.33
  const headR = h * 0.1
  const upperArmLen = armLen * 0.5
  const forearmLen = armLen * 0.5
  const thighLen = hipY * 0.5
  const calfLen = hipY * 0.5

  /** 肢体段（沿用旧 limb 几何）：胶囊沿 -y 从枢轴下垂 len（下端 = 枢轴 − len，总高恰为 len） */
  const segment = (len: number, rad: number): THREE.Mesh => {
    const seg = new THREE.Mesh(new THREE.CapsuleGeometry(rad, Math.max(0.05, len - rad * 2), 4, 12), mat)
    seg.position.y = -len / 2
    return seg
  }
  /** 关节填充球：半径略小于段半径（中性藏于胶囊内，弯曲补缝） */
  const jointFiller = (rad: number): THREE.Mesh =>
    new THREE.Mesh(new THREE.SphereGeometry(rad * JOINT_FILLER_SCALE, 12, 10), mat)
  /** 末端（手/脚）深色球：偏移沿用旧 limb 末端（手球心略高于臂端，脚球底恰在踝点） */
  const tip = (rad: number, y: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(rad, 10, 8), dark)
    m.position.y = y
    return m
  }

  const object = new THREE.Group()
  // 贴地对齐目标（alignToGround 会重置其 position.y；offsetY 因此不能挂在这一层）
  const groundGroup = new THREE.Group()
  groundGroup.name = "procedural-ground"
  // body.* 旋转（REF 程序化路径挂最外层）+ body.offsetY（米，负数下蹲）
  const bodyGroup = new THREE.Group()
  bodyGroup.name = "procedural-body"
  bodyGroup.rotation.set(...rotationFrom("body"))
  bodyGroup.position.y = controls["body.offsetY"] ?? 0
  groundGroup.add(bodyGroup)
  object.add(groundGroup)

  // —— 骨盆（髋位球）——
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(hipR, 16, 12), mat)
  pelvis.position.y = hipY - 0.02 * h
  bodyGroup.add(pelvis)

  // —— 躯干关节组（原点 = 髋高）——
  const torsoGroup = new THREE.Group()
  torsoGroup.name = "procedural-torso"
  torsoGroup.position.y = hipY
  torsoGroup.rotation.set(...rotationFrom("torso"))
  bodyGroup.add(torsoGroup)

  // 下腹胶囊（腰→下胸）与上胸胶囊（胸→肩；顶点收在头底之下，避免吞没头部）
  const belly = new THREE.Mesh(new THREE.CapsuleGeometry(chestR * 0.92, Math.max(0.05, dT * 0.62), 4, 12), mat)
  belly.position.y = dT * 0.31
  torsoGroup.add(belly)
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(chestR * 0.8, Math.max(0.05, dT * 0.34), 4, 12), mat)
  chest.position.y = dT * 0.62
  torsoGroup.add(chest)

  // 深色接缝环：管 0.018 微嵌体表、外露成细环——腰环贴腹段、颈环贴胸段上缘
  const seam = (y: number, r: number) => {
    const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018, 6, 20), dark)
    t.rotation.x = Math.PI / 2
    t.position.y = y
    torsoGroup.add(t)
  }
  seam(dT * 0.55, chestR * 0.94) // 腰环（腹 0.92·chestR 截面外 +6mm）
  seam(dT * 0.95, chestR * 0.76) // 颈环（胸 0.8·chestR 截面外 +5mm）

  // —— 头（随躯干组）：球 + 深色五官（眼/鼻/嘴，+Z 面向）——
  const headGroup = new THREE.Group()
  headGroup.name = "procedural-head"
  headGroup.position.set(0, dT + headR * 1.15, 0) // 世界 y = shoulderY + 1.15·headR（头顶 ≈ h）
  headGroup.rotation.set(...rotationFrom("head"))
  const skull = new THREE.Mesh(new THREE.SphereGeometry(headR, 18, 14), mat)
  headGroup.add(skull)
  const fz = headR * 0.86 // 眼 z（球心嵌入颅面，微凸）
  const eyeY = headR * 0.16
  const eyeX = headR * 0.34
  const mk = (x: number, y: number, z: number, r: number) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), dark)
    m.position.set(x, y, z)
    headGroup.add(m)
  }
  mk(-eyeX, eyeY, fz, headR * 0.16) // 眼
  mk(eyeX, eyeY, fz, headR * 0.16) // 眼
  mk(0, -eyeY * 0.3, headR * 0.95, headR * 0.1) // 鼻（凸出颅面）
  mk(0, -eyeY * 1.5, headR * 0.98, headR * 0.14) // 嘴（凸出颅面）
  torsoGroup.add(headGroup)

  // —— 手臂：肩组（pitch/twist/spread）→ 上臂段 → 肘组（bend）→ 前臂段 + 手组 ——
  const arm = (side: -1 | 1, shoulderKey: string, elbowKey: string, handKey: string) => {
    const shoulder = new THREE.Group()
    shoulder.name = `procedural-${shoulderKey}`
    shoulder.position.set(side * shoulderX, dT, 0)
    shoulder.rotation.set(...limbRotation(shoulderKey))
    shoulder.add(segment(upperArmLen, armRad))

    const elbow = new THREE.Group()
    elbow.name = `procedural-${elbowKey}`
    elbow.position.y = -upperArmLen
    elbow.rotation.set(...singleAxis(`${elbowKey}.bend`))
    elbow.add(jointFiller(armRad))
    elbow.add(segment(forearmLen, armRad))

    const hand = new THREE.Group()
    hand.name = `procedural-${handKey}`
    hand.position.y = -forearmLen
    hand.rotation.set(...extremityRotation(handKey))
    hand.add(tip(armRad * 1.2, armRad * 0.45))
    elbow.add(hand)

    shoulder.add(elbow)
    return shoulder
  }
  torsoGroup.add(arm(-1, "leftShoulder", "leftElbow", "leftHand"))
  torsoGroup.add(arm(1, "rightShoulder", "rightElbow", "rightHand"))

  // —— 腿：髋组（pitch/twist/spread）→ 大腿段 → 膝组（bend）→ 小腿段 + 脚组 ——
  const leg = (side: -1 | 1, hipKey: string, kneeKey: string, footKey: string) => {
    const hip = new THREE.Group()
    hip.name = `procedural-${hipKey}`
    hip.position.set(side * 0.17, hipY, 0)
    hip.rotation.set(...limbRotation(hipKey))
    hip.add(segment(thighLen, legRad))

    const knee = new THREE.Group()
    knee.name = `procedural-${kneeKey}`
    knee.position.y = -thighLen
    knee.rotation.set(...singleAxis(`${kneeKey}.bend`))
    knee.add(jointFiller(legRad))
    knee.add(segment(calfLen, legRad))

    const foot = new THREE.Group()
    foot.name = `procedural-${footKey}`
    foot.position.y = -calfLen
    foot.rotation.set(...extremityRotation(footKey))
    foot.add(tip(legRad * 1.05, legRad * 1.05)) // 球底恰在踝点（站立时贴地）
    knee.add(foot)

    hip.add(knee)
    return hip
  }
  bodyGroup.add(leg(-1, "leftHip", "leftKnee", "leftFoot"))
  bodyGroup.add(leg(1, "rightHip", "rightKnee", "rightFoot"))

  // 贴地：与 UE4 路径同一函数/语义（offsetY/姿势折叠后仍保证最低点贴 item.position[1]）
  alignToGround(groundGroup)

  const dispose = () => {
    object.traverse((o) => {
      const mesh = o as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(material)) material.forEach((item) => item.dispose())
      else material?.dispose()
    })
  }

  return { object, dispose }
}
