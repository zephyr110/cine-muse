/**
 * previs-selection：画布多选状态机（纯逻辑）。
 *
 * 3D 画布没有天然的线性顺序，故 Shift 与 Cmd/Ctrl 一律按「切换该项」处理（不做区间选择），
 * 与多数 3D 工具一致；区间选择只在有序列表（图层面板）里才有确定含义。
 *
 * 选中集保持**插入序**：末位即「主选中项」，由它驱动 gizmo 与右侧栏的单件面板；
 * 「一键整理」这类批量操作作用于全集。这样单选是退化为长度 1 的特例，不需要两套状态。
 */

/** 普通点击：单选该 id；id 为 null 表示点空白 → 清空 */
export function selectOnly(id: string | null): string[] {
  return id == null ? [] : [id]
}

/**
 * 加选 / 减选（Cmd、Ctrl、Shift 点击）：已在集内则移出，否则追加到末位。
 * 追加到**末位**而非首位，是为了让「刚加选的那个」成为主选中项——用户最后点的那个
 * 才该拿到 gizmo。
 */
export function toggleSelection(ids: readonly string[], id: string): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id)
  return [...ids, id]
}

/** 主选中项 = 选中集末位；空集为 null */
export function primaryId(ids: readonly string[]): string | null {
  return ids.length ? ids[ids.length - 1] : null
}

/** 剔除已不存在的 id（图元被删除后收敛选中集，避免选中集里留下指向空气的墓碑） */
export function pruneSelection(ids: readonly string[], alive: readonly string[]): string[] {
  const ok = new Set(alive)
  const next = ids.filter((id) => ok.has(id))
  // 无变化时返回原引用：调用方（含 React 依赖比较）可据此跳过 setState
  return next.length === ids.length ? (ids as string[]) : next
}
