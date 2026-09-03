# Code Review — previs fullscreen editor (commit ae79a00 + fix commit 1b1e6c8)

Verdict: **Approved** (all prior findings C1/I1/M1–M5 fixed and verified; two Minor notes below)

## Re-review of fix commit 1b1e6c8 — verification results

### C1 — FIXED, verified
`previs-fullscreen-editor.tsx:33` now includes `translate-x-0 translate-y-0`. Simulated `cn()`/twMerge on base + override: merged string contains `fixed inset-0 ... translate-x-0 translate-y-0 ... sm:max-w-none` and no negative translate remains. Popup fills the viewport with no offset.

### I1 — FIXED for all standard windows (Minor edge case below)
- `previs-blocking-editor.tsx:213` adds `id="previs-canvas"`; `styleEl` (line 357) adds `#previs-canvas svg{width:100%!important;height:100%!important;display:block}`. Verified empirically in a real browser: the injected svg now fills its container box exactly (svg rect == box rect in both tested sizes).
- Canvas box is `aspect-video w-full max-w-full` (+`max-h-full` in fullscreen) centered in `flex min-h-0 flex-1 items-center justify-center overflow-hidden` (line 371-373). When the 16:9 ratio holds, `worldFromEvent` (linear rect→480×270) is exact — pointer↔marker correspondence confirmed by geometry.
- (a) **Inline variant vs pre-refactor**: sections, order, wrapper card, hint text, and the items block (conditional again, header/empty-state fullscreen-only — M1 fixed) are byte-identical. The only remaining deltas are deliberate: the canvas now renders as a full-width 16:9 box with the map uniformly stretched to fill it (content proportions identical to the old natural-size 480×270 map; previously the map sat 480×270 in a content-height strip with empty space right of it) — and this makes the inline drag mapping exact, which it was not before when the container differed from 480px wide. No behavior drift.
- (b) **Fullscreen box stays 16:9** for standard desktop windows (1440×900: box ≈868×488 of ≈772 available → exact; 1920×1080, 1366×768, 1280×800 likewise) → mapping exact. Edge case below.

### M1–M5 — FIXED, verified
- M1: items header + empty-state text gated to `variant === "fullscreen"` (lines 258-260, 294-295); inline restores the original conditional block.
- M2: `mapTab` added to the highlight-sync effect deps (line 109) — returning from depth/edge to preview re-runs and restores `data-selected`.
- M3: `onKeyDown` gated on `mapTab === "preview"` (line 175).
- M4: duplicated `DialogPortal`/`DialogOverlay` removed; `DialogContent`'s internal portal+overlay used (imports cleaned).
- M5: `<h2>` → `DialogTitle` (accessible name; base-ui title warning gone).

### Checks
- tsc --noEmit: clean. `next build`: clean. vitest: 21/21 pass.
- Fullscreen min-h-0 chain intact: DialogContent flex-col → header shrink-0 → body `min-h-0 flex-1 p-4` → grid `h-full min-h-0` → columns `min-h-0 overflow-y-auto` / canvas wrapper `flex-1 min-h-0 overflow-hidden`.
- Escape, backdrop click, and 退出编辑 all close; depth/edge tabs remain non-interactive (no `data-bid` → pointer handlers no-op); state resets per shot (`key={index}`) and per reopen (conditional mount + `shotIndex` state).

## New issues (Minor)

### N1. Fullscreen canvas ratio breaks on ultrawide / wide-short windows → horizontal drag offset
- `previs-blocking-editor.tsx:223-225` — `max-h-full` clamps the box height when available height < width×9/16 (center column ≈ vw−572, available height ≈ vh−128). Verified in a browser: with a wide+short wrapper the box stays full-width and height-clamped (e.g., 1432×470, ratio 3.05), so the svg meet-letterboxes horizontally and `worldFromEvent` drifts up to ≈±1 world unit at the left/right edges (vertical axis stays exact). Triggered by e.g. 2560×1080 (1118px needed vs 952px available) and 1920×800 windows; unaffected on standard 16:9 desktops.
- Bulletproof fix: add `preserveAspectRatio="none"` to the injected svg (`previs-render.ts` width/height attrs), which keeps pointer↔marker mapping exact for any box shape.

### N2. Fullscreen backdrop lost its tint/blur (M4 collateral)
- `previs-fullscreen-editor.tsx` — the custom `bg-black/40 backdrop-blur-sm` overlay was removed with the duplicated portal; the dialog now uses the base `bg-black/10` backdrop from `dialog.tsx:34`. Backdrop still covers the screen, but the dimming is much lighter than the design intent (blur dropped). Cosmetically minor; customizing would require a `DialogOverlay` passthrough on `DialogContent`.
