import { createFileRoute, useRouter } from "@tanstack/react-router"
import { useState } from "react"
import { supabase } from "@/integrations/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"

export const Route = createFileRoute("/reset-password")({ component: ResetPage })

function ResetPage() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success("Пароль обновлён"); router.navigate({ to: "/schedule" })
  }
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 bg-card border border-border rounded-xl p-6 shadow-card">
        <h1 className="text-xl font-bold">Новый пароль</h1>
        <div className="space-y-2"><Label>Пароль</Label><Input type="password" required minLength={6} value={password} onChange={e=>setPassword(e.target.value)} /></div>
        <Button className="w-full" disabled={busy}>Сохранить</Button>
      </form>
    </div>
  )
}
