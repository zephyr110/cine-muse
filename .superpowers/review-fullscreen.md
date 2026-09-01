# Code Review — previs fullscreen editor (commit ae79a00)

Verdict: **Needs fixes**

Findings by severity:

## Critical

### C1. Fullscreen Dialog shell is translated off-screen — base `-translate-x-1/2 -translate-y-1/2` never neutralized
- File: `src/components/projects/previs-fullscreen-editor.tsx:33` (vs. base at `src/components/ui/dialog.tsx:56`)
- The override adds `fixed inset-0 flex ... sm:max-w-none` but nothing cancels the base `-translate-x-1/2 -translate-y-1/2`.
- Verified by simulating `cn()` (twMerge v3.6.0) on the exact base+override class strings: merged output still contains `-translate-x-1/2 -translate-y-1/2` alongside `fixed inset-0`.
- Result: the popup box is 100vw×100vh at inset 0, then translated by −50% of its own size → top-left corner at (−50vw, −50vh). Only the bottom-right quadrant of the dialog is on screen; the header and 退出编辑 button are off-screen entirely. The fullscreen editor is unusable as shipped.
- Note: every *other* conflict resolves correctly via twMerge (verified): `grid`→`flex`, `sm:max-w-sm`→`sm:max-w-none`, `top-1/2/left-1/2`→`inset-0`, `gap-4`→`gap-0`, `p-4`→`p-0`, `rounded-xl`→`rounded-none`, `max-w-[calc(100%-2rem)]`→`max-w-none`, `bg-popover`→`bg-background`. Only the translate classes survive.
- Fix: add `translate-x-0 translate-y-0` (or drop the base dialog classes from the element entirely).

## Important

### I1. Canvas svg never stretches — fullscreen drag math misaligned, map occupies a 480×270 box in the corner
- Files: `src/components/projects/previs-blocking-editor.tsx:210-227` (canvas div `h-full` in fullscreen), svg emitted by `src/lib/engine/previs-render.ts:71` (`<svg width="480" height="270" viewBox="0 0 480 270">`)
- The renderer emits an svg with fixed `width="480" height="270"` and no `preserveAspectRatio="none"`; no CSS (globals.css, preflight, component classes) stretches it. Verified empirically with Playwright: an svg with those attributes inside a 1282×722 container renders at exactly 480×270.
- In fullscreen the canvas div is `h-full` inside a `min-h-0 flex-1` chain, so it is typically ~700–900px tall/wide while the map stays 480×270 in the top-left corner — most of the canvas is empty and the drag math (`worldFromEvent`, lines 114–119, maps pointer linearly across the *full* rect) no longer corresponds to the drawn marker positions: markers move at ~480/width of pointer speed, can't be dragged to visual targets, and the region below the svg is dead. Design point (3) ("canvas stretches and drag math still works via getBoundingClientRect") is not satisfied.
- Same root cause changes the *inline* variant: the canvas div gained `aspect-video` (line 224) where the old div was content-height (=270px exactly), so when the container is wider than 480px the vertical mapping that used to be exact now drifts too (a behavior change in the "unchanged" inline editor).
- Fix: make the svg fill the container (`w-full h-full` + `preserveAspectRatio="none"` via a wrapper class such as `[&_svg]:h-full [&_svg]:w-full`, or set svg attrs to `width="100%" height="100%"` with `preserveAspectRatio="none"`).

## Minor

### M1. Inline variant renders a new items-list header and empty-state text
- `src/components/projects/previs-blocking-editor.tsx:255-295` (rendered at line 387)
- Previously the whole items block was `{draggable.length > 0 && (...)}` with no header; it now always renders with a new header 「布景项（点击选中，方向键微调）」 and an empty-state 「无可拖拽的布景项」. Section order is unchanged, but the inline UI is not byte-identical to before (per the "EXACTLY as before" requirement).

### M2. Selected-marker highlight lost after switching map tabs away and back
- `src/components/projects/previs-blocking-editor.tsx:102-109`
- The `[data-selected]` sync effect depends on `[previewSvg, selected]` only. After switching to depth/edge and back, React re-injects a fresh `previewSvg` (no `data-selected` attrs) while the effect doesn't re-run → the red highlight vanishes until the next select/drag. (Selection state itself persists, so arrow keys still work.)

### M3. Arrow keys still move the selected item while viewing depth/edge tabs
- `src/components/projects/previs-blocking-editor.tsx:216-220` + `onKeyDown` (174-200)
- Design intent says only the preview tab is interactive; `selected` is not cleared when leaving the preview tab, so 方向键 mutates blocking positions with the depth/edge maps displayed (no crash — pointer handlers no-op correctly since depth/edge have no `data-bid`).

### M4. Redundant double portal/overlay
- `src/components/projects/previs-fullscreen-editor.tsx:29-30` — the component wraps `DialogContent` in its own `DialogPortal`+`DialogOverlay`, but `DialogContent` already renders a portal+overlay internally (`src/components/ui/dialog.tsx:51-52`) → two backdrops stacked (bg-black/10 + bg-black/40) and duplicate portals. Harmless visually but unnecessary.

### M5. No accessible dialog title
- `src/components/projects/previs-fullscreen-editor.tsx:38` — the header uses a bare `<h2>`, not `DialogTitle`; base-ui will warn about a missing title and the dialog has no accessible name (`aria-labelledby` absent).

## Verified OK
- tsc --noEmit: clean. `next build`: clean. vitest: 21/21 pass (4 files).
- Escape / backdrop click close the dialog (`onOpenChange={(open) => !open && onClose()}`, base-ui default dismissible); 退出编辑 button calls `onClose` — all three paths work.
- Backdrop covers screen (`DialogOverlay` fixed inset-0 z-50; custom `bg-black/40 backdrop-blur-sm` on top of base `bg-black/10`).
- depth/edge tabs: no `data-bid` markers → pointer handlers no-op, no crash on drag.
- State resets: `key={index}` on `BlockingShotEditor` per shot; `PrevisFullscreenEditor` is conditionally mounted (`{fullscreen && ...}`) so each open remounts with `shotIndex = 0`.
- Shot selector labels `镜头 {i+1}` ≡ old `镜头 {shotIndex+1}` (shots are generated sequentially, `makePrevisShot(i)` in `src/lib/engine/previs-types.ts:8` / `templates.ts:273`).
- Interaction logic unchanged in code: drag/select/arrow keys/NumField/dispatch sequence identical; no unused imports or dead code in the changed files.
- The inline h-full/min-h-0 chains from DialogContent → body → grid → canvas are sound once C1 is fixed (grid `h-full` inside `min-h-0 flex-1 p-4`, columns `min-h-0 overflow-y-auto`, center canvas wrapper `flex-1 min-h-0`).
