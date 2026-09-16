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
import { describe, expect, it } from "vitest"
import * as THREE from "three"

import { lightOwnerId, parseLightOwnerId } from "@/lib/engine/previs-light"
import { buildCameraRig, buildLightRig, ownerId } from "./previs-3d-viewport"

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
