import { AuthShell } from "@/components/auth/auth-shell"
import { RegisterForm } from "@/components/auth/register-form"

export default function Page() {
  return (
    <AuthShell>
      <RegisterForm />
    </AuthShell>
  )
}
