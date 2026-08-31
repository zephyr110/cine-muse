import * as React from "react"

import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"

/** 列表型资源卡基座：统一封面高度、hover 动效与内容区间距 */
function ResourceCard({
  className,
  interactive = false,
  ...props
}: React.ComponentProps<typeof Card> & { interactive?: boolean }) {
  return (
    <Card
      className={cn(
        "group/resource gap-0 py-0",
        interactive &&
          "transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:ring-foreground/15",
        className,
      )}
      {...props}
    />
  )
}

function ResourceCardCover({
  className,
  size = "md",
  children,
  ...props
}: React.ComponentProps<"div"> & { size?: "sm" | "md" | "lg" }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden bg-gradient-to-br",
        size === "lg" ? "h-36" : size === "sm" ? "h-28" : "h-32",
        className,
      )}
      {...props}
    >
      {children}
      {/* 封面底部渐隐，增强与内容区的层次 */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/10 to-transparent"
      />
    </div>
  )
}

function ResourceCardIcon({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex size-10 items-center justify-center rounded-xl bg-background/70 text-foreground backdrop-blur transition-transform duration-300 group-hover/resource:scale-105",
        className,
      )}
    >
      {children}
    </div>
  )
}

function ResourceCardContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-1 flex-col gap-3 p-4", className)}
      {...props}
    />
  )
}

export { ResourceCard, ResourceCardCover, ResourceCardContent, ResourceCardIcon }
