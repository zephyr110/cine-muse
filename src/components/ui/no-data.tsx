import * as React from "react"
import { InboxIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/** 空数据占位：默认 inbox 图标 + 「暂无数据」；加载等场景可传自定义 icon / text */
export function NoData({
  icon,
  text = "暂无数据",
  className,
}: {
  icon?: React.ReactNode
  text?: string
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-12 text-center", className)}>
      {icon ?? <InboxIcon className="size-6 text-muted-foreground/40" />}
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  )
}
