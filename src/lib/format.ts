/** 将 ISO 时间转为中文相对时间（"刚刚 / N 分钟前 / N 小时前 / N 天前"）；非法时间返回 "刚刚" */
export function timeAgo(iso: string): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return "刚刚"
  const diff = Date.now() - ts
  if (diff < 60_000) return "刚刚"
  const mins = Math.round(diff / 60000)
  if (mins < 60) return `${mins} 分钟前`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} 小时前`
  return `${Math.round(hrs / 24)} 天前`
}

/** 时长（秒）→ "N 分钟"（统一分钟展示口径，避免各处重复 Math.round） */
export function formatMinutes(durationSec: number): string {
  return `${Math.round(durationSec / 60)} 分钟`
}
