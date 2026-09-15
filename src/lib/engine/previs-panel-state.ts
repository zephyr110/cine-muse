/**
 * 全屏编辑器右侧栏的分区状态（纯逻辑）。
 * 侧栏 UI 无组件测试环境（vitest 为 node 环境、未装 jsdom/testing-library），
 * 故把状态机与适用性判定收在此处单测；JSX 只做渲染。
 */

/** 分区 id，顺序即侧栏渲染顺序（spec §3.1） */
export const SIDEBAR_SECTIONS = ["camera", "items", "pose", "transform"] as const
export type SidebarSection = (typeof SIDEBAR_SECTIONS)[number]

/** 展开态侧栏宽度（px）——参与渲染，勿另写工具类以免漂移 */
export const SIDEBAR_WIDTH_PX = 300
/** 收起态图标条宽度（px） */
export const SIDEBAR_RAIL_WIDTH_PX = 44

/** 默认展开的分区：两块恒在的常用面板 */
export const DEFAULT_OPEN_SECTIONS: ReadonlySet<SidebarSection> = new Set(["camera", "items"])

/** 结构类型而非 BlockingItem：纯模块不耦合应用类型；kind 实际含 character/prop/terrain */
export type PanelSelection = { kind: string } | null

/** 当前选择下适用的分区：机位/布景项恒在；角色姿态仅角色；变换仅任意选中项 */
export function applicableSections(item: PanelSelection): SidebarSection[] {
  return SIDEBAR_SECTIONS.filter((id) => {
    if (id === "camera" || id === "items") return true
    if (id === "pose") return item?.kind === "character"
    return item != null
  })
}

/** 选择变化时应自动展开的分区 = 适用分区中非默认展开的那些 */
export function sectionsForSelection(item: PanelSelection): SidebarSection[] {
  return applicableSections(item).filter((id) => !DEFAULT_OPEN_SECTIONS.has(id))
}

/** 切换分区开合；返回新 Set，不改动入参 */
export function toggleSection(
  open: ReadonlySet<SidebarSection>,
  id: SidebarSection,
): Set<SidebarSection> {
  const next = new Set(open)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** 确保分区展开；已展开时返回等值的新 Set（调用方可无条件 setState） */
export function openSection(
  open: ReadonlySet<SidebarSection>,
  id: SidebarSection,
): Set<SidebarSection> {
  const next = new Set(open)
  next.add(id)
  return next
}
