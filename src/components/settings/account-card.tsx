"use client"

import * as React from "react"
import { KeyRoundIcon, LoaderCircleIcon, ShieldCheckIcon } from "lucide-react"
import { toast } from "@/components/ui/toast"

import { useApp } from "@/lib/store"
import { apiJson } from "@/lib/api"
import { validatePassword } from "@/lib/auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/** 登录账号信息 + 修改密码（本地演示认证）；embedded 用于抽屉内单列表单 */
export function AccountCard() {
  const { state } = useApp()
  const user = state.user
  const [oldPassword, setOldPassword] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [loading, setLoading] = React.useState(false)

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    if (!user) {
      toast.add({ title: "请先登录", type: "error" })
      return
    }
    const pwErr = validatePassword(password)
    if (pwErr) {
      toast.add({ title: pwErr, type: "error" })
      return
    }
    if (password !== confirm) {
      toast.add({ title: "两次输入的新密码不一致", type: "error" })
      return
    }
    setLoading(true)
    try {
      await apiJson("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ oldPassword, newPassword: password }),
      })
      setOldPassword("")
      setPassword("")
      setConfirm("")
      toast.add({ title: "密码已更新", type: "success" })
    } catch (err) {
      toast.add({ title: err instanceof TypeError ? "修改失败，请确认本地服务已启动" : err instanceof Error ? err.message : "修改失败", type: "error" })
    } finally {
      setLoading(false)
    }
  }

  const initials = user ? (user.name.trim()[0] ?? "U").toUpperCase() : "U"

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
            {initials}
          </div>
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              {user?.name}
              <Badge variant="outline" className="gap-1 text-[11px] status-done">
                <ShieldCheckIcon className="size-3" /> 本地账号
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">{user?.email ?? "未登录"}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={changePassword} className="grid gap-4 sm:grid-cols-2 sm:items-end">
          <div className="flex flex-col gap-2">
            <Label htmlFor="acc-old">当前密码</Label>
            <Input
              id="acc-old"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="acc-new">新密码</Label>
            <Input
              id="acc-new"
              type="password"
              required
              autoComplete="new-password"
              placeholder="至少 6 位"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="acc-confirm">确认新密码</Label>
            <Input
              id="acc-confirm"
              type="password"
              required
              autoComplete="new-password"
              placeholder="再次输入"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? <LoaderCircleIcon className="size-4 animate-spin" /> : <KeyRoundIcon className="size-4" />}
            修改密码
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
