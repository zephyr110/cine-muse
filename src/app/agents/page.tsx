import { AppShell } from "@/components/app-shell"
import { AgentDirectory } from "@/components/agents/agent-directory"

export default function Page() {
  return (
    <AppShell>
      <AgentDirectory />
    </AppShell>
  )
}
