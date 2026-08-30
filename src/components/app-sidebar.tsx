"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  BotIcon,
  CirclePlusIcon,
  ClapperboardIcon,
  LayoutDashboardIcon,
  FolderOpenIcon,
  LogOutIcon,
  NotebookIcon,
  Settings2Icon,
  SunIcon,
} from "lucide-react"

import { useApp } from "@/lib/store"
import { logout } from "@/lib/auth"
import { useTheme } from "@/lib/theme"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { SettingsDialog } from "@/components/settings/settings-dialog"

const NAV = [
  { group: "工作区", items: [
    { title: "工作台", url: "/dashboard", icon: <LayoutDashboardIcon /> },
    { title: "资产库", url: "/assets", icon: <FolderOpenIcon />, desc: "角色/场景/道具/风格素材" },
    { title: "知识库", url: "/knowledge", icon: <NotebookIcon />, desc: "RAG 知识库管理" },
    { title: "智能体", url: "/agents", icon: <BotIcon />, desc: "专业 Sub-Agent 目录" },
  ]},
]

const THEME_OPTIONS = [
  { value: "light", label: "浅色" },
  { value: "system", label: "系统" },
  { value: "dark", label: "深色" },
] as const

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const { state, dispatch } = useApp()
  const { theme, setTheme } = useTheme()
  const themeIndex = Math.max(0, THEME_OPTIONS.findIndex((t) => t.value === theme))
  const router = useRouter()
  const user = state.user
  const [settingsOpen, setSettingsOpen] = React.useState(false)

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="data-[slot=sidebar-menu-button]:p-1.5!" render={<Link href="/dashboard" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ClapperboardIcon className="size-5" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="text-base font-semibold">Cine Studio</span>
                <span className="truncate text-xs text-muted-foreground">AI 视频生产工作台</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarGroup className="pt-2">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="新建项目"
                  className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  render={<Link href="/projects/new" />}
                >
                  <CirclePlusIcon />
                  <span>新建项目</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarHeader>

      <SidebarContent>
        {NAV.map((section) => (
          <SidebarGroup key={section.group}>
            <SidebarGroupLabel>{section.group}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      tooltip={item.desc}
                      isActive={pathname === item.url}
                      render={<Link href={item.url} />}
                    >
                      {item.icon}
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" className="mt-2 h-auto w-full justify-start gap-2.5 px-3 py-2.5" />}
          >
            <Avatar className="size-6 rounded-full">
              <AvatarFallback className="rounded-full bg-primary/10 text-xs text-primary">
                {(user?.name.trim()[0] ?? "U").toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user?.name ?? "创作者工作台"}</span>
              <span className="truncate text-xs text-muted-foreground">{user?.email ?? "未登录"}</span>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80 space-y-0.5 p-2.5">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <div className="flex flex-col gap-1 px-1 py-1.5">
                  <span className="text-sm font-medium text-foreground">{user?.name ?? "创作者"}</span>
                  <span className="text-xs font-normal text-muted-foreground">{user?.email ?? "未登录"}</span>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {/* 主题切换：三段式滑块按钮（浅色 | 系统 | 深色） */}
            <div className="flex items-center justify-between gap-3 px-2.5 py-2">
              <span className="flex items-center gap-2 text-sm">
                <SunIcon className="size-4 text-muted-foreground" />
                主题切换
              </span>
              <div className="relative grid h-8 w-40 shrink-0 grid-cols-3 rounded-lg bg-muted p-1">
                <span
                  aria-hidden
                  className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-md bg-background shadow-sm transition-transform duration-200 ease-out"
                  style={{ transform: `translateX(${themeIndex * 100}%)` }}
                />
                {THEME_OPTIONS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTheme(t.value)}
                    className={`relative z-10 rounded-md text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                      theme === t.value ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <DropdownMenuItem className="py-2" onClick={() => setSettingsOpen(true)}>
              <Settings2Icon /> 系统设置
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="py-2"
              onClick={async () => {
                await logout()
                dispatch({ type: "LOGOUT" })
                router.push("/login")
              }}
            >
              <LogOutIcon className="size-4" /> 退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
      <SidebarRail />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </Sidebar>
  )
}
