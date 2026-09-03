/**
 * 枚举题自由文本归一匹配（聊天式向导用）。
 * 语义：严格命中（alias/label 全等）优先，唯一才返回；否则宽松命中（label 双向包含、
 * searchText 前向包含），唯一才返回；歧义或未命中返回 null —— 枚举字段保持 chips-only，
 * 绝不产生自定义值。
 */

export interface OptionLike<V extends string> {
  value: V
  label: string
  /** 附加可检索文本（如风格描述），仅做前向包含匹配 */
  searchText?: string
  /** 别名（如「竖屏」→ 9:16），全等命中即严格命中 */
  aliases?: readonly string[]
}

export function normalizeOptionText(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ")
}

interface Hit {
  value: string
  strict: boolean
}

export function matchOption<V extends string>(
  text: string,
  options: readonly OptionLike<V>[],
): V | null {
  const n = normalizeOptionText(text)
  if (!n) return null
  const hits: Hit[] = []
  for (const o of options) {
    const normLabel = normalizeOptionText(o.label)
    const strict = o.aliases?.some((a) => normalizeOptionText(a) === n) || normLabel === n
    if (strict) {
      hits.push({ value: o.value, strict: true })
      continue
    }
    const loose =
      normLabel.includes(n) ||
      n.includes(normLabel) ||
      (o.searchText != null && normalizeOptionText(o.searchText).includes(n))
    if (loose) hits.push({ value: o.value, strict: false })
  }
  if (hits.length === 0) return null
  const pool = hits.some((h) => h.strict) ? hits.filter((h) => h.strict) : hits
  const uniq = [...new Set(pool.map((h) => h.value))]
  return uniq.length === 1 ? (uniq[0] as V) : null
}
