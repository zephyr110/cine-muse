import { AppShell } from "@/components/app-shell"
import { NewProjectWizard } from "@/components/projects/new-project-wizard"

export default function Page() {
  return (
    <AppShell>
      <NewProjectWizard />
    </AppShell>
  )
}
