import { describe, expect, it } from "vitest"
import { matchOption, normalizeOptionText } from "./option-match"
import type { OptionLike } from "./option-match"

const ASPECT: OptionLike<"16:9" | "9:16" | "1:1">[] = [
  { value: "16:9", label: "16:9", aliases: ["横屏", "横向", "16比9", "169"] },
  { value: "9:16", label: "9:16", aliases: ["竖屏", "竖向", "9比16", "916"] },
  { value: "1:1", label: "1:1", aliases: ["方形", "正方形", "1比1"] },
]

const DURATION: OptionLike<"30" | "60" | "120" | "180" | "240">[] = [
  { value: "30", label: "0.5 分钟", aliases: ["30秒", "半分钟", "30s"] },
  { value: "60", label: "1 分钟", aliases: ["1分钟", "一分钟", "1分", "1min", "60秒", "60s"] },
  { value: "120", label: "2 分钟", aliases: ["2分钟", "两分钟", "2分", "2min", "120秒"] },
  { value: "180", label: "3 分钟", aliases: ["3分钟", "三分钟", "3分", "180秒"] },
  { value: "240", label: "4 分钟", aliases: ["4分钟", "四分钟", "4分", "240秒"] },
]

const QUALITY: OptionLike<"draft" | "standard" | "hd">[] = [
  { value: "draft", label: "草稿 (720p)", aliases: ["草稿", "720", "720p", "低清"] },
  { value: "standard", label: "标准 (1080p)", aliases: ["标准", "1080", "1080p", "标清"] },
  { value: "hd", label: "高清 (4K)", aliases: ["高清", "4k", "超清"] },
]

const GENRE: OptionLike<string>[] = [
  { value: "科幻", label: "科幻", searchText: "硬核科幻与人文关怀交织" },
  { value: "悬疑", label: "悬疑", searchText: "层层递进的谜团与反转" },
  { value: "古风", label: "古风", searchText: "水墨质感、低饱和青灰、对称构图" },
]

const STYLE: OptionLike<string>[] = [
  { value: "赛博朋克", label: "赛博朋克", searchText: "霓虹蓝紫高对比、雨夜反光、复古未来主义" },
  { value: "赛博国风", label: "赛博国风", searchText: "霓虹 + 水墨融合、青金配色" },
  { value: "黑色电影", label: "黑色电影", searchText: "低照度硬光、阴影切割、冷峻色调" },
]

const MODE: OptionLike<string>[] = [
  { value: "auto", label: "全自动", aliases: ["自动", "零打断"] },
  { value: "guided", label: "引导式", aliases: ["引导", "前置干预"] },
  { value: "review", label: "审查式", aliases: ["审查", "人工确认"] },
  { value: "manual", label: "手作式", aliases: ["手动", "全程介入"] },
]

describe("normalizeOptionText", () => {
  it("trim + 小写 + 折叠空白", () => {
    expect(normalizeOptionText("  4K  ")).toBe("4k")
    expect(normalizeOptionText("  2 分钟 ")).toBe("2 分钟")
    expect(normalizeOptionText("")).toBe("")
  })
})

describe("matchOption", () => {
  it("alias 全等命中（竖屏→9:16）", () => {
    expect(matchOption("竖屏", ASPECT)).toBe("9:16")
    expect(matchOption("169", ASPECT)).toBe("16:9")
  })

  it("时长自然语言命中", () => {
    expect(matchOption("两分钟", DURATION)).toBe("120")
    expect(matchOption("2min", DURATION)).toBe("120")
    expect(matchOption("3 分钟", DURATION)).toBe("180") // label 全等
    expect(matchOption("3分钟", DURATION)).toBe("180") // 双向包含（"3 分钟" 归一后空白折叠为单空格，仍靠 alias）
  })

  it("画质别名（4k→hd）", () => {
    expect(matchOption("4K", QUALITY)).toBe("hd")
    expect(matchOption("1080", QUALITY)).toBe("standard")
  })

  it("label 全等与 searchText 前向包含", () => {
    expect(matchOption("科幻", GENRE)).toBe("科幻")
    expect(matchOption("水墨", GENRE)).toBe("古风") // 古风 searchText 含「水墨」，唯一
  })

  it("歧义返回 null（赛博朋克/赛博国风都含「赛博」）", () => {
    expect(matchOption("赛博", STYLE)).toBeNull()
    expect(matchOption("电影", STYLE)).toBe("黑色电影") // 唯一含「电影」
  })

  it("空串与未命中返回 null", () => {
    expect(matchOption("", ASPECT)).toBeNull()
    expect(matchOption("   ", ASPECT)).toBeNull()
    expect(matchOption("量子史诗", GENRE)).toBeNull()
  })
})
