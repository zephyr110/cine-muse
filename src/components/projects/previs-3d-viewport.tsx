"use client"

import * as React from "react"
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

import type { BlockingItem, PrevisShot } from "@/lib/types"

/** 导出图分辨率（与 2D SVG 一致 16:9） */
const MAP_W = 480
const MAP_H = 270

const ITEM_COLOR: Record<BlockingItem["kind"], number> = {
  terrain: 0x9ca3af,
  character: 0x6366f1,
  prop: 0xf59e0b,
}

/** 图元 → 3D 网格：地形=薄板，角色=胶囊，道具=方体 */
function buildMesh(item: BlockingItem): THREE.Object3D {
  let geo: THREE.BufferGeometry
  if (item.kind === "terrain") {
    geo = new THREE.BoxGeometry(3, 0.2, 3)
  } else if (item.kind === "character") {
    geo = new THREE.CapsuleGeometry(0.4, 1, 4, 12)
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
  // 角色朝向箭头（顶部小锥体）
  if (item.kind === "character") {
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.15, 0.3, 8),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
    )
    arrow.position.y = 1.6
    arrow.rotation.x = Math.PI / 2
    mesh.add(arrow)
  }
  return mesh
}

export interface CaptureResult {
  previewUrl: string
  depthUrl: string
  edgeUrl: string
}

export interface PrevisViewportHandle {
  captureMaps: () => CaptureResult
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
      // 选中高亮：外框线
      mesh.userData.highlight?.remove()
      const hl = new THREE.LineSegments(
        new THREE.EdgesGeometry((mesh as THREE.Mesh).geometry),
        new THREE.LineBasicMaterial({ color: 0xdc2626 }),
      )
      if (selectedId === item.id) mesh.add(hl)
      mesh.userData.highlight = selectedId === item.id ? hl : null
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

  // —— 真实导出：深度（RGBADepthPacking 反读）/ 边缘（EdgesGeometry 线框）/ 预演帧 ——
  React.useImperativeHandle(ref, () => ({
    captureMaps: () => {
      const st = stateRef.current
      if (!st) return { previewUrl: "", depthUrl: "", edgeUrl: "" }
      const rt = new THREE.WebGLRenderTarget(MAP_W, MAP_H)
      const read = (): string => {
        const px = new Uint8Array(MAP_W * MAP_H * 4)
        st.renderer.readRenderTargetPixels(rt, 0, 0, MAP_W, MAP_H, px)
        const canvas = document.createElement("canvas")
        canvas.width = MAP_W
        canvas.height = MAP_H
        const ctx = canvas.getContext("2d")!
        const img = ctx.createImageData(MAP_W, MAP_H)
        for (let i = 0; i < MAP_W * MAP_H; i++) {
          img.data[i * 4] = px[i * 4]
          img.data[i * 4 + 1] = px[i * 4 + 1]
          img.data[i * 4 + 2] = px[i * 4 + 2]
          img.data[i * 4 + 3] = 255
        }
        ctx.putImageData(img, 0, 0)
        return canvas.toDataURL("image/png")
      }

      // 预演帧：正常渲染
      st.renderer.setRenderTarget(rt)
      st.renderer.render(st.scene, st.camera)
      const previewUrl = read()

      // 深度图：overrideMaterial 深度材质 → 灰度反读（近亮远暗）
      st.scene.overrideMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
      st.renderer.render(st.scene, st.camera)
      st.scene.overrideMaterial = null
      const depthPx = new Uint8Array(MAP_W * MAP_H * 4)
      st.renderer.readRenderTargetPixels(rt, 0, 0, MAP_W, MAP_H, depthPx)
      const depthCanvas = document.createElement("canvas")
      depthCanvas.width = MAP_W
      depthCanvas.height = MAP_H
      const dctx = depthCanvas.getContext("2d")!
      const dimg = dctx.createImageData(MAP_W, MAP_H)
      for (let i = 0; i < MAP_W * MAP_H; i++) {
        const o = i * 4
        const depth = (depthPx[o] + depthPx[o + 1] / 255 + depthPx[o + 2] / 65025) / 255
        const g = Math.round(240 - Math.min(1, depth) * 200)
        dimg.data[o] = g
        dimg.data[o + 1] = g
        dimg.data[o + 2] = g
        dimg.data[o + 3] = 255
      }
      dctx.putImageData(dimg, 0, 0)
      const depthUrl = depthCanvas.toDataURL("image/png")

      // 边缘图：黑底白线（EdgesGeometry）
      const edgeScene = new THREE.Scene()
      edgeScene.background = new THREE.Color(0x18181b)
      for (const mesh of st.itemMeshes.values()) {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry((mesh as THREE.Mesh).geometry, 15),
          new THREE.LineBasicMaterial({ color: 0xf4f4f5 }),
        )
        edges.position.copy(mesh.position)
        edges.rotation.copy(mesh.rotation)
        edges.scale.copy(mesh.scale)
        edgeScene.add(edges)
      }
      st.renderer.setRenderTarget(rt)
      st.renderer.render(edgeScene, st.camera)
      const edgeUrl = read()

      st.renderer.setRenderTarget(null)
      rt.dispose()
      return { previewUrl, depthUrl, edgeUrl }
    },
  }))

  return <div ref={hostRef} className="h-full w-full touch-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} />
})
