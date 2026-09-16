import { describe, expect, it } from "vitest"

import { primaryId, pruneSelection, selectOnly, toggleSelection } from "./previs-selection"

describe("selectOnly", () => {
  it("普通点击 → 只有它被选中", () => {
    expect(selectOnly("a")).toEqual(["a"])
  })

  it("点空白 → 清空", () => {
    expect(selectOnly(null)).toEqual([])
  })

  it("从多选里普通点击 → 收敛为单选（多选不该粘住）", () => {
    expect(selectOnly("b")).toEqual(["b"])
  })
})

describe("toggleSelection", () => {
  it("空集加选 → 成为唯一选中", () => {
    expect(toggleSelection([], "a")).toEqual(["a"])
  })

  it("★ 加选第二项 → 追加到末位（成为主选中项）", () => {
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"])
    expect(primaryId(toggleSelection(["a"], "b"))).toBe("b")
  })

  it("★ 再次点击已选中的项 → 移出（Cmd 点击的减选语义）", () => {
    expect(toggleSelection(["a", "b", "c"], "b")).toEqual(["a", "c"])
  })

  it("移出后主选中项顺延到剩余末位", () => {
    expect(primaryId(toggleSelection(["a", "b"], "b"))).toBe("a")
  })

  it("全部移出 → 空集", () => {
    expect(toggleSelection(["a"], "a")).toEqual([])
    expect(primaryId([])).toBeNull()
  })

  it("不改动入参", () => {
    const ids = ["a", "b"]
    toggleSelection(ids, "c")
    expect(ids).toEqual(["a", "b"])
  })
})

describe("pruneSelection", () => {
  it("删除图元后收敛选中集", () => {
    expect(pruneSelection(["a", "b"], ["a"])).toEqual(["a"])
  })

  it("★ 无变化时返回同一引用（供 React 跳过 setState，避免多余重渲染）", () => {
    const ids = ["a", "b"]
    expect(pruneSelection(ids, ["a", "b", "c"])).toBe(ids)
  })

  it("全部失效 → 空集", () => {
    expect(pruneSelection(["a"], [])).toEqual([])
  })

  it("保持插入序", () => {
    expect(pruneSelection(["c", "a", "b"], ["a", "b", "c"])).toEqual(["c", "a", "b"])
  })
})
