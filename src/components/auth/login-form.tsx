"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"

import { useApp } from "@/lib/store"
import { apiJson, setToken } from "@/lib/api"
import { validatePassword } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function LoginForm() {
  const router = useRouter()
  const { state, dispatch, hydrated } = useApp()
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [loading, setLoading] = React.useState(false)

  // 已登录 → 跳转工作台
  React.useEffect(() => {
    if (hydrated && state.user) router.replace("/dashboard")
  }, [hydrated, state.user, router])

  const login = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hydrated || loading) return
    const pwErr = validatePassword(password)
    if (pwErr) {
      toast.error(pwErr)
      return
    }
    setLoading(true)
    try {
      const { token, name } = await apiJson<{ token: string; email: string; name: string }>(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ email: email.trim(), password }),
        },
      )
      setToken(token)
      dispatch({ type: "LOGIN", email: email.trim().toLowerCase(), name })
      toast.success(`欢迎回来，${name}`)
      router.push("/dashboard")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "登录失败，请确认本地服务已启动")
    } finally {
      setLoading(false)
    }
  }

  const demoLogin = async () => {
    if (!hydrated || loading) return
    setLoading(true)
    try {
      const demoEmail = "demo@cine.studio"
      const demoPassword = "demo1234"
      // 首次进入自动注册，已存在则登录
      let res: { token: string; email: string; name: string }
      try {
        res = await apiJson("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email: demoEmail, name: "演示用户", password: demoPassword }),
        })
      } catch {
        res = await apiJson("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: demoEmail, password: demoPassword }),
        })
      }
      setToken(res.token)
      dispatch({ type: "LOGIN", email: res.email, name: res.name })
      toast.success("已进入演示账号")
      router.push("/dashboard")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "演示账号不可用，请检查本地服务")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">登录</h1>
        <p className="text-sm text-muted-foreground">输入账号与密码，继续你的创作</p>
      </div>

      <form onSubmit={login} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="login-email">账号邮箱</Label>
          <Input
            id="login-email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="login-password">密码</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              忘记密码？
            </Link>
          </div>
          <Input
            id="login-password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <LoaderCircleIcon className="size-4 animate-spin" />}
          {loading ? "验证中…" : "登录"}
        </Button>
      </form>


      <Button type="button" variant="outline" className="w-full" disabled={loading} onClick={demoLogin}>
        使用演示账号体验
      </Button>
      <p className="text-center text-[11px] text-muted-foreground">演示账号：demo@cine.studio · 密码 demo1234</p>

      <p className="text-center text-xs text-muted-foreground">
        还没有账号？{" "}
        <Link href="/register" className="font-medium text-foreground underline-offset-2 hover:underline">
          注册
        </Link>
      </p>
    </div>
  )
}
