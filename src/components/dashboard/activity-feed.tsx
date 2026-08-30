"use client"

import * as React from "react"
import Link from "next/link"
import { ActivityIcon } from "lucide-react"

import { useApp } from "@/lib/store"
import { timeAgo } from "@/lib/format"
import { EVENT_META } from "@/lib/meta"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function ActivityFeed() {
  const { state } = useApp()
  const events = state.events.slice(0, 6)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ActivityIcon className="size-4 text-muted-foreground" />
          最近活动
        </CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">暂无活动，创建项目后引擎事件将在这里汇总</p>
        ) : (
          <div className="relative">
            {/* 时间轴竖线：底部渐变淡出（ol 外，避免 ol 直接子元素非 li） */}
            <span
              aria-hidden
              className="absolute bottom-2 left-[11px] top-2 w-px bg-gradient-to-b from-border via-border to-transparent"
            />
            <ol>
              {events.map((ev) => {
                const meta = EVENT_META[ev.kind]
                return (
                  <li key={ev.id} className="relative pl-9 pb-3.5 last:pb-0">
                    {/* 事件节点：类型图标 + 配色 + ring 与线分离 */}
                    <span
                      className={`absolute left-0 top-0 flex size-6 items-center justify-center rounded-full text-white shadow-sm ring-4 ring-card ${meta.color}`}
                    >
                      {meta.icon}
                    </span>
                    <div className="-mx-2 flex items-start justify-between gap-3 rounded-md px-2 py-1 transition-colors hover:bg-muted/50">
                      <div className="min-w-0">
                        <p className="text-xs leading-relaxed text-foreground/90">{ev.text}</p>
                        <Link
                          href={`/projects?id=${ev.projectId}`}
                          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                        >
                          《{ev.projectTitle}》
                        </Link>
                      </div>
                      <span className="shrink-0 whitespace-nowrap pt-0.5 text-[11px] tabular-nums text-muted-foreground">
                        {timeAgo(ev.at)}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
