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

const DEG = Math.PI / 180

/** 程序化人偶：躯干/头/四肢胶囊，按体型比例 + 关节角度（controls 度）摆位 */
function buildMannequin(item: BlockingItem): THREE.Group {
  const g = new THREE.Group()
  const mat = new THREE.MeshLambertMaterial({ color: ITEM_COLOR.character })
  const body = BODY_TYPE_BY_ID[item.bodyType ?? "standard"]
  const controls = item.controls ?? POSE_PRESET_BY_ID[item.poseId ?? "stand"]?.controls ?? {}
  const h = body?.height ?? 1.8
  const w = body?.width ?? 1
  const hs = (body?.headSize ?? 0.34) / 2

  const limb = (len: number, rad: number, pivot: [number, number, number], joint: JointName): THREE.Object3D => {
    const holder = new THREE.Group()
    holder.position.set(...pivot)
    const [rx, ry, rz] = controls[joint] ?? [0, 0, 0]
    holder.rotation.set(rx * DEG, ry * DEG, rz * DEG)
    const seg = new THREE.Mesh(new THREE.CapsuleGeometry(rad, Math.max(0.05, len - rad * 2), 3, 10), mat)
    seg.position.y = -len / 2
    holder.add(seg)
    return holder
  }

  // 躯干（含朝向锥体由父级提供；这里加手臂挂点）
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32 * w, h * 0.32, 3, 12), mat)
  torso.position.y = h * 0.42
  const [tx, ty, tz] = controls.torso ?? [0, 0, 0]
  torso.rotation.set(tx * DEG, ty * DEG, tz * DEG)
  g.add(torso)

  const head = new THREE.Mesh(new THREE.SphereGeometry(hs, 16, 12), mat)
  head.position.y = h * 0.76
  const [hx, hy, hz] = controls.head ?? [0, 0, 0]
  head.rotation.set(hx * DEG, hy * DEG, hz * DEG)
  g.add(head)

  const armLen = h * 0.36
  const armRad = 0.11 * w
  g.add(limb(armLen, armRad, [-0.36 * w, h * 0.62, 0], "armL"))
  g.add(limb(armLen, armRad, [0.36 * w, h * 0.62, 0], "armR"))
  const legLen = h * 0.4
  const legRad = 0.14 * w
  g.add(limb(legLen, legRad, [-0.16 * w, h * 0.34, 0], "legL"))
  g.add(limb(legLen, legRad, [0.16 * w, h * 0.34, 0], "legR"))

  // 朝向箭头
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.15, 0.3, 8),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
  )
  arrow.position.y = h * 0.95
  arrow.rotation.x = Math.PI / 2
  g.add(arrow)

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

/** 图元 → 3D 网格：地形=薄板，角色=程序化人偶，道具=方体 */
function buildMesh(item: BlockingItem): THREE.Object3D {
  if (item.kind === "character") {
    const g = buildMannequin(item)
    g.userData.itemId = item.id
    const [x, , z] = item.position
    g.position.set(x, 0, z)
    g.rotation.y = item.rotationY
    g.scale.setScalar(item.scale)
    return g
  }
  let geo: THREE.BufferGeometry
  if (item.kind === "terrain") {
    geo = new THREE.BoxGeometry(3, 0.2, 3)
  } else {
    geo = new THREE.BoxGeometry(0.7, 0.7, 0.7)
  }
  const mat = new THREE.MeshLambertMaterial({ color: ITEM_COLOR[item.kind] })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.userData.itemId = item.id
  const [x, y, z] = item.position
  mesh.position.set(x, y + (item.kind === "terrain" ? 0 : 1), z)
  mesh.rotation.y = item.rotationY
  mesh.scale.setScalar(item.scale)
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
    scene.background = new THREE.Color(0xf4f4f5)

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.1))
    scene.add(new THREE.DirectionalLight(0xffffff, 0.8).translateZ(6))

    const grid = new THREE.GridHelper(16, 16, 0xa1a1aa, 0xd4d4d8)
    scene.add(grid)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 16),
      new THREE.MeshLambertMaterial({ color: 0xe4e4e7 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.01
    ground.userData.itemId = "__ground__"
    scene.add(ground)

    const camera = new THREE.PerspectiveCamera(45, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 100)
    camera.position.set(8, 8, 10)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1, 0)
    controls.enableDamping = true

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
      camGizmo, raycaster: new THREE.Raycaster(), dragId: null, dragging: false, raf: 0,
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

  // —— 同步布景项网格 ——
  React.useEffect(() => {
    const st = stateRef.current
    if (!st) return
    const keep = new Set<string>()
    for (const item of propsRef.current.items) {
      keep.add(item.id)
      let mesh = st.itemMeshes.get(item.id)
      if (!mesh) {
        mesh = buildMesh(item)
        st.scene.add(mesh)
        st.itemMeshes.set(item.id, mesh)
      }
      const [x, y, z] = item.position
      mesh.position.set(x, y + (item.kind === "terrain" ? 0 : 1), z)
      mesh.rotation.y = item.rotationY
      mesh.scale.setScalar(item.scale)
      // 选中高亮：外框线（人偶为 Group → 包围盒线框）
      mesh.userData.highlight?.remove()
      const hl = selectedId === item.id ? buildBoundsEdges(mesh) : null
      if (hl) mesh.add(hl)
      mesh.userData.highlight = hl
    }
    for (const [id, mesh] of [...st.itemMeshes]) {
      if (!keep.has(id)) {
        st.scene.remove(mesh)
        st.itemMeshes.delete(id)
      }
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

      const withAspect = <T,>(fn: () => T): T => {
        const prevAspect = st.camera.aspect
        st.camera.aspect = w / h
        st.camera.updateProjectionMatrix()
        const out = fn()
        st.camera.aspect = prevAspect
        st.camera.updateProjectionMatrix()
        return out
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
      const previewUrl = withAspect(() => {
        st.renderer.setRenderTarget(rt)
        st.renderer.render(st.scene, st.camera)
        return read()
      })

      // 深度图：overrideMaterial 深度材质 → 灰度反读（近亮远暗）
      const depthUrl = withAspect(() => {
        st.scene.overrideMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
        st.renderer.render(st.scene, st.camera)
        st.scene.overrideMaterial = null
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
      const edgeUrl = withAspect(() => {
        const edgeScene = new THREE.Scene()
        edgeScene.background = new THREE.Color(0x18181b)
        for (const mesh of st.itemMeshes.values()) {
          const edges = buildBoundsEdges(mesh)
          edges.material = new THREE.LineBasicMaterial({ color: 0xf4f4f5 })
          edges.position.copy(mesh.position)
          edges.rotation.copy(mesh.rotation)
          edges.scale.copy(mesh.scale)
          edgeScene.add(edges)
        }
        st.renderer.setRenderTarget(rt)
        st.renderer.render(edgeScene, st.camera)
        return read()
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
      const w = MAP_BASE
      const h = Math.round(MAP_BASE / (16 / 9))
      const rt = new THREE.WebGLRenderTarget(w, h)
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
      st.camera.position.copy(prevPos)
      st.camera.lookAt(tgt)
      st.camera.aspect = st.renderer.domElement.clientWidth / Math.max(1, st.renderer.domElement.clientHeight)
      st.camera.updateProjectionMatrix()
      st.renderer.setRenderTarget(null)
      rt.dispose()
      return out
    },
  }))

  return <div ref={hostRef} className="h-full w-full touch-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} />
})
