# Stage Detail Drawer 左右 Padding 设计

日期：2026-08-31
状态：已确认（方案 A）

## 背景

`src/components/projects/stage-detail-drawer.tsx` 的抽屉内容区缺少合理的水平留白：

- 滚动正文（Tabs + 各面板）水平 padding 为 0，内容贴边
- 吸顶头部 `px-4`（16px）与正文 0px 不一致，滚动时视觉断裂
- 吸底审批栏 `px-1`（4px）+ `pb-1`，与头部严重不一致
- 头部与 Tabs 间距被 `gap-4` + `mt-4` 叠加为 32px，垂直节奏异常
- 内容底部无 padding，长内容末端紧贴吸底栏/抽屉底边

应用内约定：页面容器统一 `p-6`（24px）。抽屉为 max-w-3xl 大面板，采用同一 gutter。

## 设计（方案 A：通栏分隔线 + 内嵌内容）

1. **正文包裹层**：`<StageTabs>` 外包 `<div className="px-6 pb-8">` — 正文 24px gutter，底部 32px 呼吸空间（避免内容紧贴吸底栏）
2. **吸顶头部**：`px-4` → `px-6`（其余 `pt-4 pb-3 pr-12` 不变，`pr-12` 保留关闭按钮空间）
3. **Tabs 间距**：去掉 `<Tabs className="mt-4">` 的 `mt-4` — 父级 `gap-4` 已提供 16px，消除 32px 叠加
4. **吸底审批栏**：`px-1 pt-3 pb-1` → `px-6 pt-3 pb-3` — 与头部同 gutter，垂直对称 12px

`SheetContent` 保持边缘到边缘（无 padding）：头部 `border-b`、审批栏 `border-t` 保留全宽分隔线。

## 验收标准

- 正文、头部、审批栏左缘对齐（24px gutter）
- 头部与 Tabs 间距 16px（不再叠加）
- 分隔线（header border-b / 审批栏 border-t）保持全宽
- 长内容滚动到底时与吸底栏保持 32px 间距
- `pnpm exec tsc --noEmit` 通过

## 范围外

- 不修改 Sheet/SheetContent 基元（其他调用方不受影响）
- 不调整内部卡片/图表自身的内边距
