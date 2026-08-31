import { AppShell } from "@/components/app-shell"
import { AssetLibrary } from "@/components/assets/asset-library"

export const metadata = {
  title: "资产库 · Cine Muse",
}

export default function AssetsPage() {
  return (
    <AppShell>
      <AssetLibrary />
    </AppShell>
  )
}
