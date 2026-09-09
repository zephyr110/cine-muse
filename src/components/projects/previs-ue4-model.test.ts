/**
 * previs-ue4-model：UE4 运行时与程序化回退的绑定测试。
 *
 * 覆盖：
 * 1) 程序化回退路径（UE4 未就绪/实例化异常）——v3 词表 → 关节组旋转映射、体型限位、
 *    body.offsetY + 贴地、dispose 释放本实例几何/材质；
 * 2) UE4 路径（真实资产 parseAsync 注入）——SkeletonUtils 克隆 + 材质隔离染色（源材质不被改写）
 *    + 整模缩放组 + 贴地 + dispose 只释放克隆材质（共享几何/源材质不动）；
 * 3) 胸 logo 材质豁免（REF UE4MannequinModel.tsx:41-53 判定）。
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"

import type { BlockingItem } from "@/lib/types"
import {
  CHARACTER_DEFAULT_TINT,
  createCharacterModel,
  isolateAndTintUE4MannequinMaterials,
  resolveCharacterTint,
} from "./previs-ue4-model"

const GLB_PATH = path.join(process.cwd(), "public", "models", "ue-mannequin-retopology.glb")

/** 去除材质纹理引用（node 无 image 解码能力，parse 前剥离内嵌 PNG；同 previs-ue4-rig.test） */
function stripGltfTextures(buffer: Buffer) {
  const jsonLength = buffer.readUInt32LE(12)
  const json = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength)) as Record<string, unknown> & {
    materials?: Record<string, unknown>[]
    images?: unknown[]
    textures?: unknown[]
  }

  for (const material of json.materials ?? []) {
    const pbr = material.pbrMetallicRoughness as Record<string, unknown> | undefined
    if (pbr) {
      delete pbr.baseColorTexture
      delete pbr.metallicRoughnessTexture
    }
    delete material.emissiveTexture
    delete material.normalTexture
    delete material.occlusionTexture
    delete material.alphaTexture
  }
  delete json.images
  delete json.textures

  const jsonRaw = Buffer.from(JSON.stringify(json), "utf8")
  const newJsonLength = Math.ceil(jsonRaw.length / 4) * 4
  const binChunkStart = 20 + jsonLength + 8
  const binChunkLength = buffer.readUInt32LE(20 + jsonLength + 4)

  const out = Buffer.alloc(12 + 8 + newJsonLength + 8 + binChunkLength)
  out.write("glTF", 0, "ascii")
  out.writeUInt32LE(2, 4)
  out.writeUInt32LE(out.length, 8)
  out.writeUInt32LE(newJsonLength, 12)
  out.writeUInt32LE(0x4e4f534a, 16)
  jsonRaw.copy(out, 20)
  out.fill(0x20, 20 + jsonRaw.length, 20 + newJsonLength)
  out.writeUInt32LE(binChunkLength, 20 + newJsonLength)
  out.writeUInt32LE(0x004e4942, 24 + newJsonLength)
  buffer.copy(out, 28 + newJsonLength, binChunkStart, binChunkStart + binChunkLength)
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
}

function makeItem(overrides: Partial<BlockingItem> = {}): BlockingItem {
  return {
    id: "char-1",
    kind: "character",
    name: "角色",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...overrides,
  }
}

function byName(root: THREE.Object3D, name: string): THREE.Object3D {
  const found = root.getObjectByName(name)
  if (!found) throw new Error(`缺命名节点: ${name}`)
  return found
}

/** 角度断言（度 → 弧度） */
function expectDeg(actual: number, expectedDeg: number) {
  expect(actual).toBeCloseTo((expectedDeg * Math.PI) / 180, 6)
}

function minY(object: THREE.Object3D): number {
  return new THREE.Box3().setFromObject(object, true).min.y
}

describe("createCharacterModel：程序化回退路径（v3 词表驱动）", () => {
  it("UE4 源未就绪（显式 null）→ 程序化人偶，命名关节组齐备且最低点贴地", () => {
    const { object } = createCharacterModel(makeItem(), { ue4Scene: null })

    for (const name of [
      "procedural-ground",
      "procedural-body",
      "procedural-torso",
      "procedural-head",
      "procedural-leftShoulder",
      "procedural-leftElbow",
      "procedural-leftHand",
      "procedural-rightShoulder",
      "procedural-rightElbow",
      "procedural-rightHand",
      "procedural-leftHip",
      "procedural-leftKnee",
      "procedural-leftFoot",
      "procedural-rightHip",
      "procedural-rightKnee",
      "procedural-rightFoot",
    ]) {
      expect(() => byName(object, name), name).not.toThrow()
    }

    // 中性站姿：脚底 = 对象本地 y=0（v2 语义）
    expect(minY(object)).toBeGreaterThan(-0.01)
    expect(minY(object)).toBeLessThan(0.01)
    // 头顶 ≈ BODY_TYPES.mannequin.height（v3 表值 1.86，程序化回退消费 height）
    expect(new THREE.Box3().setFromObject(object, true).max.y).toBeGreaterThan(1.6)
    expect(new THREE.Box3().setFromObject(object, true).max.y).toBeLessThan(2.0)
  })

  it("词表键驱动关节组旋转（肩 pitch/twist/spread、肘 bend、髋、膝、手、脚）", () => {
    const { object } = createCharacterModel(
      makeItem({
        controls: {
          "leftShoulder.pitch": 30,
          "leftShoulder.twist": 20,
          "leftShoulder.spread": -40,
          "leftElbow.bend": 60,
          "rightElbow.bend": -25,
          "leftHip.pitch": 15,
          "leftHip.spread": 10,
          "leftKnee.bend": 45,
          "leftHand.pitch": 25,
          "leftHand.roll": 15,
          "leftFoot.roll": 12,
          "torso.yaw": 18,
          "head.pitch": 22,
        },
      }),
      { ue4Scene: null },
    )

    // 肩：[pitch, twist, spread] → x/y/z（移植 REF ProceduralMannequin.getLimbRotation）
    const shoulder = byName(object, "procedural-leftShoulder")
    expectDeg(shoulder.rotation.x, 30)
    expectDeg(shoulder.rotation.y, 20)
    expectDeg(shoulder.rotation.z, -40)
    // 肘/膝：单轴 bend（移植 REF mannequinPose.getSingleAxisRotation）
    expectDeg(byName(object, "procedural-leftElbow").rotation.x, 60)
    expectDeg(byName(object, "procedural-rightElbow").rotation.x, -25)
    expectDeg(byName(object, "procedural-leftKnee").rotation.x, 45)
    // 髋：[pitch, twist, spread]
    const hip = byName(object, "procedural-leftHip")
    expectDeg(hip.rotation.x, 15)
    expectDeg(hip.rotation.z, 10)
    // 手/脚：pitch/twist/roll → x/y/z
    expectDeg(byName(object, "procedural-leftHand").rotation.x, 25)
    expectDeg(byName(object, "procedural-leftHand").rotation.z, 15)
    expectDeg(byName(object, "procedural-leftFoot").rotation.z, 12)
    // torso/head：[pitch, yaw, roll]
    expectDeg(byName(object, "procedural-torso").rotation.y, 18)
    expectDeg(byName(object, "procedural-head").rotation.x, 22)
  })

  it("体型限位钳制（chibi ±58 / child ±72 / 其余 ±90）", () => {
    const chibi = createCharacterModel(
      makeItem({ bodyType: "chibi", controls: { "leftHip.pitch": 90, "leftElbow.bend": -90 } }),
      { ue4Scene: null },
    )
    expectDeg(byName(chibi.object, "procedural-leftHip").rotation.x, 58)
    expectDeg(byName(chibi.object, "procedural-leftElbow").rotation.x, -58)

    const child = createCharacterModel(
      makeItem({ bodyType: "child", controls: { "leftHip.pitch": 90 } }),
      { ue4Scene: null },
    )
    expectDeg(byName(child.object, "procedural-leftHip").rotation.x, 72)

    const mannequin = createCharacterModel(
      makeItem({ controls: { "leftHip.pitch": 90 } }),
      { ue4Scene: null },
    )
    expectDeg(byName(mannequin.object, "procedural-leftHip").rotation.x, 90)
  })

  it("body.offsetY 下移整体 + 贴地：最低点仍为 0；屈腿 + offsetY 的蹲姿整体低于站姿", () => {
    const stand = createCharacterModel(makeItem(), { ue4Scene: null })
    // offsetY 单独作用于整体：贴地会把它抵消（REF 同语义——alignToGround 后最低点恒为 0）
    const offsetOnly = createCharacterModel(
      makeItem({ controls: { "body.offsetY": -0.4 } }),
      { ue4Scene: null },
    )
    expect(minY(offsetOnly.object)).toBeGreaterThan(-0.01)
    expect(minY(offsetOnly.object)).toBeLessThan(0.01)

    // 蹲姿 = 屈髋/屈膝 + offsetY（同 crouch 预设）：贴地后整体显著低于站姿
    const crouch = createCharacterModel(
      makeItem({
        controls: {
          "body.offsetY": -0.43,
          "leftHip.pitch": 92,
          "rightHip.pitch": 92,
          "leftKnee.bend": 90,
          "rightKnee.bend": 90,
        },
      }),
      { ue4Scene: null },
    )
    expect(minY(crouch.object)).toBeGreaterThan(-0.01)
    expect(minY(crouch.object)).toBeLessThan(0.01)
    const standTop = new THREE.Box3().setFromObject(stand.object, true).max.y
    const crouchTop = new THREE.Box3().setFromObject(crouch.object, true).max.y
    expect(crouchTop).toBeLessThan(standTop - 0.3)
  })

  it("UE4 实例化异常 → 程序化回退（不抛出）", () => {
    // 无 skeleton 的 SkinnedMesh 会让 SkeletonUtils.clone 抛错 → 回退语义同 REF error boundary
    const broken = new THREE.Group()
    const skinned = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial())
    broken.add(skinned)

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const { object } = createCharacterModel(makeItem(), { ue4Scene: broken })
      expect(() => byName(object, "procedural-ground")).not.toThrow()
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it("dispose 释放本实例几何与材质", () => {
    const { object, dispose } = createCharacterModel(makeItem(), { ue4Scene: null })
    const mesh = byName(object, "procedural-head").children[0] as THREE.Mesh
    const geoSpy = vi.spyOn(mesh.geometry, "dispose")
    const matSpy = vi.spyOn(mesh.material as THREE.Material, "dispose")

    dispose()

    expect(geoSpy).toHaveBeenCalled()
    expect(matSpy).toHaveBeenCalled()
  })
})

describe("createCharacterModel：UE4 路径（真实资产注入）", () => {
  it("克隆 + 材质隔离染色 + 整模缩放组 + 贴地；源材质/几何不被改写", async () => {
    const gltf = await new GLTFLoader().parseAsync(stripGltfTextures(readFileSync(GLB_PATH)), "")

    let sourceMesh: THREE.SkinnedMesh | null = null
    gltf.scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && !sourceMesh) sourceMesh = o as THREE.SkinnedMesh
    })
    expect(sourceMesh).not.toBeNull()
    const sourceMaterial = (sourceMesh as unknown as THREE.SkinnedMesh).material as THREE.MeshStandardMaterial
    const sourceColorBefore = sourceMaterial.color.getHex()

    const { object, dispose } = createCharacterModel(
      makeItem({ bodyType: "chibi", color: "#ff0000" }),
      { ue4Scene: gltf.scene },
    )

    // 整模缩放组（getUE4ModelScale：chibi 0.56）
    const scaleGroup = object.children[0]
    expect(scaleGroup.scale.x).toBeCloseTo(0.56, 6)

    // 克隆体（在缩放组下）——材质是克隆件、已染色；源材质保持原色
    const clone = scaleGroup.children[0]
    let cloneMesh: THREE.SkinnedMesh | null = null
    clone.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && !cloneMesh) cloneMesh = o as THREE.SkinnedMesh
    })
    expect(cloneMesh).not.toBeNull()
    const cloneMaterial = (cloneMesh as unknown as THREE.SkinnedMesh).material as THREE.MeshStandardMaterial
    expect(cloneMaterial).not.toBe(sourceMaterial)
    expect(cloneMaterial.color.getHex()).toBe(0xff0000)
    expect(cloneMaterial.roughness).toBeCloseTo(0.68, 6)
    expect(cloneMaterial.metalness).toBeCloseTo(0.04, 6)
    expect(sourceMaterial.color.getHex()).toBe(sourceColorBefore)

    // 贴地（rest 包围盒最低点 = 对象本地 y=0）
    expect(minY(object)).toBeGreaterThan(-0.01)
    expect(minY(object)).toBeLessThan(0.01)

    // dispose：克隆材质释放；共享几何与源材质不动
    const cloneMatSpy = vi.spyOn(cloneMaterial, "dispose")
    const sourceMatSpy = vi.spyOn(sourceMaterial, "dispose")
    const cloneGeoSpy = vi.spyOn((cloneMesh as unknown as THREE.SkinnedMesh).geometry, "dispose")

    dispose()

    expect(cloneMatSpy).toHaveBeenCalled()
    expect(sourceMatSpy).not.toHaveBeenCalled()
    expect(cloneGeoSpy).not.toHaveBeenCalled()
  })

  it("同一源场景多实例：材质各自克隆；释放其一不影响另一实例与源材质", async () => {
    const gltf = await new GLTFLoader().parseAsync(stripGltfTextures(readFileSync(GLB_PATH)), "")

    const first = createCharacterModel(makeItem({ color: "#ff0000" }), { ue4Scene: gltf.scene })
    const second = createCharacterModel(makeItem({ color: "#00ff00" }), { ue4Scene: gltf.scene })

    const meshOf = (object: THREE.Object3D) => {
      let found: THREE.SkinnedMesh | null = null
      object.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh && !found) found = o as THREE.SkinnedMesh
      })
      if (!found) throw new Error("缺 SkinnedMesh")
      return found as unknown as THREE.SkinnedMesh
    }

    const firstMat = meshOf(first.object).material as THREE.MeshStandardMaterial
    const secondMat = meshOf(second.object).material as THREE.MeshStandardMaterial
    expect(firstMat).not.toBe(secondMat)
    expect(firstMat.color.getHex()).toBe(0xff0000)
    expect(secondMat.color.getHex()).toBe(0x00ff00)

    const firstMatSpy = vi.spyOn(firstMat, "dispose")
    const secondMatSpy = vi.spyOn(secondMat, "dispose")
    first.dispose()

    expect(firstMatSpy).toHaveBeenCalled()
    expect(secondMatSpy).not.toHaveBeenCalled()
    expect(secondMat.color.getHex()).toBe(0x00ff00)
  })
})

describe("isolateAndTintUE4MannequinMaterials：染色与胸 logo 豁免", () => {
  const makeSkinned = (materialName: string) =>
    new THREE.SkinnedMesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ name: materialName, color: 0xffffff }),
    )

  it("普通材质染色并隔离克隆；胸 logo 材质只隔离不染色", () => {
    const scene = new THREE.Group()
    const body = makeSkinned("UE_Mannequin_Text")
    const logo = makeSkinned("SK_Mannequin_M_UE4Man_ChestLogo")
    scene.add(body, logo)
    const bodyOriginal = body.material as THREE.MeshStandardMaterial
    const logoOriginal = logo.material as THREE.MeshStandardMaterial

    isolateAndTintUE4MannequinMaterials(scene, 0x4f8ef7)

    const bodyMat = body.material as THREE.MeshStandardMaterial
    const logoMat = logo.material as THREE.MeshStandardMaterial
    // 两者都是克隆件（不共享 GLB 材质），原材质不被改写
    expect(bodyMat).not.toBe(bodyOriginal)
    expect(logoMat).not.toBe(logoOriginal)
    expect(bodyOriginal.color.getHex()).toBe(0xffffff)
    expect(logoOriginal.color.getHex()).toBe(0xffffff)
    expect(bodyMat.color.getHex()).toBe(0x4f8ef7)
    expect(logoMat.color.getHex()).toBe(0xffffff) // 豁免：不染色
    expect(body.castShadow).toBe(true)
    expect(body.frustumCulled).toBe(false)
  })

  it("重复调用不重复克隆（storyAiIsolatedMaterial 标记幂等）", () => {
    const scene = new THREE.Group()
    const mesh = makeSkinned("UE_Mannequin_Text")
    scene.add(mesh)

    isolateAndTintUE4MannequinMaterials(scene, 0x4f8ef7)
    const first = mesh.material
    isolateAndTintUE4MannequinMaterials(scene, 0xff0000)

    expect(mesh.material).toBe(first)
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xff0000)
  })
})

describe("resolveCharacterTint", () => {
  it("item.color 优先，缺省 = CHARACTER_DEFAULT_TINT（同 viewport resolveItemColor 语义）", () => {
    expect(resolveCharacterTint(makeItem({ color: "#4f8ef7" }))).toBe(0x4f8ef7)
    expect(resolveCharacterTint(makeItem())).toBe(CHARACTER_DEFAULT_TINT)
    expect(resolveCharacterTint(makeItem({ color: "#zzzzzz" }))).toBe(CHARACTER_DEFAULT_TINT)
  })
})
