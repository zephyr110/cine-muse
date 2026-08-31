"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"

import { useApp } from "@/lib/store"
import { apiJson, setToken } from "@/lib/api"
import { isValidEmail, validatePassword } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function RegisterForm() {
  const router = useRouter()
  const { state, dispatch, hydrated } = useApp()
  const [name, setName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (hydrated && state.user) router.replace("/dashboard")
  }, [hydrated, state.user, router])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hydrated || loading) return
    const em = email.trim().toLowerCase()
    if (!isValidEmail(em)) {
      toast.error("请输入有效的邮箱地址")
      return
    }
    const pwErr = validatePassword(password)
    if (pwErr) {
      toast.error(pwErr)
      return
    }
    if (password !== confirm) {
      toast.error("两次输入的密码不一致")
      return
    }
    setLoading(true)
    try {
      const { token, name: serverName } = await apiJson<{
        token: string
        email: string
        name: string
      }>(
        "/api/auth/register",
        {
          method: "POST",
          body: JSON.stringify({
            email: em,
            name: name.trim() || em.split("@")[0],
            password,
          }),
        },
      )
      setToken(token)
      dispatch({ type: "LOGIN", email: em, name: serverName })
      toast.success("注册成功，欢迎加入 Cine Muse")
      router.push("/dashboard")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "注册失败，请确认本地服务已启动")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">创建账号</h1>
        <p className="text-sm text-muted-foreground">注册后即可创建项目并管理你的创作流程</p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="reg-name">昵称（可选）</Label>
          <Input
            id="reg-name"
            placeholder="将展示在工作台与资产页"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="reg-email">账号邮箱</Label>
          <Input
            id="reg-email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="reg-password">密码</Label>
          <Input
            id="reg-password"
            type="password"
            required
            autoComplete="new-password"
            placeholder="至少 6 位"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="reg-confirm">确认密码</Label>
          <Input
            id="reg-confirm"
            type="password"
            required
            autoComplete="new-password"
            placeholder="再次输入密码"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <LoaderCircleIcon className="size-4 animate-spin" />}
          {loading ? "注册中…" : "注册并登录"}
        </Button>
      </form>


      <p className="text-center text-xs text-muted-foreground">
        已有账号？{" "}
        <Link href="/login" className="font-medium text-foreground underline-offset-2 hover:underline">
          去登录
        </Link>
      </p>
    </div>
  )
}
