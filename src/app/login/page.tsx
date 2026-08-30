import { AuthShell } from "@/components/auth/auth-shell"
import { LoginForm } from "@/components/auth/login-form"

export default function Page() {
  return (
    <AuthShell>
      <LoginForm />
    </AuthShell>
  )
}
