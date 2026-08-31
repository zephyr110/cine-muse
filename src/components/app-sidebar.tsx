"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  BotIcon,
  ChevronRightIcon,
  CirclePlusIcon,
  LayoutDashboardIcon,
  FolderOpenIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  NotebookIcon,
  Settings2Icon,
  SunIcon,
  type LucideIcon,
} from "lucide-react"

import brandLogo from "@/app/icon.png"

import { useApp } from "@/lib/store"
import { logout } from "@/lib/auth"
import { useTheme, type Theme } from "@/lib/theme"
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
  useSidebar,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
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

const THEME_OPTIONS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "浅色", icon: SunIcon },
  { value: "system", label: "系统", icon: MonitorIcon },
  { value: "dark", label: "深色", icon: MoonIcon },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const { state, dispatch } = useApp()
  const { theme, setTheme } = useTheme()
  const { isMobile } = useSidebar()
  const router = useRouter()
  const user = state.user
  const [settingsOpen, setSettingsOpen] = React.useState(false)

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="data-[slot=sidebar-menu-button]:p-1.5!" render={<Link href="/dashboard" />}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={brandLogo.src} alt="Cine Muse" className="size-8 shrink-0" />
              <div className="grid flex-1 text-left leading-tight">
                <span className="text-base font-semibold">Cine Muse</span>
                <span className="truncate text-xs text-muted-foreground">AI 视频生产工作台</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarGroup className="pt-3">
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
          <SidebarGroup key={section.group} className="pt-1">
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
            render={
              <Button
                variant="ghost"
                className="group mt-2 h-auto w-full justify-start gap-2.5 rounded-lg px-2.5 py-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              />
            }
          >
            <Avatar className="size-8 shrink-0 rounded-full">
              <AvatarFallback className="rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
                {(user?.name.trim()[0] ?? "U").toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 text-left leading-tight">
              <p className="truncate text-sm font-medium">{user?.name ?? "创作者工作台"}</p>
            </div>
            <ChevronRightIcon className="size-3.5 shrink-0 text-sidebar-foreground/70 transition-transform duration-200 group-data-open:rotate-90" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? "top" : "right"}
            align={isMobile ? "center" : "start"}
            sideOffset={8}
            className="w-64 p-2"
          >
            {/* 用户信息卡：头像 + 名称 + 邮箱 */}
            <div className="rounded-lg bg-muted/50 px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <Avatar className="size-10 shrink-0">
                  <AvatarFallback className="bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
                    {(user?.name.trim()[0] ?? "U").toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 leading-snug">
                  <p className="truncate text-sm font-semibold">{user?.name ?? "创作者"}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{user?.email ?? "未登录"}</p>
                </div>
              </div>
            </div>

            <DropdownMenuSeparator className="mx-0 my-2" />

            {/* 主题切换：三段式分段控件（浅色 | 系统 | 深色） */}
            <div className="flex flex-col gap-3 px-0.5">
              <div className="flex flex-col gap-1.5">
                <p className="px-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  主题
                </p>
                <div className="inline-flex w-full rounded-lg bg-muted/50 p-1">
                  {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setTheme(value)}
                      aria-pressed={theme === value}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-all duration-200",
                        theme === value
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <Icon className="size-3.5" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <DropdownMenuSeparator className="mx-0 my-2" />

            <div className="flex flex-col gap-0.5">
              <DropdownMenuItem
                className="cursor-pointer gap-2.5 rounded-md px-2.5 py-2"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings2Icon className="size-4 shrink-0 opacity-60" /> 系统设置
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer gap-2.5 rounded-md px-2.5 py-2 text-destructive focus:text-destructive"
                onClick={async () => {
                  await logout()
                  dispatch({ type: "LOGOUT" })
                  router.push("/login")
                }}
              >
                <LogOutIcon className="size-4 shrink-0 opacity-60" /> 退出登录
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
      <SidebarRail />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </Sidebar>
  )
}
