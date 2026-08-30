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
  MonitorIcon,
  MoonIcon,
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const { state, dispatch } = useApp()
  const { theme, setTheme } = useTheme()
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
          <DropdownMenuContent align="start" className="w-72 space-y-0.5 p-2">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <div className="flex flex-col gap-1 px-1 py-1.5">
                  <span className="text-sm font-medium text-foreground">{user?.name ?? "创作者"}</span>
                  <span className="text-xs font-normal text-muted-foreground">{user?.email ?? "未登录"}</span>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
              <Settings2Icon /> 系统设置
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <SunIcon /> 切换主题
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent sideOffset={4}>
                <DropdownMenuRadioGroup
                  value={theme}
                  onValueChange={(v) => setTheme(v as "light" | "dark" | "system")}
                >
                  <DropdownMenuRadioItem value="light">
                    <SunIcon /> 浅色
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    <MoonIcon /> 深色
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">
                    <MonitorIcon /> 跟随系统
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
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
