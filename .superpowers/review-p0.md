# P0 Director-Desk Feature Batch — Code Review

**Scope:** commits cf6732f..HEAD (worktree-previs-fullscreen)
**Files:** `src/components/projects/previs-3d-viewport.tsx`, `src/components/projects/previs-blocking-editor.tsx`, `src/lib/engine/previs-poses.ts(+test)`, `src/lib/engine/reducer.ts(+test)`, `src/lib/types.ts`, `src/lib/engine/seed.ts`, `package.json`
**Checks run:** `tsc --noEmit` clean · `vitest run` 26/26 pass · `next build` exit 0

## Verdict (post-fix 019fadc): **Needs fixes**

Original I1-I3 / M1-M3, M5-M7 are fixed and verified. M4's fix (capture from shot.camera) introduces a new Important defect: the capture camera never `lookAt`s the shot target and the camera gizmo sits exactly on the capture camera — the default export path renders from the wrong orientation with a wireframe-box ghost baked into the preview/depth maps. Two Important new findings + three Minor residuals, listed in the re-review section below.

## Original review (pre-fix)

---

## Important

### I1. 3D mannequin never updates when pose/bodyType/controls change
`previs-3d-viewport.tsx:270-275` (sync effect `[items, selectedId]`) — the mannequin mesh is built once via `buildMesh(item)` only when the item id is absent from `st.itemMeshes`; every subsequent sync only writes `position/rotation/scale`. Pose edits (`previs-blocking-editor.tsx:265-269` bodyType/poseId, `:496-500` slider onChange) commit the new `controls` into the item (and the undo stack) but the in-session mannequin keeps its initial pose. The 2D SVG path ignores controls entirely (`previs-render.ts:140-147` — `renderPreviewSvg(blocking, camera)` has no controls/bodyType handling), so pose edits render nowhere until the viewport remounts (center tab switch, or editor reopen).

**Failure scenario:** open fullscreen editor → select character → drag 左臂 slider → the degree readout and SVG… no, the SVG doesn't move either; the mannequin in the 3D view and the SVG markers both stay frozen; only the number changes. The headline P0 feature (pose driving the mannequin) is inert within a session.

**Fix:** rebuild (or mutate) the mesh when the item's `controls/bodyType/poseId` change — e.g. compare a per-item JSON signature in the sync effect and re-run `buildMesh` + dispose the old geometry/material when it changes.

### I2. Undo's first click is a silent no-op after every blocking-only edit; 50-cap effectively halved
`commit()` dispatches `UPDATE_PREVIS_BLOCKING` then `UPDATE_PREVIS_CAMERA`, both `commit: true` (`previs-blocking-editor.tsx:164-167`); the reducer pushes a snapshot in each case (`reducer.ts:542-553`, `:566-576`). Because the CAMERA dispatch's snapshot is taken *after* blocking was applied, it captures the intermediate state `[blockingNew, cameraOld]` — which then sits on top of the past stack and is identical to the just-committed state.

**Failure scenario:** drag an item (blocking-only commit) → past top = `[B1, C]` == current state → click 撤销 → pops it, applies it, nothing visibly happens (propsKey unchanged → no repaint) → click 撤销 again → item actually jumps back. Every undo after a drag or pose-slider edit needs two clicks for the first visible step, and each edit consumes 2 of the 50 slots (~25 effective undo ops). Slider drags commit per tick (1 snapshot per tick; the B-dispatch dedupes against the prior tick's intermediate) — a single 20-tick slider drag evicts 20 older entries via the 50-cap `past.shift()`.

**Fix:** make a logical edit a single action (one `commit?: boolean` snapshot of the pre-edit state), or skip the snapshot on the second dispatch when it equals the post-edit state — i.e. push only the true pre-edit snapshot per user gesture. Also consider coalescing per-tick slider/NumField commits (commit on release/blur) since per-tick commits flood the 50-cap.

### I3. Cross-stage PREVIS_UNDO permanently destroys the top snapshot
`reducer.ts:583-584`: `const snap = draft.previsUndo.past.pop()` runs *before* the guard `if (!snap || snap.stageId !== s.id) return` — a mismatched snapshot is popped and never re-pushed, i.e. silently deleted. The undo stack is global (one `AppState.previsUndo` across all projects/stages), while the undo button's disabled state only checks `state.previsUndo.past.length === 0` (`previs-blocking-editor.tsx:555`).

**Failure scenario:** edit previs stage in project A (history pushed) → open the fullscreen editor on project B's previs stage → click 撤销 (button is enabled) → pops A's newest snapshot, stageId mismatch, return → A's snapshot is gone forever; the button stays enabled but keeps no-oping.

**Fix:** peek at the top (`past[past.length-1]`) and only pop when `stageId` matches (loop or return without popping otherwise).

---

## Minor

### M1. Selection highlight baked into exported 3D maps
`previs-3d-viewport.tsx:281-284` adds the red bounds LineSegments as a child of the mesh; `captureMaps` renders the live scene (`:397-401` preview, `:404-426` depth). Exporting with an item selected — the normal state right after a drag — bakes the red box into `previewUrl`/`depthUrl` PNGs that flow into video_gen references, while the 2D SVG export stays clean (selection is UI-only CSS). Inconsistent artifacts between the two export paths. Also the camera-gizmo ray can appear in captures when the orbit camera sits near the shot camera.

### M2. Geometries/materials never disposed (bounded leak)
`previs-3d-viewport.tsx` — (a) every pointermove tick while dragging the selected item rebuilds the highlight at `:281-284` without disposing the previous EdgesGeometry/LineBasicMaterial; (b) items removed from the scene (e.g. paste → undo) at `:286-291` are removed without `traverse(dispose)`; (c) `captureMaps` allocates a MeshDepthMaterial (`:405`) and per-call edge LineSegments/materials (`:433-438`) without dispose. Resources are small and cleared on viewport unmount (`renderer.dispose()`), but a long editing session accumulates GPU buffers. Fix is a few `dispose()` calls.

### M3. withAspect / orbit-capture restore lack try/finally
`previs-3d-viewport.tsx:369-377` and `:504-507`: if the wrapped fn throws (e.g. `canvas.getContext("2d")` returns null → `createImageData` throws), `st.camera.aspect` stays corrupted, the render target stays bound, and `rt`/materials are never disposed; orbit capture likewise leaves the camera position moved. Low probability today, but the state-restore pattern should be try/finally.

### M4. Exported maps capture the orbit view, not shot.camera
`captureMaps`/`captureOrbitPreviews` render with the live viewport camera (orbit, or the shot camera only if 从机位看 is on), while `shot.camera` itself is not updated — so exported PNGs may not correspond to the stored camera that downstream video_gen consumes; only the 2D SVG always matches shot.camera. Either document this WYSIWYG behavior or export from shot.camera by default.

### M5. Clipboard paste: id collision + unclamped offset
`previs-blocking-editor.tsx:593-595`: `c-${Date.now().toString(36)}` collides for two pastes within the same millisecond (duplicate ids break selection/raycast/drag-by-id); the `+1` offset is not clamped to `X_RANGE`/`Z_RANGE`, so after ~4 pastes items land outside the canvas — invisible in the SVG, unreachable by canvas drag (recoverable via the NumField, which does clamp).

### M6. 3D drag is unclamped
`previs-3d-viewport.tsx:347` → editor `onMoveItem` (`:655-657`): 3D drag applies raw pointer coordinates without `X_RANGE`/`Z_RANGE` clamping, unlike the 2D canvas drag — items can be dragged far outside the frame.

### M7. Stale raster after undo/redo (by design, worth surfacing)
Snapshots intentionally exclude `previewUrl/depthUrl/edgeUrl` (anti-bloat), so after PREVIS_UNDO the shot keeps previously captured PNGs while blocking/camera change — the center tab shows a stale image until 重新渲染. Acceptable per design; consider clearing the URL fields in `applyPrevisSnapshot` or noting it in the UI.

---

## Verified OK

- **Props-key sync effect cannot fight user edits** (`previs-blocking-editor.tsx:152-161`). Drag flow traced: pointermove → local `setItems` only (no dispatch, propsKey stable) → pointerup → `commitDrag` with `itemsRef.current` → reducer round-trip → propsKey changes → effect calls `setItems(shot.blocking)` with content-identical values → no cursor fight. `RERENDER_PREVIS` (`reducer.ts:602-619`) touches only SVG + assessment, leaving blocking/camera untouched → propsKey stable → no reset. NumField buffer (`:62-95`) is preserved while focused.
- **Undo snapshot content** — `previsSnapshot` captures only `{shotIndex, blocking, camera}` across all shots of the stage; raster/SVG excluded; `applyPrevisSnapshot` re-renders the SVG trio on undo/redo.
- **pushUndo** — JSON dedupe vs top, cap 50 with shift, future cleared on every push; REDO pushes bounded by the undo/redo oscillation (never exceeds 50).
- **Edge capture world positioning** — `buildBoundsEdges` returns the local-space AABB (`Box3.setFromObject` applies the inverse world matrix); positioning with `mesh.position/rotation/scale` in the edge scene reproduces the world transform correctly, including the mannequin Group case. Viewport highlight as a mesh child is likewise correct in local coords.
- **Depth readback math** — `(r + g/255 + b/65025) / 255` matches the RGBADepthPacking unpacking; near-light/far-dark mapping with clamp — correct.
- **Mannequin geometry** — DEG conversion correct; limb pivots at shoulder/hip with segment offset `-len/2`; bodyType height/width/headSize scaling applied; `controls ?? preset ?? stand` fallback chain correct; torso/head rotate about their own centers (stylized, acceptable). `R = (d) => d` is a harmless no-op.
- **Migration** — `migrateAppState` spreads `createInitialState()` (which seeds `previsUndo`) → legacy persisted states get the default `{past: [], future: []}` safely.
- **Reference injection** — `startNextStage` prefers `depthUrl/edgeUrl` PNG over SVG fallback; matches types.
- **Toolchain** — tsc clean, 26/26 vitest pass, `next build` succeeds.
- **Test coverage gap (minor):** no reducer test for the stageId-mismatch guard or the 50-cap eviction; the double-dispatch undo no-op is only observable at the editor level, so no test catches I2/I3 today.

---

## Re-review of fix commit 019fadc

**Checks re-run on 019fadc:** `tsc --noEmit` clean · `vitest run` 26/26 pass · `next build` exit 0.

### Fix verification (all confirmed)

- **I1 FIXED** — `previs-3d-viewport.tsx:268-303`: per-item rig signature (`bodyType|poseId|JSON.stringify(controls)`) compared on every sync; mismatch → `disposeObject(mesh)` + rebuild. JSON key order is stable (spread/slider reassign existing keys), so no spurious rebuilds. Undo/redo now also rebuilds the mannequin correctly (external restore changes controls).
- **I2 FIXED** — `previs-blocking-editor.tsx:163-169`: CAMERA dispatch now `commit: false`; one snapshot (pre-edit state) per logical edit. Traced: BLOCKING pushes `[B0,C0]` (pre-edit), CAMERA applies without push → stack top is the pre-edit state → first 撤销 click is now visibly effective. Dedupe still collapses camera-only commits correctly.
- **I3 FIXED** — `reducer.ts:581-601`: both PREVIS_UNDO and PREVIS_REDO peek the top and return on stageId mismatch before popping — cross-stage history is preserved.
- **M1 FIXED** — highlight moved to a dedicated `hlGroup` (scene-level, `:211-215`), excluded from raycast (only `itemMeshes` are intersected) and hidden (`visible = false`) inside `withCaptureView` and `captureOrbitPreviews`. Highlight world-transform placement (`hl.position/rotation/scale.copy(mesh.*)`) is the same verified-correct pattern as the edge capture.
- **M2 PARTIAL** — `disposeObject` on rebuild and removal (`:269-276`, `:298-305`); depth material disposed in finally (`:453-460`); edge geometry/material disposed (`:490-507`). Residual: `hlGroup.clear()` detaches without disposing (see N4).
- **M3 FIXED** — `withCaptureView` and `captureOrbitPreviews` both restore position/target/aspect in `finally`; rt disposed.
- **M5 FIXED** — paste id salted with 4 random chars; position clamped to `X_RANGE`/`Z_RANGE` (`previs-blocking-editor.tsx:595-607`).
- **M6 FIXED** — 3D drag `onMoveItem` clamped to `X_RANGE`/`Z_RANGE` (`:664-678`).
- **M7 FIXED** — `captured`/`orbits` cleared in the propsKey sync effect (`:157-161`).

### NEW issues introduced/remaining

**N1. IMPORTANT — M4 fix: capture camera never looks at the shot target**
`previs-3d-viewport.tsx:406-431` (`withCaptureView`): camera position, controls.target and aspect are set, but `st.camera.lookAt(...cam.target)` is never called — the camera quaternion keeps the last OrbitControls orientation. `renderer.render` uses position + quaternion, so the capture renders from the shot camera's *position* while pointing in the *orbit* direction.
Failure scenario (default path): seed shot camera is `[0,2,8] → [0,1,0]` (`previs-types.ts:11`); orbit camera starts at `(8,8,10) → (0,1,0)`. Open the fullscreen editor and click 重新渲染 without touching anything → capture is taken from `(0,2,8)` oriented along `(8,8,10)→(0,1,0)` — the shot target `(0,1,0)` is outside the frame. Exported preview/depth/edge PNGs mismatch shot.camera (which video_gen consumes) — the exact problem M4 was meant to fix.
Fix: `st.camera.lookAt(...cam.target)` after positioning; restore is fine as-is (position+target restore + next `controls.update()` re-derives the interactive orientation).

**N2. IMPORTANT — M4 fix: camera gizmo ghost baked into preview/depth exports**
The gizmo sync (`:336-346`) positions `camGizmo` at shot.camera and keeps it `visible = true` unless 从机位看 is on; `withCaptureView` hides only `hlGroup`. Now that capture renders from shot.camera, the 0.5×0.3×0.4 wireframe box sits exactly on the capture camera: its front face at z=0.2 spans 0.5×0.3 while the 45° frustum at that distance is ~0.295×0.166 — the box fills/overframes the whole view. Preview gets a wireframe rectangle across the frame; the depth pass (MeshDepthMaterial) renders a solid near-white slab covering the center. Edge pass unaffected (fresh edgeScene).
Fix: hide `camGizmo` in `withCaptureView` (and restore in finally) alongside `hlGroup`; or remove it from the render via a layer flag.

**N3. MINOR — I2 residual: no-op commits push one redundant snapshot**
`rerender()` always calls `commit(items, camera)` (`previs-blocking-editor.tsx:310`); a bare 重新渲染 click with no changes pushes the current state as a snapshot (pushUndo dedupes only against the stack top, which is the pre-edit state of the last real edit). The first 撤销 click after such a rerender pops an identical state → no visible change. At most one redundant entry per real edit (subsequent no-ops dedupe against it). Fix: in the reducer, skip the push when the post-edit state equals the snapshot.

**N4. MINOR — M2 residual: highlight layer still leaks per rebuild**
`st.hlGroup.clear()` (`:320`) detaches the previous highlight but never disposes its EdgesGeometry/LineBasicMaterial. During a 3D drag of the selected item the highlight effect re-runs every pointermove tick — one small GPU allocation per tick, bounded until viewport unmount. Fix: dispose the removed child (traverse before/after clear).

**N5. MINOR — no new tests for the fixes**
`reducer.test.ts` unchanged: I3's peek-then-pop mismatch path (cross-stage preserve), I2's single-snapshot-per-edit at the editor level, and the capture-view orientation are all untested. A capture-oriented test (or assertion that the captured render includes the shot target) would have caught N1.

### Re-review verdict
All original findings are addressed; **the M4 fix regressed the capture feature** (N1 wrong orientation, N2 gizmo ghost) — the default 重新渲染 path now produces exports that don't match the shot camera, which was M4's entire purpose. N1/N2 must be fixed before this batch is merged.
