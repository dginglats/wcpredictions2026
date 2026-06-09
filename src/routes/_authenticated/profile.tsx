import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { useAuth } from "@/lib/auth"
import { supabase } from "@/integrations/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CARS } from "@/lib/scoring"
import { toast } from "sonner"
import { Crown } from "lucide-react"

export const Route = createFileRoute("/_authenticated/profile")({ component: ProfilePage })

function ProfilePage() {
  const { user, profile, isAdmin, refreshProfile } = useAuth()
  const [username, setUsername] = useState("")
  const [car, setCar] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (profile) { setUsername(profile.username); setCar(profile.car ?? "") } }, [profile])

  async function save() {
    if (!user) return
    setBusy(true)
    const { error } = await supabase.from("profiles").update({ username, car: car || null }).eq("id", user.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success("Профиль обновлён"); refreshProfile()
  }

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-3xl font-bold">Профиль</h1>
      <div className="rounded-xl border border-border bg-card p-6 shadow-card space-y-4">
        <div className="flex items-center gap-4">
          <div className="size-16 rounded-full bg-gradient-to-br from-pitch to-primary grid place-items-center text-2xl font-bold">
            {profile?.username?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div>
            <div className="font-semibold flex items-center gap-1">{profile?.username}{isAdmin && <Crown className="size-4 text-gold" />}</div>
            <div className="text-sm text-muted-foreground">{profile?.email}</div>
            {isAdmin && <div className="text-xs text-gold mt-1">Администратор</div>}
          </div>
        </div>
        <div><Label>Имя пользователя</Label><Input value={username} onChange={e=>setUsername(e.target.value)} /></div>
        <div><Label>Машина</Label>
          <select value={car} onChange={e=>setCar(e.target.value)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">— не выбрана —</option>
            {CARS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <Button onClick={save} disabled={busy}>Сохранить</Button>
      </div>
    </div>
  )
}
