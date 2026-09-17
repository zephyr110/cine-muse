/**
 * 视口拾取：机位 rig 不得抢走角色的点击。
 *
 * 回归靶心：rig 的**线框**（装饰）曾被当作拾取目标。three 的 Raycaster.params.Line.threshold
 * 默认 1 个世界单位，而 rig 的线没有缩放（0.35 缩比是烘进几何坐标的），于是每台机位的线框
 * 都是一个半径约 1 个单位的「点击黑洞」，实测横向 2.5 个世界单位外仍能截获射线；又因
 * userData.itemId="__camera__" 设在 rig 的 Group 上，线框经祖先回溯解析成 __camera__ 并
 * 按距离排序压过它后面的角色——表现为「角色有时候鼠标点不中」。
 * 设计本意是**隐形命中盒**作拾取代理（见 buildCameraRig 注释），线框只作视觉。
 *
 * 舞台纵深仅约 5.6 个世界单位，故该捕获半径足以覆盖角色常被摆放的区域。
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"

import { lightOwnerId, parseLightOwnerId } from "@/lib/engine/previs-light"
import type { BlockingItem } from "@/lib/types"
import {
  buildBoundsEdges,
  buildCameraRig,
  buildLightRig,
  labelLocalY,
  ownerId,
} from "./previs-3d-viewport"
import { createCharacterModel } from "./previs-ue4-model"

/** 默认导演视角（与视口 HOME_VIEW 同值） */
const HOME = { position: new THREE.Vector3(8, 8, 10), target: new THREE.Vector3(0, 1, 0), fov: 45 }
/** 瞄准点：角色躯干中心（用户点击的位置） */
const AIM = new THREE.Vector3(0, 0.8, 0)

/** 角色替身：0.4×1.6×0.4 的盒体、脚底在 y=0，id 挂在 Group 上（与 buildMesh 同构） */
function makeCharacter(id: string): THREE.Group {
  const g = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.6, 0.4), new THREE.MeshStandardMaterial())
  mesh.position.y = 0.8
  g.add(mesh)
  g.userData.itemId = id
  return g
}

function makeRigAt(x: number, y: number, z: number): THREE.Group {
  const rig = buildCameraRig()
  rig.position.set(x, y, z)
  rig.userData.itemId = "__camera__"
  return rig
}

/** 复现 pickAt 的判定：从相机穿过 worldPoint 投射线，返回最终选中的 id */
function pickId(scene: THREE.Scene, rig: THREE.Group | null, worldPoint: THREE.Vector3): string | null {
  const camera = new THREE.PerspectiveCamera(HOME.fov, 16 / 9, 0.1, 1000)
  camera.position.copy(HOME.position)
  camera.lookAt(HOME.target)
  camera.updateMatrixWorld(true)
  scene.updateMatrixWorld(true)

  const ndc = worldPoint.clone().project(camera)
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera)

  const targets: THREE.Object3D[] = []
  scene.traverse((o) => {
    if (o.userData.itemId && o.userData.itemId !== "__camera__") targets.push(o)
  })
  if (rig) targets.push(rig)

  const hit = raycaster.intersectObjects(targets, true).find((h) => ownerId(h.object))
  return hit ? ownerId(hit.object) : null
}

function sceneWith(...objs: THREE.Object3D[]): THREE.Scene {
  const s = new THREE.Scene()
  for (const o of objs) s.add(o)
  return s
}

describe("机位 rig 与角色拾取", () => {
  it("没有机位时，点角色选中角色", () => {
    const char = makeCharacter("ch1")
    expect(pickId(sceneWith(char), null, AIM)).toBe("ch1")
  })

  it("★ 机位在角色侧向 1.0 处，角色仍可点选", () => {
    const char = makeCharacter("ch1")
    const rig = makeRigAt(1.0, 1.0, 0.5)
    expect(pickId(sceneWith(char, rig), rig, AIM)).toBe("ch1")
  })

  it("★ 机位在角色侧向 2.5 处（原捕获半径内），角色仍可点选", () => {
    const char = makeCharacter("ch1")
    const rig = makeRigAt(2.5, 1.0, 0)
    expect(pickId(sceneWith(char, rig), rig, AIM)).toBe("ch1")
  })

  it("机位在角色正后方（不挡视线），角色仍可点选", () => {
    const char = makeCharacter("ch1")
    const rig = makeRigAt(-2, 1, -2)
    expect(pickId(sceneWith(char, rig), rig, AIM)).toBe("ch1")
  })

  it("rig 的线框不产生任何射线命中（线框只是装饰）", () => {
    const rig = makeRigAt(1.0, 1.0, 0.5)
    const camera = new THREE.PerspectiveCamera(HOME.fov, 16 / 9, 0.1, 1000)
    camera.position.copy(HOME.position)
    camera.lookAt(HOME.target)
    camera.updateMatrixWorld(true)
    rig.updateMatrixWorld(true)

    const ndc = AIM.clone().project(camera)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera)

    const fromLines = raycaster
      .intersectObjects([rig], true)
      .filter((h) => (h.object as THREE.Line).isLine)
    expect(fromLines).toHaveLength(0)
  })

  it("机位本体仍可点选（隐形命中盒是拾取代理）", () => {
    const rig = makeRigAt(3, 1, 0)
    // 瞄准机位自身位置
    expect(pickId(sceneWith(rig), rig, new THREE.Vector3(3, 1, 0))).toBe("__camera__")
  })
})

// —— 光源 rig 走的是同一套拾取代理约定：线框退出拾取、命中盒带 `__light__:<id>` 哨兵 ——
//   注意光源命中盒只有 0.52 见方（比机位的还小），所以「挡不挡角色」的边界比机位更近。
function makeLightRigAt(x: number, y: number, z: number, id: string): THREE.Group {
  const rig = buildLightRig()
  rig.position.set(x, y, z)
  rig.userData.itemId = lightOwnerId(id)
  return rig
}

/** 复现 pickAt：光源 rig 也进拾取目标集（director 态） */
function pickIdWithLight(
  scene: THREE.Scene,
  lightRig: THREE.Group,
  worldPoint: THREE.Vector3,
): string | null {
  const camera = new THREE.PerspectiveCamera(HOME.fov, 16 / 9, 0.1, 1000)
  camera.position.copy(HOME.position)
  camera.lookAt(HOME.target)
  camera.updateMatrixWorld(true)
  scene.updateMatrixWorld(true)

  const ndc = worldPoint.clone().project(camera)
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera)

  const targets: THREE.Object3D[] = []
  scene.traverse((o) => {
    if (o.userData.itemId && o.userData.itemId !== "__camera__") targets.push(o)
  })
  targets.push(lightRig)

  const hit = raycaster.intersectObjects(targets, true).find((h) => ownerId(h.object))
  return hit ? ownerId(hit.object) : null
}

describe("光源 rig 与角色拾取", () => {
  it("光源不在视线上（角色正后方）时，点角色选中角色", () => {
    const char = makeCharacter("ch1")
    const rig = makeLightRigAt(-2, 1, -2, "lt1")
    expect(pickIdWithLight(sceneWith(char, rig), rig, AIM)).toBe("ch1")
  })

  it("★ 光源在角色侧向 1.0 处，角色仍可点选（命中盒只有 0.52 见方）", () => {
    const char = makeCharacter("ch1")
    const rig = makeLightRigAt(1.0, 1.0, 0.5, "lt1")
    expect(pickIdWithLight(sceneWith(char, rig), rig, AIM)).toBe("ch1")
  })

  it("光源的线框不产生任何射线命中（线框只是装饰）", () => {
    const rig = makeLightRigAt(1.0, 1.0, 0.5, "lt1")
    const camera = new THREE.PerspectiveCamera(HOME.fov, 16 / 9, 0.1, 1000)
    camera.position.copy(HOME.position)
    camera.lookAt(HOME.target)
    camera.updateMatrixWorld(true)
    rig.updateMatrixWorld(true)

    const ndc = AIM.clone().project(camera)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera)

    const fromLines = raycaster
      .intersectObjects([rig], true)
      .filter((h) => (h.object as THREE.Line).isLine)
    expect(fromLines).toHaveLength(0)
  })

  it("光源本体可点选，且哨兵能解析回光源 id", () => {
    // 落在 HOME → AIM 视线上的位置（否则命中盒太小、瞄不准）
    const rig = makeLightRigAt(2.5, 3.05, 3.125, "lt1")
    const picked = pickIdWithLight(sceneWith(rig), rig, new THREE.Vector3(2.5, 3.05, 3.125))
    expect(picked).toBe(lightOwnerId("lt1"))
    expect(parseLightOwnerId(picked)).toBe("lt1")
  })
})

/* ==========================================================================
 * UE4 蒙皮角色：包围盒缓存
 * ========================================================================== */

const GLB_PATH = path.join(process.cwd(), "public", "models", "ue-mannequin-retopology.glb")

/** 去除材质纹理引用（node 无 image 解码能力，parse 前剥离内嵌 PNG；同 previs-ue4-model.test） */
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

/** 真实 UE4 角色（资产注入方式同 previs-ue4-model.test），摆到指定位置并刷新世界矩阵 */
async function makeUe4Character(at: THREE.Vector3): Promise<THREE.Object3D> {
  const gltf = await new GLTFLoader().parseAsync(stripGltfTextures(readFileSync(GLB_PATH)), "")
  const item: BlockingItem = {
    id: "ch1",
    kind: "character",
    name: "角色",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  }
  const { object } = createCharacterModel(item, { ue4Scene: gltf.scene })
  object.userData.itemId = "ch1" // 同视口 buildMesh：id 挂在最外层 Group 上
  object.position.copy(at)
  object.updateMatrixWorld(true)
  return object
}

/** 清掉蒙皮网格上的包围盒缓存（= pickAt 的拾取前守卫）。
 *  three 的类型把 boundingBox 声明为非空 Box3，运行时初值其实是 null，raycast 也明确
 *  支持 null = 跳过该早退——所以这里按真实类型改写。 */
function clearCachedBox(mesh: THREE.SkinnedMesh) {
  ;(mesh as unknown as { boundingBox: THREE.Box3 | null }).boundingBox = null
}

function skinnedMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const out: THREE.SkinnedMesh[] = []
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh)
  })
  return out
}

/**
 * #96「角色有时候点不中」的第二条通路（与上节的 rig 线框无关）：包围盒缓存。
 *
 * 靶心：`new THREE.Box3().setFromObject(obj)`（precise 默认 false）走 Box3.expandByObject，
 * 该分支对「自带 boundingBox 属性」的对象会调用 object.computeBoundingBox() 并把结果
 * **缓存回对象**（Box3.js:340-350；SkinnedMesh 构造时就把该属性定义为 null，故必然命中此分支）。
 *
 * 而该盒子落在哪个坐标系取决于 bindMatrixInverse：它只在 SkinnedMesh.updateMatrixWorld 里
 * 由 matrixWorld 重新同步（SkinnedMesh.js:290-296），可 Box3.expandByObject 走的是
 * Object3D.updateWorldMatrix，不触发那个覆写。于是「角色刚摆好位置、还没渲染」时算出的盒子
 * 是**世界系**的——角色创建后在同一个 tick 里建标签，恰好就是这个状态；而 raycast 读到的是
 * 已同步的 matrixWorld、按局部系比对（SkinnedMesh.js:199 注释「test with bounding box in
 * local space」）→ 恒不相交 → 该角色从此永久点不中。缓存又不会自动失效（boundingBox 只由
 * 使用者显式清空或重算），下一帧把 bindMatrixInverse 归位也救不回来。
 *
 * 写入方只有两处，都在无意中发生：labelLocalY（每个角色建标签时逐 mesh 调用）与
 * buildBoundsEdges（多选红框 / 边缘图导出）。这就是「有时候」——角色在被建标签或多选
 * 之前是可点的。修复即两处一律 precise=true（逐顶点取样，不写缓存），并在 pickAt 拾取前
 * 清空缓存兜底。
 */
describe("UE4 蒙皮角色：包围盒缓存不得污染拾取（#96）", () => {
  it("★ buildBoundsEdges / labelLocalY 不得在 SkinnedMesh 上留下 boundingBox 缓存", async () => {
    const char = await makeUe4Character(new THREE.Vector3(3, 0, -1.5))
    const meshes = skinnedMeshes(char)
    expect(meshes.length).toBeGreaterThan(0)
    // 前置：新克隆不得自带缓存（否则说明污染另有来源）
    expect(meshes.map((m) => m.boundingBox)).toEqual(meshes.map(() => null))

    buildBoundsEdges(char) // 多选红框 / 边缘图导出
    for (const m of meshes) labelLocalY(m) // 每个角色建标签时逐 mesh 调用

    expect(meshes.map((m) => m.boundingBox)).toEqual(meshes.map(() => null))
  })

  it("★ 对照：摆位后未及渲染就建标签 → 缓存下世界系盒子，射线恒不命中；清空后恢复", async () => {
    const at = new THREE.Vector3(3, 0, -1.5)
    const char = await makeUe4Character(new THREE.Vector3(0, 0, 0)) // 在原点完成一次同步（= 克隆/解析时的 bindMatrixInverse）
    const scene = sceneWith(char)
    const aim = () => new THREE.Vector3(char.position.x, 0.9, char.position.z) // 躯干中心

    // 摆到目标位，只走 updateWorldMatrix（正是 Box3.expandByObject 的路径）：
    // 它不会触发 SkinnedMesh.updateMatrixWorld → bindMatrixInverse 仍停在原点的逆
    char.position.copy(at)
    char.updateWorldMatrix(false, true)
    new THREE.Box3().setFromObject(char) // 旧代码路径：labelLocalY / buildBoundsEdges 会这么写

    // 类型上 boundingBox 声明为非空，运行时才可能是 null —— 这里按真实类型断言
    const cached = skinnedMeshes(char)[0].boundingBox as unknown as THREE.Box3 | null
    expect(cached, "默认路径应把盒子缓存回 mesh").not.toBeNull()
    // 世界系：跟着角色走（x≈3），而不是以局部原点为中心的 ~0
    expect((cached as THREE.Box3).getCenter(new THREE.Vector3()).x).toBeCloseTo(at.x, 0)

    // 下一帧渲染把 bindMatrixInverse 归位，三角形测试本身恢复正常 —— 但缓存盒子已经留在 mesh 上
    char.updateMatrixWorld(true)
    expect(pickId(scene, null, aim())).toBeNull() // 被缓存盒子早退 → 点不中（浏览器实测同样为 0 命中）

    for (const m of skinnedMeshes(char)) clearCachedBox(m)
    expect(pickId(scene, null, aim())).toBe("ch1")
  })
})
