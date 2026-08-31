"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeftIcon, CheckCircle2Icon, LoaderCircleIcon } from "lucide-react"
import { toast } from "@/components/ui/toast"

import { useApp } from "@/lib/store"
import { apiJson } from "@/lib/api"
import { isValidEmail, validatePassword } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function ForgotPasswordForm() {
  const { hydrated } = useApp()
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [step, setStep] = React.useState<"verify" | "reset" | "done">("verify")

  const checkAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hydrated) return
    if (!isValidEmail(email)) {
      toast.add({ title: "请输入有效的邮箱地址", type: "error" })
      return
    }
    try {
      await apiJson("/api/auth/verify-account", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      })
      setStep("reset")
    } catch (err) {
      toast.add({ title: err instanceof Error ? err.message : "验证失败，请确认本地服务已启动", type: "error" })
    }
  }

  const reset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    const pwErr = validatePassword(password)
    if (pwErr) {
      toast.add({ title: pwErr, type: "error" })
      return
    }
    if (password !== confirm) {
      toast.add({ title: "两次输入的密码不一致", type: "error" })
      return
    }
    setLoading(true)
    try {
      await apiJson("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      })
      setStep("done")
    } catch (err) {
      toast.add({ title: err instanceof Error ? err.message : "重置失败，请确认本地服务已启动", type: "error" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/login"
        className="flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        <ArrowLeftIcon className="size-3.5" /> 返回登录
      </Link>

      {step === "verify" && (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">找回密码</h1>
            <p className="text-sm text-muted-foreground">输入注册时的账号邮箱，验证后即可重置密码</p>
          </div>
          <form onSubmit={checkAccount} className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="fp-email">账号邮箱</Label>
              <Input className="h-9"
                id="fp-email"
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" className="h-9 w-full">
              下一步
            </Button>
          </form>
        </>
      )}

      {step === "reset" && (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">设置新密码</h1>
            <p className="text-sm text-muted-foreground">
              演示环境不发送邮件，验证账号后将直接重置 · {email.trim().toLowerCase()}
            </p>
          </div>
          <form onSubmit={reset} className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="fp-password">新密码</Label>
              <Input className="h-9"
                id="fp-password"
                type="password"
                required
                autoComplete="new-password"
                placeholder="至少 6 位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fp-confirm">确认新密码</Label>
              <Input className="h-9"
                id="fp-confirm"
                type="password"
                required
                autoComplete="new-password"
                placeholder="再次输入新密码"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <Button type="submit" className="h-9 w-full" disabled={loading}>
              {loading && <LoaderCircleIcon className="size-4 animate-spin" />}
              {loading ? "重置中…" : "重置密码"}
            </Button>
          </form>
        </>
      )}

      {step === "done" && (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <CheckCircle2Icon className="size-12 text-emerald-500" />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">密码已重置</h1>
            <p className="text-sm text-muted-foreground">请使用新密码重新登录</p>
          </div>
          <Button nativeButton={false} render={<Link href="/login" />}>去登录</Button>
        </div>
      )}
    </div>
  )
}
