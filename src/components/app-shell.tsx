"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { useApp } from "@/lib/store"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

/** 受保护页面布局：未登录统一重定向到登录页（水合前不渲染，避免内容闪现） */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { state, hydrated } = useApp()
  const router = useRouter()

  React.useEffect(() => {
    if (hydrated && !state.user) router.replace("/login")
  }, [hydrated, state.user, router])

  if (!hydrated || !state.user) return null

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
