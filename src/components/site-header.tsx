"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { HourglassIcon } from "lucide-react"

import { usePendingApprovals } from "@/lib/store"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const TITLES: { prefix: string; label: string }[] = [
  { prefix: "/dashboard", label: "工作台" },
  { prefix: "/assets", label: "资产库" },
  { prefix: "/knowledge", label: "知识库" },
  { prefix: "/agents", label: "智能体" },
  { prefix: "/projects/new", label: "新建项目" },
  { prefix: "/projects", label: "项目工作区" },
]

function useTitle(): { section: string; page: string } {
  const pathname = usePathname()
  const hit = TITLES.find((t) => pathname.startsWith(t.prefix))
  if (!hit) return { section: "工作台", page: "" }
  if (hit.prefix === "/projects" && !pathname.endsWith("/new")) {
    return { section: "项目", page: "工作区" }
  }
  return { section: hit.label, page: "" }
}

export function SiteHeader() {
  const { section, page } = useTitle()
  const pending = usePendingApprovals()

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-2 px-4 lg:gap-3 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-1 h-4 data-vertical:self-auto" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/dashboard" />}>Cine Studio</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>
                {page ? `${section} · ${page}` : section}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="ml-auto flex items-center gap-1">
          {pending > 0 && (
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="outline" size="sm" nativeButton={false} className="gap-1.5 border-amber-500/50 text-warn" render={<Link href="/dashboard" />} />}
              >
                <HourglassIcon className="size-3.5" />
                <span className="font-medium">{pending} 项待确认</span>
              </TooltipTrigger>
              <TooltipContent>有待确认节点等待你处理</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </header>
  )
}
