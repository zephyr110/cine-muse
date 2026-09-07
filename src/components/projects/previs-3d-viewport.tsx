"use client"

import * as React from "react"
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

import { BODY_TYPE_BY_ID, POSE_PRESET_BY_ID, type JointName } from "@/lib/engine/previs-poses"
import type { BlockingItem, PrevisShot } from "@/lib/types"

/** 导出图基准分辨率（按画幅比例派生宽高） */
const MAP_BASE = 480
const ASPECT_RATIOS = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 } as const
export type MapAspect = keyof typeof ASPECT_RATIOS

const ITEM_COLOR: Record<BlockingItem["kind"], number> = {
  terrain: 0x9ca3af,
  character: 0x6366f1,
  prop: 0xf59e0b,
}

/** 新增角色 8 色盘轮转（storyai palette 移植） */
export const PALETTE = ["#4F8EF7", "#E0524D", "#E91E63", "#F2A900", "#9C4DCC", "#12B886", "#00B8D9", "#FF7A45"] as const

/** 角色显式色（item.color，hex）→ number；缺省回 kind 色 */
export function resolveItemColor(item: BlockingItem): number {
  if (item.color) {
    const n = Number.parseInt(item.color.replace("#", ""), 16)
    if (!Number.isNaN(n)) return n
  }
  return ITEM_COLOR[item.kind]
}

/** 深色细节（接缝环/五官/手/脚末端）材质色 */
const DETAIL_COLOR = 0x070a0f

const DEG = Math.PI / 180

/** 程序化精细人偶：骨盆球 + 躯干双胶囊（腹/胸）+ 深色接缝环 + 头（眼鼻嘴）+ 四肢深色末端。
 *  组原点 = 脚底平面（y=0），高度沿 +y，默认面向 +Z；位置/旋转/缩放由 buildMesh 在父级应用。
 *  层级：根组 = 骨盆 + 双腿；torsoGroup（原点在髋高、随 torso 关节旋转）内 = 双胶囊躯干 +
 *  深色接缝环 + 头（眼鼻嘴）+ 双臂——躯干/头/臂随 torso 整体摆动，骨盆与双腿保持原位。 */
function buildMannequin(item: BlockingItem): THREE.Group {
  const g = new THREE.Group()
  const body = BODY_TYPE_BY_ID[item.bodyType ?? "standard"]
  const controls = item.controls ?? POSE_PRESET_BY_ID[item.poseId ?? "stand"]?.controls ?? {}
  const h = body?.height ?? 1.8
  const w = body?.width ?? 1
  const headR = (body?.headSize ?? 0.34) * 0.5
  const mat = new THREE.MeshStandardMaterial({ color: resolveItemColor(item), metalness: 0.04, roughness: 0.74 })
  const dark = new THREE.MeshStandardMaterial({ color: DETAIL_COLOR, metalness: 0.1, roughness: 0.85 })

  /** 四肢：holder 定位于关节枢轴（已在所属父组坐标中）并按 controls 旋转；
   *  胶囊由枢轴下垂 len（下端 = 枢轴 − len）；末端深色手/脚球——
   *  手球心略高于末端（拳沿臂端下方露 ~0.75rad），脚球心抬至球底恰触地（不穿地板）。 */
  const limb = (
    len: number, rad: number, pivot: [number, number, number],
    joint: JointName, foot = false,
  ): THREE.Group => {
    const holder = new THREE.Group()
    holder.position.set(...pivot)
    const [rx, ry, rz] = controls[joint] ?? [0, 0, 0]
    holder.rotation.set(rx * DEG, ry * DEG, rz * DEG)
    const seg = new THREE.Mesh(new THREE.CapsuleGeometry(rad, Math.max(0.05, len - rad * 2), 4, 12), mat)
    seg.position.y = -len / 2
    holder.add(seg)
    const tipR = rad * (foot ? 1.05 : 1.2)
    const tip = new THREE.Mesh(new THREE.SphereGeometry(tipR, 10, 8), dark)
    tip.position.y = -len + (foot ? tipR : rad * 0.45)
    holder.add(tip)
    return holder
  }

  const hipY = h * 0.52
  const shoulderY = h * 0.8
  const dT = shoulderY - hipY // 髋→肩 躯干高度段
  const chestR = 0.3 * w
  const hipR = 0.32 * w
  const armLen = h * 0.33
  const armRad = 0.09 * w
  const legRad = 0.13 * w
  const shoulderX = 0.33 * w

  // —— 骨盆（根组）：髋位球 ——
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(hipR, 16, 12), mat)
  pelvis.position.y = hipY - 0.02 * h
  g.add(pelvis)

  // —— 躯干关节组（原点 = 髋高）——
  const torsoGroup = new THREE.Group()
  torsoGroup.position.y = hipY
  const [tx, ty, tz] = controls.torso ?? [0, 0, 0]
  torsoGroup.rotation.set(tx * DEG, ty * DEG, tz * DEG)
  g.add(torsoGroup)

  // 下腹胶囊（腰→下胸）与上胸胶囊（胸→肩；顶点收在头底之下，避免吞没头部）
  const belly = new THREE.Mesh(new THREE.CapsuleGeometry(chestR * 0.92, Math.max(0.05, dT * 0.62), 4, 12), mat)
  belly.position.y = dT * 0.31
  torsoGroup.add(belly)
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(chestR * 0.8, Math.max(0.05, dT * 0.34), 4, 12), mat)
  chest.position.y = dT * 0.62
  torsoGroup.add(chest)

  // 深色接缝环：管 0.018w 微嵌体表、外露成细环——腰环贴腹段、颈环贴胸段上缘
  const seam = (y: number, r: number) => {
    const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018 * w, 6, 20), dark)
    t.rotation.x = Math.PI / 2
    t.position.y = y
    torsoGroup.add(t)
  }
  seam(dT * 0.55, chestR * 0.94) // 腰环（腹 0.92·chestR 截面外 +6mm）
  seam(dT * 0.95, chestR * 0.76) // 颈环（胸 0.8·chestR 截面外 +5mm）

  // —— 头（随躯干组）：球 + 深色五官（眼/鼻/嘴，+Z 面向）——
  const headGroup = new THREE.Group()
  headGroup.position.set(0, dT + headR * 1.15, 0) // 世界 y = shoulderY + 1.15·headR（头顶 ≈ h）
  const [hx, hy, hz] = controls.head ?? [0, 0, 0]
  headGroup.rotation.set(hx * DEG, hy * DEG, hz * DEG)
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

  // —— 手臂（肩高挂点，随躯干组）——
  torsoGroup.add(limb(armLen, armRad, [-shoulderX, dT, 0], "armL"))
  torsoGroup.add(limb(armLen, armRad, [shoulderX, dT, 0], "armR"))

  // —— 腿（髋高挂点，直挂根组——不随躯干转）——
  g.add(limb(hipY, legRad, [-0.17 * w, hipY, 0], "legL", true))
  g.add(limb(hipY, legRad, [0.17 * w, hipY, 0], "legR", true))

  return g
}

/** 包围盒线框（选中高亮与边缘导出共用）：Group 取整体包围盒，Mesh 直接取几何边 */
function buildBoundsEdges(obj: THREE.Object3D): THREE.LineSegments {
  let box: THREE.Box3
  if (obj instanceof THREE.Group) {
    box = new THREE.Box3().setFromObject(obj)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x + 0.12, size.y + 0.12, size.z + 0.12)),
      new THREE.LineBasicMaterial({ color: 0xdc2626 }),
    )
    edges.position.copy(center)
    return edges
  }
  box = new THREE.Box3().setFromObject(obj)
  return new THREE.LineSegments(
    new THREE.EdgesGeometry((obj as THREE.Mesh).geometry),
    new THREE.LineBasicMaterial({ color: 0xdc2626 }),
  )
}

/** 图元 → 3D 网格：地形=薄板，角色=程序化精细人偶，道具=方体。
 *  按 v2 变换直接落地：y 即数据真实高度（角色=脚底平面，prop/terrain=几何中心），无隐式抬升；
 *  角色/道具 castShadow（地面 receiveShadow，见初始化）；材质统一 meshStandardMaterial。 */
function buildMesh(item: BlockingItem): THREE.Object3D {
  if (item.kind === "character") {
    const g = buildMannequin(item)
    g.userData.itemId = item.id
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true
    })
    const [x, y, z] = item.position
    g.position.set(x, y, z) // v2：y = 脚底高度
    const [rx, ry, rz] = item.rotation
    g.rotation.set(rx * DEG, ry * DEG, rz * DEG)
    g.scale.set(item.scale[0], item.scale[1], item.scale[2])
    return g
  }
  let geo: THREE.BufferGeometry
  if (item.kind === "terrain") {
    geo = new THREE.BoxGeometry(3, 0.2, 3)
  } else {
    geo = new THREE.BoxGeometry(0.7, 0.7, 0.7)
  }
  const mat = new THREE.MeshStandardMaterial({ color: resolveItemColor(item), metalness: 0.02, roughness: 0.68 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.userData.itemId = item.id
  mesh.castShadow = true
  if (item.kind === "terrain") mesh.receiveShadow = true
  const [x, y, z] = item.position
  mesh.position.set(x, y, z)
  const [rx, ry, rz] = item.rotation
  mesh.rotation.set(rx * DEG, ry * DEG, rz * DEG)
  mesh.scale.set(item.scale[0], item.scale[1], item.scale[2])
  return mesh
}

export interface CaptureResult {
  previewUrl: string
  depthUrl: string
  edgeUrl: string
}

export interface OrbitPreview {
  url: string
  camera: PrevisShot["camera"]
}

export interface PrevisViewportHandle {
  /** 按画幅比例真实导出三图 */
  captureMaps: (aspect?: MapAspect) => CaptureResult
  /** 当前环绕视角（导演视角）的机位读数 */
  getViewCamera: () => PrevisShot["camera"]
  /** 环绕目标一圈拍摄 count 张预览（瞬态，不持久化） */
  captureOrbitPreviews: (count: number) => OrbitPreview[]
}

/**
 * 3D 预演视口（three.js）：
 * - 布景项图元 + 地面网格 + OrbitControls 环绕
 * - 射线拾取选中、地面拖拽（沿 y=0 平面）
 * - 机位对象（视锥指向目标）；「从机位看」切换
 * - captureMaps()：从场景真实渲染 布景/深度/边缘 三图（RGBADepthPacking 深度反读）
 */
export const PrevisViewport = React.forwardRef<
  PrevisViewportHandle,
  {
    items: BlockingItem[]
    camera: PrevisShot["camera"]
    selectedId: string | null
    viewFromCamera: boolean
    onSelect: (id: string | null) => void
    onMoveItem: (id: string, x: number, z: number) => void
  }
>(function PrevisViewport({ items, camera, selectedId, viewFromCamera, onSelect, onMoveItem }, ref) {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const stateRef = React.useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    itemMeshes: Map<string, THREE.Object3D>
    camGizmo: THREE.Object3D
    hlGroup: THREE.Group
    raycaster: THREE.Raycaster
    dragId: string | null
    dragging: boolean
    raf: number
  } | null>(null)
  const propsRef = React.useRef({ items, camera, viewFromCamera, onSelect, onMoveItem })
  propsRef.current = { items, camera, viewFromCamera, onSelect, onMoveItem }

  // —— 初始化场景（一次） ——
  React.useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x000000)

    // 深色舞台灯光 + 阴影
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.15)
    scene.add(hemi)
    const dir = new THREE.DirectionalLight(0xffffff, 1.2)
    dir.position.set(8, 10, 6)
    scene.add(dir)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    dir.castShadow = true
    dir.shadow.mapSize.set(1024, 1024)
    dir.shadow.camera.left = -10
    dir.shadow.camera.right = 10
    dir.shadow.camera.top = 10
    dir.shadow.camera.bottom = -10
    dir.shadow.camera.near = 0.5
    dir.shadow.camera.far = 40

    // 半透明暗色地面 + 1m 节线无限网格（节线 #2A4065）
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshBasicMaterial({ color: 0x303640, transparent: true, opacity: 0.4 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.02
    ground.receiveShadow = true
    ground.userData.itemId = "__ground__"
    ground.userData.hideFromViewportCapture = true
    scene.add(ground)
    const grid = new THREE.GridHelper(200, 200, 0x2a4065, 0x2a4065)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.9
    grid.position.y = -0.015
    grid.userData.hideFromViewportCapture = true
    scene.add(grid)

    const camera = new THREE.PerspectiveCamera(45, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 100)
    camera.position.set(8, 8, 10)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1, 0)
    controls.enableDamping = true

    // 选中高亮图层（渲染时排除，防止进入导出图）
    const hlGroup = new THREE.Group()
    hlGroup.name = "highlight-layer"
    scene.add(hlGroup)

    // 机位对象：线框小盒 + 指向目标的箭头
    const camGizmo = new THREE.Group()
    const camBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.3, 0.4),
      new THREE.MeshBasicMaterial({ color: 0x71717a, wireframe: true }),
    )
    camBox.userData.itemId = "__camera__"
    camGizmo.add(camBox)
    const camRay = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -3)]),
      new THREE.LineBasicMaterial({ color: 0x71717a }),
    )
    camGizmo.add(camRay)
    scene.add(camGizmo)

    const st = {
      renderer, scene, camera, controls, itemMeshes: new Map<string, THREE.Object3D>(),
      camGizmo, hlGroup, raycaster: new THREE.Raycaster(), dragId: null, dragging: false, raf: 0,
    }
    stateRef.current = st

    const onResize = () => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (w === 0 || h === 0) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    onResize()
    const ro = new ResizeObserver(onResize)
    ro.observe(host)

    const animate = () => {
      if (!stateRef.current) return
      stateRef.current.controls.update()
      renderer.render(scene, camera)
      stateRef.current.raf = requestAnimationFrame(animate)
    }
    st.raf = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(st.raf)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      host.removeChild(renderer.domElement)
      stateRef.current = null
    }
  }, [])

  /** 递归释放几何与材质（重建/移除时防 GPU 缓冲泄漏） */
  function disposeObject(obj: THREE.Object3D) {
    obj.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
  }

  // —— 同步布景项网格（姿势/体型/滑杆变化时按姿态签名重建） ——
  React.useEffect(() => {
    const st = stateRef.current
    if (!st) return
    const keep = new Set<string>()
    for (const item of propsRef.current.items) {
      keep.add(item.id)
      // 姿态签名：体型/姿势/关节角度/颜色任一变化 → 重建人偶
      const rigKey =
        item.kind === "character"
          ? `${item.bodyType ?? ""}|${item.poseId ?? ""}|${JSON.stringify(item.controls ?? {})}|${item.color ?? ""}`
          : ""
      let mesh = st.itemMeshes.get(item.id)
      if (!mesh) {
        mesh = buildMesh(item)
        st.scene.add(mesh)
        st.itemMeshes.set(item.id, mesh)
      } else if (mesh.userData.rigKey !== rigKey) {
        disposeObject(mesh)
        st.scene.remove(mesh)
        mesh = buildMesh(item)
        st.scene.add(mesh)
        st.itemMeshes.set(item.id, mesh)
      }
      mesh.userData.rigKey = rigKey
      const [x, y, z] = item.position
      mesh.position.set(x, y, z) // v2：y 即真实高度（角色=脚底 / prop/terrain=中心），不再 +1
      const [rx, ry, rz] = item.rotation
      mesh.rotation.set(rx * DEG, ry * DEG, rz * DEG)
      mesh.scale.set(...item.scale)
    }
    for (const [id, mesh] of [...st.itemMeshes]) {
      if (!keep.has(id)) {
        disposeObject(mesh)
        st.scene.remove(mesh)
        st.itemMeshes.delete(id)
      }
    }
  }, [items, selectedId])

  // —— 选中高亮：独立图层（不进导出画面） ——
  React.useEffect(() => {
    const st = stateRef.current
    if (!st) return
    // 释放旧高亮几何/材质（拖拽中每帧重建，避免 GPU 缓冲累积）
    st.hlGroup.traverse((o) => {
      if (o === st.hlGroup) return
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      ;(m.material as THREE.Material | undefined)?.dispose()
    })
    st.hlGroup.clear()
    const mesh = selectedId ? st.itemMeshes.get(selectedId) : null
    if (mesh) {
      const hl = buildBoundsEdges(mesh)
      hl.position.copy(mesh.position)
      hl.rotation.copy(mesh.rotation)
      hl.scale.copy(mesh.scale)
      st.hlGroup.add(hl)
    }
  }, [items, selectedId])

  // —— 同步机位对象与视图 ——
  React.useEffect(() => {
    const st = stateRef.current
    if (!st) return
    const [px, py, pz] = camera.position
    const [tx, ty, tz] = camera.target
    st.camGizmo.position.set(px, py, pz)
    st.camGizmo.lookAt(new THREE.Vector3(tx, ty, tz))
    if (viewFromCamera) {
      st.camera.position.set(px, py, pz)
      st.controls.target.set(tx, ty, tz)
      st.camGizmo.visible = false
    } else {
      st.controls.target.set(0, 1, 0)
      st.camGizmo.visible = true
    }
  }, [camera, viewFromCamera])

  // —— 拾取与地面拖拽 ——
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = stateRef.current
    if (!st) return
    const rect = st.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    st.raycaster.setFromCamera(ndc, st.camera)
    const hit = st.raycaster.intersectObjects([...st.itemMeshes.values()], true).find((h) => h.object.userData.itemId)
    const id = (hit?.object.userData.itemId as string | undefined) ?? null
    if (id && id !== "__ground__") {
      propsRef.current.onSelect(id)
      st.dragId = id
      st.dragging = true
      st.controls.enabled = false
      st.renderer.domElement.setPointerCapture(e.pointerId)
    } else {
      propsRef.current.onSelect(null)
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = stateRef.current
    if (!st || !st.dragging || !st.dragId) return
    const rect = st.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    st.raycaster.setFromCamera(ndc, st.camera)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const pt = new THREE.Vector3()
    st.raycaster.ray.intersectPlane(plane, pt)
    if (pt) propsRef.current.onMoveItem(st.dragId, Math.round(pt.x * 100) / 100, Math.round(pt.z * 100) / 100)
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = stateRef.current
    if (!st) return
    st.dragging = false
    st.dragId = null
    st.controls.enabled = true
    if (st.renderer.domElement.hasPointerCapture(e.pointerId)) st.renderer.domElement.releasePointerCapture(e.pointerId)
  }

  // —— 真实导出：预演帧 / 深度（RGBADepthPacking 反读）/ 边缘（包围盒线框）· 按画幅 ——
  React.useImperativeHandle(ref, () => ({
    captureMaps: (aspect: MapAspect = "16:9") => {
      const st = stateRef.current
      if (!st) return { previewUrl: "", depthUrl: "", edgeUrl: "" }
      const ratio = ASPECT_RATIOS[aspect]
      const w = ratio >= 1 ? MAP_BASE : Math.round(MAP_BASE * ratio)
      const h = ratio >= 1 ? Math.round(MAP_BASE / ratio) : MAP_BASE
      const rt = new THREE.WebGLRenderTarget(w, h)

      // 画幅 + 机位：以 shot.camera 为准渲染（导出图与下游 video_gen 消费一致），
      // 排除选中高亮图层；异常时恢复相机/画幅/可见性
      const withCaptureView = <T,>(fn: () => T): T => {
        const cam = propsRef.current.camera
        const prevPos = st.camera.position.clone()
        const prevTarget = st.controls.target.clone()
        const prevAspect = st.camera.aspect
        st.camera.position.set(...cam.position)
        st.camera.lookAt(...cam.target) // 机位朝向必须指向目标（否则沿用轨道朝向）
        st.controls.target.set(...cam.target)
        st.camera.aspect = w / h
        st.camera.updateProjectionMatrix()
        // 导出画面排除：选中高亮 + 机位线框
        st.hlGroup.visible = false
        st.camGizmo.visible = false
        try {
          return fn()
        } finally {
          st.hlGroup.visible = true
          st.camGizmo.visible = !propsRef.current.viewFromCamera
          st.camera.position.copy(prevPos)
          st.controls.target.copy(prevTarget)
          st.camera.aspect = prevAspect
          st.camera.updateProjectionMatrix()
        }
      }
      const read = (): string => {
        const px = new Uint8Array(w * h * 4)
        st.renderer.readRenderTargetPixels(rt, 0, 0, w, h, px)
        const canvas = document.createElement("canvas")
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext("2d")!
        const img = ctx.createImageData(w, h)
        for (let i = 0; i < w * h; i++) {
          img.data[i * 4] = px[i * 4]
          img.data[i * 4 + 1] = px[i * 4 + 1]
          img.data[i * 4 + 2] = px[i * 4 + 2]
          img.data[i * 4 + 3] = 255
        }
        ctx.putImageData(img, 0, 0)
        return canvas.toDataURL("image/png")
      }

      // 预演帧：正常渲染
      const previewUrl = withCaptureView(() => {
        st.renderer.setRenderTarget(rt)
        st.renderer.render(st.scene, st.camera)
        return read()
      })

      // 深度图：overrideMaterial 深度材质 → 灰度反读（近亮远暗）
      const depthUrl = withCaptureView(() => {
        const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
        st.scene.overrideMaterial = depthMat
        try {
          st.renderer.render(st.scene, st.camera)
        } finally {
          st.scene.overrideMaterial = null
          depthMat.dispose()
        }
        const depthPx = new Uint8Array(w * h * 4)
        st.renderer.readRenderTargetPixels(rt, 0, 0, w, h, depthPx)
        const canvas = document.createElement("canvas")
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext("2d")!
        const img = ctx.createImageData(w, h)
        for (let i = 0; i < w * h; i++) {
          const o = i * 4
          const depth = (depthPx[o] + depthPx[o + 1] / 255 + depthPx[o + 2] / 65025) / 255
          const g = Math.round(240 - Math.min(1, depth) * 200)
          img.data[o] = g
          img.data[o + 1] = g
          img.data[o + 2] = g
          img.data[o + 3] = 255
        }
        ctx.putImageData(img, 0, 0)
        return canvas.toDataURL("image/png")
      })

      // 边缘图：黑底白线（包围盒线框，人偶取整体包围盒）
      const edgeUrl = withCaptureView(() => {
        const edgeScene = new THREE.Scene()
        edgeScene.background = new THREE.Color(0x18181b)
        const disposables: { geometry?: THREE.BufferGeometry; material?: THREE.Material }[] = []
        for (const mesh of st.itemMeshes.values()) {
          const edges = buildBoundsEdges(mesh)
          edges.material = new THREE.LineBasicMaterial({ color: 0xf4f4f5 })
          edges.position.copy(mesh.position)
          edges.rotation.copy(mesh.rotation)
          edges.scale.copy(mesh.scale)
          disposables.push({ geometry: edges.geometry, material: edges.material })
          edgeScene.add(edges)
        }
        try {
          st.renderer.setRenderTarget(rt)
          st.renderer.render(edgeScene, st.camera)
          return read()
        } finally {
          for (const d of disposables) {
            d.geometry?.dispose()
            d.material?.dispose()
          }
        }
      })

      st.renderer.setRenderTarget(null)
      rt.dispose()
      return { previewUrl, depthUrl, edgeUrl }
    },

    getViewCamera: () => {
      const st = stateRef.current
      if (!st) return { position: [0, 2, 8], target: [0, 1, 0], fov: 45 }
      const pos = st.camera.position
      const tgt = st.controls.target
      return {
        position: [Math.round(pos.x * 100) / 100, Math.round(pos.y * 100) / 100, Math.round(pos.z * 100) / 100],
        target: [Math.round(tgt.x * 100) / 100, Math.round(tgt.y * 100) / 100, Math.round(tgt.z * 100) / 100],
        fov: st.camera.fov,
      }
    },

    captureOrbitPreviews: (count: number) => {
      const st = stateRef.current
      if (!st) return []
      const out: OrbitPreview[] = []
      const tgt = st.controls.target
      const dist = st.camera.position.distanceTo(tgt)
      const y = st.camera.position.y
      const prevPos = st.camera.position.clone()
      const prevAspect = st.camera.aspect
      const w = MAP_BASE
      const h = Math.round(MAP_BASE / (16 / 9))
      const rt = new THREE.WebGLRenderTarget(w, h)
      st.hlGroup.visible = false
      try {
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2
          st.camera.position.set(tgt.x + Math.cos(angle) * dist, y, tgt.z + Math.sin(angle) * dist)
          st.camera.lookAt(tgt)
          st.camera.aspect = w / h
          st.camera.updateProjectionMatrix()
          st.renderer.setRenderTarget(rt)
          st.renderer.render(st.scene, st.camera)
          const px = new Uint8Array(w * h * 4)
          st.renderer.readRenderTargetPixels(rt, 0, 0, w, h, px)
          const canvas = document.createElement("canvas")
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext("2d")!
          const img = ctx.createImageData(w, h)
          for (let j = 0; j < w * h; j++) {
            img.data[j * 4] = px[j * 4]
            img.data[j * 4 + 1] = px[j * 4 + 1]
            img.data[j * 4 + 2] = px[j * 4 + 2]
            img.data[j * 4 + 3] = 255
          }
          ctx.putImageData(img, 0, 0)
          out.push({
            url: canvas.toDataURL("image/png"),
            camera: {
              position: [Math.round(st.camera.position.x * 100) / 100, Math.round(st.camera.position.y * 100) / 100, Math.round(st.camera.position.z * 100) / 100],
              target: [Math.round(tgt.x * 100) / 100, Math.round(tgt.y * 100) / 100, Math.round(tgt.z * 100) / 100],
              fov: st.camera.fov,
            },
          })
        }
      } finally {
        st.hlGroup.visible = true
        st.camera.position.copy(prevPos)
        st.camera.lookAt(tgt)
        st.camera.aspect = prevAspect
        st.camera.updateProjectionMatrix()
        st.renderer.setRenderTarget(null)
        rt.dispose()
      }
      return out
    },
  }))

  return <div ref={hostRef} className="h-full w-full touch-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} />
})
