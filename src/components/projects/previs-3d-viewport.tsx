"use client"

import * as React from "react"
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { TransformControls } from "three/addons/controls/TransformControls.js"
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js"

import { toast } from "@/components/ui/toast"
import type { BlockingItem, PrevisShot } from "@/lib/types"
import { getRigQuaternion, reframeCamera } from "@/lib/engine/previs-camera"
import {
  CAM_LINE_COLOR,
  CAM_LINE_OPACITY,
  cameraBodyWireframeLines,
  cameraFrustumLines,
  cameraHitArea,
  type WirePoint,
} from "@/lib/engine/previs-rig-geometry"
import {
  CHARACTER_DEFAULT_TINT,
  createCharacterModel,
  ensureUe4Model,
  isUe4ModelReady,
} from "./previs-ue4-model"

/** 导出图基准分辨率（按画幅比例派生宽高） */
const MAP_BASE = 480
const ASPECT_RATIOS = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 } as const
export type MapAspect = keyof typeof ASPECT_RATIOS

const ITEM_COLOR: Record<BlockingItem["kind"], number> = {
  terrain: 0x9ca3af,
  character: CHARACTER_DEFAULT_TINT,
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

/** 变换模式：translate / rotate / scale（TransformControls） */
export type TransformMode = "translate" | "rotate" | "scale"
/** 视图模式：director=导演环绕视角；camera=从当前机位看 */
export type ViewMode = "director" | "camera"
/** onTransform 的增量补丁（各字段可选） */
type ItemPatch = { position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] }
/** 运行时 props（可选新 props 已解析出默认值；editor 接线前旧 props 保留兼容） */
type ViewportRuntimeProps = PrevisViewportProps & {
  shots: PrevisShot[]
  shotIndex: number
  viewMode: ViewMode
  transformMode: TransformMode
  showLabels: boolean
}

const DEG = Math.PI / 180

/** 点击 vs 拖拽仲裁阈值（px） */
const CLICK_SLOP = 5
/** 导演视角默认落点（无历史时回退） */
const HOME_VIEW = { position: new THREE.Vector3(8, 8, 10), target: new THREE.Vector3(0, 1, 0), fov: 45 }
/** 未接线 shots prop 时的稳定空数组（防每渲染新 [] 触发 effect） */
const EMPTY_SHOTS: PrevisShot[] = []
/** 机位标签锚点：rig 原点上方偏移（世界坐标；spec §4.3 保留 +0.55） */
const RIG_LABEL_OFFSET_Y = 0.55

/** 从命中对象向上找携带 userData.itemId 的祖先（rig/图元 均可） */
function ownerId(obj: THREE.Object3D | null): string | null {
  let cur: THREE.Object3D | null = obj
  while (cur) {
    const id = cur.userData.itemId as string | undefined
    if (id) return id
    cur = cur.parent
  }
  return null
}

/** 命中对象祖先链上的机位索引（rig 命中盒所属 shot） */
function ancestorShotIndex(obj: THREE.Object3D | null): number | null {
  let cur: THREE.Object3D | null = obj
  while (cur) {
    const idx = cur.userData.shotIndex as number | undefined
    if (typeof idx === "number") return idx
    cur = cur.parent
  }
  return null
}

/** 包围盒线框（仅边缘图导出使用；选中高亮已移除，spec §4.1）：Group 取整体包围盒，Mesh 直接取几何边 */
function buildBoundsEdges(obj: THREE.Object3D): THREE.LineSegments {
  const box = new THREE.Box3().setFromObject(obj)
  if (obj instanceof THREE.Group) {
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x + 0.12, size.y + 0.12, size.z + 0.12)),
      new THREE.LineBasicMaterial({ color: 0xdc2626 }),
    )
    edges.position.copy(center)
    return edges
  }
  return new THREE.LineSegments(
    new THREE.EdgesGeometry((obj as THREE.Mesh).geometry),
    new THREE.LineBasicMaterial({ color: 0xdc2626 }),
  )
}

/** 角色模型实例 → 专属资源释放函数（UE4 克隆材质等；见 previs-ue4-model 释放契约）。
 *  WeakMap 而非 userData：释放函数不可序列化，且随对象回收自动清理。 */
const modelDisposers = new WeakMap<THREE.Object3D, () => void>()

/** 图元 → 3D 网格：地形=薄板，角色=UE4 素体（失败/未就绪回退程序化人偶），道具=方体。
 *  按 v2 变换直接落地：y 即数据真实高度（角色=脚底平面，prop/terrain=几何中心），无隐式抬升；
 *  角色/道具 castShadow（地面 receiveShadow，见初始化）；材质统一 meshStandardMaterial。 */
function buildMesh(item: BlockingItem): THREE.Object3D {
  if (item.kind === "character") {
    const { object, dispose } = createCharacterModel(item)
    modelDisposers.set(object, dispose)
    object.userData.itemId = item.id
    object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true
    })
    const [x, y, z] = item.position
    object.position.set(x, y, z) // v2：y = 脚底高度
    const [rx, ry, rz] = item.rotation
    object.rotation.set(rx * DEG, ry * DEG, rz * DEG)
    object.scale.set(item.scale[0], item.scale[1], item.scale[2])
    return object
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

/** 机位 rig：0.35 缩比线框摄像机（盒体 12 线 + 镜头倒锥 + 后部双圆盘 + 视锥远帧）+ 隐形命中盒。
 *  组原点 = 摄像机位置；局部 +Z = 机位前方（指向 target，朝向由 getRigQuaternion 给出）——与 REF 同约定。 */
function buildCameraRig(): THREE.Group {
  const g = new THREE.Group()
  const addLine = (pts: WirePoint[]) => {
    const geo = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p)))
    const l = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: CAM_LINE_COLOR, transparent: true, opacity: CAM_LINE_OPACITY }),
    )
    g.add(l)
  }
  for (const pts of cameraBodyWireframeLines()) addLine(pts)
  for (const [a, b] of cameraFrustumLines()) addLine([a, b])
  // 隐形命中盒（REF getViewportCameraHitArea 同值；点击 = 选中该机位对应 shot）
  const hitArea = cameraHitArea()
  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(...hitArea.args),
    // depthWrite: false —— 否则隐形命中盒会在透明 pass 写深度，深度剔除镜头线/前框线/后盘 2
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  )
  hit.position.set(...hitArea.position)
  g.add(hit)
  return g
}

/** CSS2D 名字标签元素（居中圆角胶囊） */
function makeLabelEl(text: string): HTMLElement {
  const el = document.createElement("div")
  el.className =
    "pointer-events-none whitespace-nowrap rounded-full border border-border/60 bg-background/85 px-2 py-0.5 text-[10px] leading-none text-foreground shadow-sm backdrop-blur-sm"
  el.textContent = text
  return el
}

/** 世界包围盒顶 + pad → 挂在 mesh 上的标签所需局部 y（按 mesh 世界 Y 缩放折算；仅对 yaw 类姿态精确，可接受近似） */
function labelLocalY(mesh: THREE.Object3D, pad = 0.15): number {
  mesh.updateWorldMatrix(true, false)
  const box = new THREE.Box3().setFromObject(mesh)
  const e = mesh.matrixWorld.elements
  const sy = Math.hypot(e[4], e[5], e[6]) // 局部 +Y 经 matrixWorld 的基向量长度
  const originY = e[13] // matrixWorld 平移 Y（= 世界原点 Y）
  if (sy < 1e-6) return 0
  return (box.max.y - originY + pad) / sy
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
  /** 按画幅比例真实导出三图（机位 + shot fov，排除全部 hideFromViewportCapture 层） */
  captureMaps: (aspect?: MapAspect) => CaptureResult
  /** 当前环绕视角（导演视角）的机位读数 */
  getViewCamera: () => PrevisShot["camera"]
  /** 环绕目标一圈拍摄 count 张预览（瞬态，不持久化） */
  captureOrbitPreviews: (count: number) => OrbitPreview[]
  /** 锁定/释放相机画幅：null = 跟随容器宽高比；非 null = 固定比例（editor 画幅切换时调用） */
  setViewAspect: (aspect: number | null) => void
  /** 从 target 沿 axis 方向、距离 = 当前相机-target 距离处快照视图（仅 director 模式生效） */
  snapViewToAxis: (axis: [number, number, number]) => void
}

/**
 * 3D 预演视口（three.js）：
 * - 布景项图元 + 地面网格 + OrbitControls 环绕（viewMode=director）
 * - TransformControls（translate/rotate/scale）+ 地面直拖；对象级别 onTransform 帧/终帧派发
 * - 每 shot 一个机位 rig（线框摄像机+视锥+隐形命中盒，点击 = onSelectShot）
 * - CSS2D 名字标签（角色头顶 / 机位NN）；右上角轴向视图 gizmo（仅 director）
 * - viewMode=camera：相机置入 shot 机位（position/target/fov），orbit 关闭；返回 director 恢复快照
 * - captureMaps()：按画幅真实渲染 布景/深度/边缘 三图（排除全部 hideFromViewportCapture 对象）
 */
export interface PrevisViewportProps {
  items: BlockingItem[]
  camera: PrevisShot["camera"]
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** 全量分镜表（editor 接线后传入；未传入时退化为单镜头旧 props） */
  shots?: PrevisShot[]
  shotIndex?: number
  viewMode?: ViewMode
  transformMode?: TransformMode
  /** 名字标签开关（默认开） */
  showLabels?: boolean
  /** 点击机位 rig → 切换分镜（不跳视角） */
  onSelectShot?: (index: number) => void
  /** 变换结果增量回写：commit=false 为拖拽帧、true 为终帧（editor 据此建撤销快照） */
  onTransform?: (id: string, patch: ItemPatch, commit: boolean) => void
  /** 机位 rig 变换回写：commit=false 为拖拽帧、true 为终帧；fov 不变（editor 接线 T6；未传时 rig 仍视觉随动） */
  onMoveRig?: (index: number, camera: PrevisShot["camera"], commit: boolean) => void
  /** editor 驱动的 rig 选中（值 `__cam_{i}`）；未传时由视口点击自理（不占用 selectedId） */
  selectedShotId?: string | null
}

export const PrevisViewport = React.forwardRef<PrevisViewportHandle, PrevisViewportProps>(
  function PrevisViewport(props, ref) {
    const {
      items, camera, selectedId, onSelect,
      shots = EMPTY_SHOTS, shotIndex = 0,
      viewMode = "director" as ViewMode,
      transformMode = "translate" as TransformMode,
      showLabels = true,
      selectedShotId,
    } = props
    const hostRef = React.useRef<HTMLDivElement | null>(null)
    const stateRef = React.useRef<{
      renderer: THREE.WebGLRenderer
      scene: THREE.Scene
      camera: THREE.PerspectiveCamera
      controls: OrbitControls
      itemMeshes: Map<string, THREE.Object3D>
      rigGroup: THREE.Group
      labelLayer: THREE.Group
      rigLabels: Map<number, CSS2DObject>
      gizmo: TransformControls
      gizmoActive: boolean
      raycaster: THREE.Raycaster
      viewAspect: number | null
      directorView: { pos: THREE.Vector3; target: THREE.Vector3; fov: number } | null
      inCameraView: boolean
      downAt: { x: number; y: number; id: string | null; obj: THREE.Object3D | null; moved: boolean } | null
      dragArmed: boolean
      dragId: string | null
      dragging: boolean
      raf: number
    } | null>(null)

    const propsRef = React.useRef<ViewportRuntimeProps>({
      items, camera, selectedId, onSelect,
      shots: [], shotIndex: 0, viewMode: "director", transformMode: "translate", showLabels: true,
    })
    propsRef.current = {
      items, camera, selectedId, onSelect, shots,
      shotIndex, viewMode, transformMode, showLabels,
      onSelectShot: props.onSelectShot,
      onTransform: props.onTransform,
      onMoveRig: props.onMoveRig,
      selectedShotId: props.selectedShotId,
    }

    /** 导出/环绕所用的机位：shots 接线后取 shots[shotIndex]，否则退化为旧 camera prop */
    const captureCam = (): PrevisShot["camera"] =>
      propsRef.current.shots[propsRef.current.shotIndex]?.camera ?? propsRef.current.camera

    /** onTransform 统一派发口（gizmo objectChange/commit 与指针直拖共用） */
    const emitTransform = (id: string, patch: ItemPatch, commit: boolean) => {
      propsRef.current.onTransform?.(id, patch, commit)
    }

    // —— 机位 rig 选中（独立于 selectedId：editor 面板仍以 selectedId 为图元选中） ——
    const [selectedRigIndex, setSelectedRigIndex] = React.useState<number | null>(null)
    /** rig 最近一次 translate/rotate 模式（scale 对 rig 禁用时回退用） */
    const rigModeRef = React.useRef<"translate" | "rotate">("translate")
    /** 「机位不支持缩放」toast 去重键：同一 rig 选中周期只提示一次（防每帧 spam） */
    const scaleToastKeyRef = React.useRef<string | null>(null)

    // —— editor 驱动 rig 选中：selectedShotId = `__cam_{i}`（未传时不接管视口点击选中） ——
    React.useEffect(() => {
      if (selectedShotId === undefined) return
      const m = selectedShotId ? /^__cam_(\d+)$/.exec(selectedShotId) : null
      setSelectedRigIndex(m ? Number(m[1]) : null)
    }, [selectedShotId])

    // —— UE4 素体就绪代数：初始渲染一律程序化；ensureUe4Model 成功后 +1 → 触发一次 items 重建 ——
    // 初始值读 isUe4ModelReady()：GLB 已缓存（如视口重挂载）时直接以 UE4 起步，避免二次重建。
    const [ue4Epoch, setUe4Epoch] = React.useState(() => (isUe4ModelReady() ? 1 : 0))
    React.useEffect(() => {
      let alive = true
      ensureUe4Model().then(
        () => {
          // e===0 才 +1（同值 bail out）——React 严格模式双跑也只重建一次
          if (alive) setUe4Epoch((e) => (e === 0 ? 1 : e))
        },
        () => {
          // GLB 加载失败：永久保持程序化回退（不重试、不抛出）
        },
      )
      return () => {
        alive = false
      }
    }, [])

    // —— 初始化场景与交互层（一次） ——
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

      // 半透明暗色地面 + 1m 节线无限网格（节线 #2A4065）——均不进画布导出（hideFromViewportCapture）
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
      camera.position.copy(HOME_VIEW.position)

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.target.copy(HOME_VIEW.target)
      controls.enableDamping = true

      // 机位 rig 层：每 shot 一个（director 模式可见，导出排除）
      const rigGroup = new THREE.Group()
      rigGroup.userData.hideFromViewportCapture = true
      scene.add(rigGroup)

      // CSS2D 标签：独立 DOM 层天然不进 canvas 导出
      const labelLayer = new THREE.Group()
      labelLayer.userData.hideFromViewportCapture = true
      scene.add(labelLayer)
      const labelRenderer = new CSS2DRenderer()
      labelRenderer.domElement.style.position = "absolute"
      labelRenderer.domElement.style.top = "0"
      labelRenderer.domElement.style.left = "0"
      labelRenderer.domElement.style.pointerEvents = "none"
      host.appendChild(labelRenderer.domElement)

      // TransformControls（变换 gizmo；helper 不进导出）
      const gizmo = new TransformControls(camera, renderer.domElement)
      const gizmoHelper = gizmo.getHelper()
      gizmoHelper.userData.hideFromViewportCapture = true
      gizmo.addEventListener("dragging-changed", (ev) => {
        const s = stateRef.current
        if (!s) return
        s.gizmoActive = ev.value === true
        s.controls.enabled = !s.gizmoActive && propsRef.current.viewMode !== "camera"
        if (!s.gizmoActive) {
          // 拖拽结束 → 终帧提交（three 无内置 commit 事件，自行派发）
          s.gizmo.dispatchEvent({ type: "commit" } as never)
        }
      })
      gizmo.addEventListener("objectChange", () => applyGizmoFrame(false))
      // commit 非 three 内置事件 → 类型放宽
      ;(gizmo as unknown as { addEventListener: (type: string, listener: () => void) => void })
        .addEventListener("commit", () => applyGizmoFrame(true))
      scene.add(gizmoHelper)

      // TransformControls r185.1 不监听 pointercancel/lostpointercapture：触控被系统取消的
      // gizmo 拖拽会让 dragging 卡死 → 直接置 s.gizmo.dragging = false：该属性经 defineProperty
      // 定义，setter 会复位内部 plane/gizmo 拖拽状态并派发 dragging-changed + change——
      // 既有 dragging-changed handler 由此恢复轨道并补发 commit 终帧（单派发事件不会复位内部状态）
      const releaseGizmoDrag = () => {
        const s = stateRef.current
        if (!s || !s.gizmo.dragging) return
        s.gizmo.dragging = false
      }
      renderer.domElement.addEventListener("pointercancel", releaseGizmoDrag)
      renderer.domElement.addEventListener("lostpointercapture", releaseGizmoDrag)

      const st = {
        renderer, scene, camera, controls,
        itemMeshes: new Map<string, THREE.Object3D>(),
        rigGroup, labelLayer, rigLabels: new Map<number, CSS2DObject>(),
        gizmo, gizmoActive: false,
        raycaster: new THREE.Raycaster(),
        viewAspect: null as number | null,
        directorView: null as { pos: THREE.Vector3; target: THREE.Vector3; fov: number } | null,
        inCameraView: false,
        downAt: null as { x: number; y: number; id: string | null; obj: THREE.Object3D | null; moved: boolean } | null,
        dragArmed: false, dragId: null as string | null, dragging: false,
        raf: 0,
      }
      stateRef.current = st

      const onResize = () => {
        const w = host.clientWidth
        const h = host.clientHeight
        if (w === 0 || h === 0) return
        renderer.setSize(w, h)
        labelRenderer.setSize(w, h)
        if (st.viewAspect == null) {
          camera.aspect = w / h
          camera.updateProjectionMatrix()
        }
      }
      onResize()
      const ro = new ResizeObserver(onResize)
      ro.observe(host)

      // 导演位姿快照：orbit 每次变更记录（仅 director/未拖拽时）
      const onControlsChange = () => {
        const s = stateRef.current
        if (!s || !s.controls.enabled) return
        s.directorView = { pos: s.camera.position.clone(), target: s.controls.target.clone(), fov: s.camera.fov }
      }
      controls.addEventListener("change", onControlsChange)

      const animate = () => {
        const s = stateRef.current
        if (!s) return
        // 机位视角下 controls 禁用 → 跳过 update（避免阻尼残留改写机位），恢复后自动续上
        if (s.controls.enabled) s.controls.update()
        renderer.render(scene, camera)
        labelRenderer.render(scene, camera)
        s.raf = requestAnimationFrame(animate)
      }
      st.raf = requestAnimationFrame(animate)

      return () => {
        cancelAnimationFrame(st.raf)
        ro.disconnect()
        renderer.domElement.removeEventListener("pointercancel", releaseGizmoDrag)
        renderer.domElement.removeEventListener("lostpointercapture", releaseGizmoDrag)
        controls.enabled = true // 兜底：卸载时若仍被拖拽禁用，恢复避免污染其他视口
        gizmo.dispose()
        controls.dispose()
        renderer.dispose()
        host.removeChild(labelRenderer.domElement)
        host.removeChild(renderer.domElement)
        stateRef.current = null
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    /** gizmo 变换 → 帧/终帧派发（读 gizmo.object 的当前位姿；rotate=度）。
     *  rig：按 REF commitCameraTransformFromViewport 语义重算 target（视距保持）后经 onMoveRig 派发。 */
    function applyGizmoFrame(commit: boolean) {
      const s = stateRef.current
      const obj = s?.gizmo.object
      if (!s || !obj) return
      const id = ownerId(obj)
      if (id === "__camera__") {
        const index = obj.userData.shotIndex as number | undefined
        const shot = index != null ? propsRef.current.shots[index] : undefined
        if (index == null || !shot) return
        // 局部 +Z = 机位前方（getRigQuaternion 约定）；rotate 时 target 沿新 forward 等距重算
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(obj.quaternion).normalize()
        const next = reframeCamera(
          shot.camera,
          [obj.position.x, obj.position.y, obj.position.z],
          [forward.x, forward.y, forward.z],
        )
        const round2 = (v: number) => Math.round(v * 100) / 100
        // 标签跟随 rig（世界坐标锚定；无 editor 接线时 rig 仍整体视觉随动）
        const label = s.rigLabels.get(index)
        if (label) label.position.set(obj.position.x, obj.position.y + RIG_LABEL_OFFSET_Y, obj.position.z)
        propsRef.current.onMoveRig?.(
          index,
          {
            position: [round2(next.position[0]), round2(next.position[1]), round2(next.position[2])],
            target: [round2(next.target[0]), round2(next.target[1]), round2(next.target[2])],
            fov: shot.camera.fov, // fov 不变（rig 拖动不改变镜头焦距）
          },
          commit,
        )
        return
      }
      if (!id || id === "__ground__") return
      const round2 = (v: number) => Math.round(v * 100) / 100
      emitTransform(id, {
        position: [round2(obj.position.x), round2(obj.position.y), round2(obj.position.z)],
        rotation: [
          round2(THREE.MathUtils.radToDeg(obj.rotation.x)),
          round2(THREE.MathUtils.radToDeg(obj.rotation.y)),
          round2(THREE.MathUtils.radToDeg(obj.rotation.z)),
        ],
        scale: [round2(obj.scale.x), round2(obj.scale.y), round2(obj.scale.z)],
      }, commit)
    }

    /** 摘除 CSS2D 标签时同步移除其 DOM 元素（否则元素滞留 labelRenderer 层漂浮） */
    function removeCSS2DLabel(o: THREE.Object3D) {
      if ((o as unknown as { isCSS2DObject?: boolean }).isCSS2DObject === true) {
        const el = (o as CSS2DObject).element
        el?.parentNode?.removeChild(el)
      }
    }

    /** 递归释放几何与材质（重建/移除时防 GPU 缓冲泄漏）；CSS2D 子标签连带清 DOM。
     *  角色模型走 createCharacterModel 的专属释放（UE4 几何/源材质为共享资源，不可在此释放）。 */
    function disposeObject(obj: THREE.Object3D) {
      const s = stateRef.current
      if (s?.gizmo.object === obj) s.gizmo.detach()
      obj.traverse(removeCSS2DLabel)
      const modelDispose = modelDisposers.get(obj)
      if (modelDispose) {
        modelDisposers.delete(obj)
        modelDispose()
        return
      }
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
        // 姿态签名：渲染路径代数（程序化→UE4）/体型/姿势/关节角度/颜色任一变化 → 重建人偶
        const rigKey =
          item.kind === "character"
            ? `${ue4Epoch}|${item.bodyType ?? ""}|${item.poseId ?? ""}|${JSON.stringify(item.controls ?? {})}|${item.color ?? ""}`
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
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items, selectedId, ue4Epoch])

    // —— CSS2D 角色名字标签（头顶 Box3 top + 0.15；跟随图元拖拽/缩放实时重挂） ——
    React.useEffect(() => {
      const st = stateRef.current
      if (!st || !propsRef.current.showLabels) {
        // 关标签：摘除既有 label 子对象（连同 DOM 引用清空）
        if (st) for (const mesh of st.itemMeshes.values()) {
          const label = mesh.userData.labelObj as CSS2DObject | undefined
          if (label) {
            removeCSS2DLabel(label)
            mesh.remove(label)
            mesh.userData.labelObj = null
          }
        }
        return
      }
      for (const item of propsRef.current.items) {
        const mesh = st.itemMeshes.get(item.id)
        if (!mesh) continue
        // 仅角色挂名字标签（机位 rig 的「机位N」标签另设）；非角色如残留旧标签一并摘除并清引用
        if (item.kind !== "character") {
          const stale = mesh.userData.labelObj as CSS2DObject | undefined
          if (stale) {
            removeCSS2DLabel(stale)
            mesh.remove(stale)
            mesh.userData.labelObj = null
          }
          continue
        }
        let label = mesh.userData.labelObj as CSS2DObject | undefined
        if (!label) {
          label = new CSS2DObject(makeLabelEl(item.name))
          mesh.add(label)
          mesh.userData.labelObj = label
        }
        // items 身份变化（重命名等）时同步标签文本
        label.element.textContent = item.name
        // 运行时按当前包围盒顶重算锚点（缩放/替换后仍贴头顶）
        label.position.y = labelLocalY(mesh)
        label.visible = true
      }
    }, [items, showLabels, ue4Epoch])

    // —— 机位 rig 同步（每 shot 一个 rig + 机位N 标签；rig 可见性随 viewMode） ——
    React.useEffect(() => {
      const st = stateRef.current
      if (!st) return
      const shots = propsRef.current.shots
      const director = propsRef.current.viewMode === "director"
      while (st.rigGroup.children.length > shots.length) {
        const o = st.rigGroup.children.pop()
        if (o) {
          // 释放线框几何/材质（shots 收缩弹出 rig 时防 GPU 缓冲泄漏）
          disposeObject(o)
          st.rigGroup.remove(o)
        }
      }
      st.rigGroup.visible = director
      shots.forEach((shot, i) => {
        let rig = st.rigGroup.children[i] as THREE.Group | undefined
        if (!rig) {
          rig = buildCameraRig()
          st.rigGroup.add(rig)
        }
        rig.position.set(...shot.camera.position)
        // 局部 +Z 指向 target（REF getViewportCameraQuaternion 同约定；镜头/视锥均朝 +Z）
        rig.quaternion.copy(getRigQuaternion(shot.camera.position, shot.camera.target))
        rig.userData.shotIndex = i
        rig.userData.itemId = "__camera__"
        // 机位NN 标签（两位补零；世界坐标锚定在 rig 正上方 +0.55；CSS2D 独立 DOM 层）
        let label = st.rigLabels.get(i)
        if (!label) {
          label = new CSS2DObject(makeLabelEl(`机位${String(i + 1).padStart(2, "0")}`))
          st.labelLayer.add(label)
          st.rigLabels.set(i, label)
        }
        label.position.set(rig.position.x, rig.position.y + RIG_LABEL_OFFSET_Y, rig.position.z)
        label.visible = director && propsRef.current.showLabels === true
      })
      for (const [i, label] of [...st.rigLabels]) {
        if (i >= shots.length) {
          removeCSS2DLabel(label)
          st.labelLayer.remove(label)
          st.rigLabels.delete(i)
        }
      }
    }, [shots, viewMode, showLabels])

    // —— 导演 / 机位视角 + fov / aspect ——
    React.useEffect(() => {
      const st = stateRef.current
      if (!st) return
      const shot = propsRef.current.shots[propsRef.current.shotIndex]
      if (propsRef.current.viewMode === "camera") {
        // 进入机位视角前定格导演位姿（仅当从导演态进入；camera 内切换 shot 不覆盖快照）
        if (!st.inCameraView) {
          st.directorView = { pos: st.camera.position.clone(), target: st.controls.target.clone(), fov: st.camera.fov }
          st.inCameraView = true
        }
        const cam = shot?.camera
        if (cam) {
          // 清掉轨道阻尼残留，防止禁用期间 update 改写机位
          const c = st.controls as unknown as { _sphericalDelta?: { set: (a: number, b: number, c: number) => void }; _panOffset?: { set: (a: number, b: number, c: number) => void } }
          c._sphericalDelta?.set(0, 0, 0)
          c._panOffset?.set(0, 0, 0)
          st.camera.position.set(...cam.position)
          st.controls.target.set(...cam.target)
          st.camera.fov = cam.fov
          st.camera.lookAt(st.controls.target)
          st.camera.updateProjectionMatrix()
        }
        // shotIndex 无对应分镜（shots 未就绪/越界）：保持相机于导演位姿、轨道保持禁用——
        // 不落入导演分支（不重开环绕、不覆盖导演快照）
        st.controls.enabled = false
      } else {
        st.inCameraView = false
        // 恢复导演位姿（无记录则默认 8,8,10 → (0,1,0)）
        const home = st.directorView
        if (home) {
          st.camera.position.copy(home.pos)
          st.controls.target.copy(home.target)
          st.camera.fov = home.fov
        } else {
          st.camera.position.copy(HOME_VIEW.position)
          st.controls.target.copy(HOME_VIEW.target)
          st.camera.fov = HOME_VIEW.fov
        }
        st.camera.lookAt(st.controls.target)
        st.camera.updateProjectionMatrix()
        st.controls.enabled = true
      }
    }, [viewMode, shotIndex, shots])

    // —— gizmo 附着与模式同步（图元 mesh 或机位 rig 组；items/rig 重建后重挂） ——
    React.useEffect(() => {
      const st = stateRef.current
      if (!st) return
      const mode = propsRef.current.transformMode ?? "translate"
      // rig 仅导演态可选/可挂（camera 视角下 rig 隐藏，不残留 gizmo）
      const rig =
        propsRef.current.viewMode === "director" && selectedRigIndex != null
          ? (st.rigGroup.children[selectedRigIndex] as THREE.Group | undefined) ?? null
          : null
      const mesh = !rig && selectedId ? st.itemMeshes.get(selectedId) : null
      const target = rig ?? (mesh && mesh.userData.itemId && mesh.userData.itemId !== "__ground__" ? mesh : null)
      if (target) {
        if (st.gizmo.object !== target) st.gizmo.attach(target)
      } else if (st.gizmo.object) {
        st.gizmo.detach()
      }
      // scale 对 rig 禁用（spec §4.2）：保持最近 translate/rotate + 一次性 toast
      if (rig && mode === "scale") {
        st.gizmo.setMode(rigModeRef.current)
        const key = String(selectedRigIndex)
        if (scaleToastKeyRef.current !== key) {
          scaleToastKeyRef.current = key
          toast.add({ title: "机位不支持缩放", type: "warning" })
        }
      } else {
        scaleToastKeyRef.current = null
        if (rig) rigModeRef.current = mode === "rotate" ? "rotate" : "translate"
        st.gizmo.setMode(mode)
      }
    }, [selectedId, selectedRigIndex, transformMode, viewMode, items, shots, ue4Epoch])

    // —— 拾取修复与手势仲裁（点击 vs ≥5px 拖拽；gizmo 激活时本通道让位） ——
    const pickAt = (clientX: number, clientY: number): { id: string | null; obj: THREE.Object3D | null } => {
      const st = stateRef.current
      if (!st) return { id: null, obj: null }
      const rect = st.renderer.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      st.raycaster.setFromCamera(ndc, st.camera)
      const targets: THREE.Object3D[] = [...st.itemMeshes.values()]
      if (propsRef.current.viewMode === "director") targets.push(st.rigGroup) // rig 仅在导演态可点
      const hit = st.raycaster.intersectObjects(targets, true).find((h) => ownerId(h.object))
      if (!hit) return { id: null, obj: null }
      return { id: ownerId(hit.object), obj: hit.object }
    }

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      const st = stateRef.current
      if (!st) return
      if (e.button !== 0) return
      if (st.gizmoActive || st.dragging) return
      // DOM 覆盖层（轴向 gizmo 按钮等）不进入拾取/拖拽
      if (e.target !== st.renderer.domElement) return
      const pick = pickAt(e.clientX, e.clientY)
      const id = pick.id
      st.downAt = { x: e.clientX, y: e.clientY, id, obj: pick.obj, moved: false }
      // 落在图元上：先禁用轨道（防拖动期间视角被带跑），未过阈值不算拖拽
      st.dragArmed = id != null && id !== "__ground__" && id !== "__camera__"
      if (st.dragArmed) st.controls.enabled = false
    }

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      const st = stateRef.current
      if (!st || !st.downAt) return
      if (st.gizmoActive) return
      if (!st.downAt.moved && Math.hypot(e.clientX - st.downAt.x, e.clientY - st.downAt.y) > CLICK_SLOP) {
        st.downAt.moved = true
      }
      if (!st.dragArmed || !st.downAt.moved) return
      if (!st.dragging) {
        // 过阈值 → 进入拖拽：选中 + 指针捕获（图元拖拽同时取消 rig 选中，gizmo 让位图元）
        const id = st.downAt.id
        if (!id) return
        setSelectedRigIndex(null)
        propsRef.current.onSelect(id)
        st.dragId = id
        st.dragging = true
        st.renderer.domElement.setPointerCapture(e.pointerId)
      }
      const mesh = st.dragId ? st.itemMeshes.get(st.dragId) : null
      if (!mesh) return // 拖拽中目标被移除 → 等 endDrag 收尾
      // 沿过 mesh 自身 y 的水平面走（角色=脚底高，prop/terrain=中心高，不落回 0）
      const rect = st.renderer.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      st.raycaster.setFromCamera(ndc, st.camera)
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -mesh.position.y)
      const pt = new THREE.Vector3()
      if (st.raycaster.ray.intersectPlane(plane, pt)) {
        mesh.position.x = pt.x
        mesh.position.z = pt.z
        emitTransform(st.dragId!, { position: [Math.round(pt.x * 100) / 100, Math.round(pt.y * 100) / 100, Math.round(pt.z * 100) / 100] }, false)
      }
    }

    /** 手势收尾：pointerup（正常）或 pointercancel / 移出画布（中止）——中止时不派发点选语义 */
    const endDrag = (e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
      const st = stateRef.current
      if (!st) return
      const wasDragging = st.dragging
      if (wasDragging) {
        st.dragging = false
        const id = st.dragId
        st.dragId = null
        st.dragArmed = false
        // 恢复轨道：camera 模式或 gizmo 激活时保持禁用（与 dragging-changed handler 同一判定）
        st.controls.enabled = propsRef.current.viewMode !== "camera" && !st.gizmoActive
        if (st.renderer.domElement.hasPointerCapture(e.pointerId)) {
          st.renderer.domElement.releasePointerCapture(e.pointerId)
        }
        // 直拖终帧提交
        const mesh = id ? st.itemMeshes.get(id) : null
        if (id && mesh) {
          emitTransform(id, {
            position: [
              Math.round(mesh.position.x * 100) / 100,
              Math.round(mesh.position.y * 100) / 100,
              Math.round(mesh.position.z * 100) / 100,
            ],
          }, true)
        }
      }
      // 点选语义：未拖（<5px）且未被系统取消 → 点击
      if (!cancelled && st.downAt && !st.downAt.moved) {
        const { id, obj } = st.downAt
        if (id === "__camera__" && obj) {
          // rig 点击：选中 rig（gizmo 挂 rig 组）+ 切换分镜；同时清空图元选中（不占用 selectedId）
          const shot = ancestorShotIndex(obj)
          if (shot != null) {
            setSelectedRigIndex(shot)
            propsRef.current.onSelectShot?.(shot)
          }
          propsRef.current.onSelect(null)
        } else if (id && id !== "__ground__") {
          setSelectedRigIndex(null)
          propsRef.current.onSelect(id)
        } else {
          // 空点：取消图元选中 + 取消 rig 选中（spec §4.4）
          setSelectedRigIndex(null)
          propsRef.current.onSelect(null)
        }
      }
      st.downAt = null
      st.dragArmed = false
      // 未拖过阈值的收尾同样按 camera/gizmo 判定恢复（camera 模式不重开环绕）
      if (!wasDragging) st.controls.enabled = propsRef.current.viewMode !== "camera" && !st.gizmoActive
    }

    /** 已 armed 但未过阈值的指针移出画布（未捕获）→ 中止本次手势，避免轨道被锁死 */
    const abortArmedGesture = () => {
      const st = stateRef.current
      if (!st || st.dragging || !st.dragArmed) return
      st.downAt = null
      st.dragArmed = false
      // camera 模式 / gizmo 激活下维持禁用
      st.controls.enabled = propsRef.current.viewMode !== "camera" && !st.gizmoActive
    }

    /** 轴向快照视图（右键上角 gizmo 6 按钮调用；仅 director 生效） */
    const snapViewToAxis = (axis: [number, number, number]) => {
      const st = stateRef.current
      if (!st) return
      if (propsRef.current.viewMode !== "director") return
      const tgt = st.controls.target
      const dist = st.camera.position.distanceTo(tgt) || 5
      const v = new THREE.Vector3(...axis).normalize().multiplyScalar(dist)
      st.camera.position.copy(tgt).add(v)
      st.camera.lookAt(tgt)
      st.directorView = { pos: st.camera.position.clone(), target: st.controls.target.clone(), fov: st.camera.fov }
      st.controls.update()
    }

    // —— 真实导出：预演帧 / 深度（RGBADepthPacking 反读）/ 边缘（包围盒线框）· 按画幅 ——
    React.useImperativeHandle(ref, () => ({
      captureMaps: (aspect: MapAspect = "16:9") => {
        const s = stateRef.current
        if (!s) return { previewUrl: "", depthUrl: "", edgeUrl: "" }
        const ratio = ASPECT_RATIOS[aspect]
        const w = ratio >= 1 ? MAP_BASE : Math.round(MAP_BASE * ratio)
        const h = ratio >= 1 ? Math.round(MAP_BASE / ratio) : MAP_BASE
        const rt = new THREE.WebGLRenderTarget(w, h)
        const cam = captureCam()

        /** 画幅 + 机位渲染：相机置入 shot（position/target/fov）、画幅 aspect；
         *  并隐藏全部 hideFromViewportCapture 对象（地面/网格/机位 rig/gizmo helper/CSS2D 层天然排除）。 */
        const withCaptureView = <T,>(fn: () => T): T => {
          const prevPos = s.camera.position.clone()
          const prevTarget = s.controls.target.clone()
          const prevFov = s.camera.fov
          const prevAspect = s.camera.aspect
          s.camera.position.set(...cam.position)
          s.camera.lookAt(...cam.target) // 机位朝向必须指向目标（否则沿用轨道朝向）
          s.controls.target.set(...cam.target)
          s.camera.fov = cam.fov
          s.camera.aspect = w / h
          s.camera.updateProjectionMatrix()
          // 导出画面排除：hideFromViewportCapture=true 的全部对象（rig/网格/地面/gizmo/CSS2D 标签层）
          const hidden: THREE.Object3D[] = []
          s.scene.traverse((o) => {
            if (o.userData.hideFromViewportCapture) {
              if (o.visible) hidden.push(o)
              o.visible = false
            }
          })
          try {
            return fn()
          } finally {
            for (const o of hidden) o.visible = true
            s.camera.position.copy(prevPos)
            s.controls.target.copy(prevTarget)
            s.camera.fov = prevFov
            s.camera.aspect = prevAspect
            s.camera.updateProjectionMatrix()
            // capture 期间相机朝向 shot target；camera 模式（轨道禁用）不会自动回正——
            // 重瞄恢复后的 target，避免可见帧滞后一次朝向
            s.camera.lookAt(prevTarget)
          }
        }
        const read = (): string => {
          const px = new Uint8Array(w * h * 4)
          s.renderer.readRenderTargetPixels(rt, 0, 0, w, h, px)
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
          s.renderer.setRenderTarget(rt)
          s.renderer.render(s.scene, s.camera)
          return read()
        })

        // 深度图：overrideMaterial 深度材质 → 灰度反读（近亮远暗）
        const depthUrl = withCaptureView(() => {
          const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
          s.scene.overrideMaterial = depthMat
          try {
            s.renderer.render(s.scene, s.camera)
          } finally {
            s.scene.overrideMaterial = null
            depthMat.dispose()
          }
          const depthPx = new Uint8Array(w * h * 4)
          s.renderer.readRenderTargetPixels(rt, 0, 0, w, h, depthPx)
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
          for (const mesh of s.itemMeshes.values()) {
            const edges = buildBoundsEdges(mesh)
            edges.material = new THREE.LineBasicMaterial({ color: 0xf4f4f5 })
            edges.position.copy(mesh.position)
            edges.rotation.copy(mesh.rotation)
            edges.scale.copy(mesh.scale)
            disposables.push({ geometry: edges.geometry, material: edges.material })
            edgeScene.add(edges)
          }
          try {
            s.renderer.setRenderTarget(rt)
            s.renderer.render(edgeScene, s.camera)
            return read()
          } finally {
            for (const d of disposables) {
              d.geometry?.dispose()
              d.material?.dispose()
            }
          }
        })

        s.renderer.setRenderTarget(null)
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
        // 预览瞬态：仅排除变换 gizmo helper（地面/网格/机位 rig 保留导演视角上下文）
        const prevGizmo = st.gizmo.getHelper().visible
        st.gizmo.getHelper().visible = false
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
          st.gizmo.getHelper().visible = prevGizmo
          st.camera.position.copy(prevPos)
          st.camera.lookAt(tgt)
          st.camera.aspect = prevAspect
          st.camera.updateProjectionMatrix()
          st.renderer.setRenderTarget(null)
          rt.dispose()
        }
        return out
      },

      setViewAspect: (aspect: number | null) => {
        const st = stateRef.current
        if (!st) return
        st.viewAspect = aspect
        const host = hostRef.current
        if (aspect == null) {
          const w = host?.clientWidth ?? 16
          const h = Math.max(1, host?.clientHeight ?? 9)
          st.camera.aspect = w / h
        } else {
          st.camera.aspect = aspect
        }
        st.camera.updateProjectionMatrix()
      },

      snapViewToAxis,
    }))

    // —— 轴向视图 gizmo（DOM，右上角；仅 director 模式显示） ——
    const axisBtn =
      "pointer-events-auto rounded px-1.5 text-[10px] font-bold leading-5 transition-colors hover:bg-border/60"

    return (
      <div
        ref={hostRef}
        className="relative h-full w-full touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e, false)}
        onPointerCancel={(e) => endDrag(e, true)}
        onPointerLeave={abortArmedGesture}
      >
        {viewMode === "director" && (
          <div className="pointer-events-none absolute right-2 top-2 z-10 flex flex-col items-center gap-0.5 rounded-md border border-border/60 bg-background/70 p-0.5 shadow-sm backdrop-blur-sm">
            <button
              type="button"
              aria-label="切换到 Y 正向视图"
              title="+Y 视图"
              className={`${axisBtn} text-emerald-400`}
              onClick={() => snapViewToAxis([0, 1, 0])}
            >
              Y
            </button>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="切换到 X 反向视图"
                title="−X 视图"
                className={`${axisBtn} text-rose-400`}
                onClick={() => snapViewToAxis([-1, 0, 0])}
              >
                X−
              </button>
              <span className="inline-block size-1.5 rounded-full bg-zinc-400" aria-hidden />
              <button
                type="button"
                aria-label="切换到 X 正向视图"
                title="+X 视图"
                className={`${axisBtn} text-rose-400`}
                onClick={() => snapViewToAxis([1, 0, 0])}
              >
                X
              </button>
            </div>
            <button
              type="button"
              aria-label="切换到 Y 反向视图"
              title="−Y 视图"
              className={`${axisBtn} text-emerald-400`}
              onClick={() => snapViewToAxis([0, -1, 0])}
            >
              Y−
            </button>
            <button
              type="button"
              aria-label="切换到 Z 正向视图"
              title="+Z 视图"
              className={`${axisBtn} text-sky-400`}
              onClick={() => snapViewToAxis([0, 0, 1])}
            >
              Z
            </button>
            <button
              type="button"
              aria-label="切换到 Z 反向视图"
              title="−Z 视图"
              className={`${axisBtn} text-sky-400`}
              onClick={() => snapViewToAxis([0, 0, -1])}
            >
              Z−
            </button>
          </div>
        )}
      </div>
    )
  },
)
