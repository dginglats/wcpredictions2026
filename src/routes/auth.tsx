import { createFileRoute, useRouter } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { supabase } from "@/integrations/supabase/client"
import { useAuth, DEMO_KEY } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Trophy } from "lucide-react"
import { toast } from "sonner"
import { CARS } from "@/lib/scoring"

export const Route = createFileRoute("/auth")({ component: AuthPage })

function AuthPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [username, setUsername] = useState("")
  const [car, setCar] = useState<string>(CARS[0])
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (!loading && user) router.navigate({ to: "/schedule" }) }, [user, loading, router])

  async function onLogin(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success("Вход выполнен"); router.navigate({ to: "/schedule" })
  }
  async function onSignup(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth`,
        data: { username, car },
      },
    })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success("Аккаунт создан. Можно войти.")
    setMode("login")
  }
  async function onReset(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success("Письмо отправлено")
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-hero relative overflow-hidden">
        <div className="absolute inset-0 pitch-lines opacity-30" />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="size-12 rounded-full bg-gradient-to-br from-gold to-primary grid place-items-center shadow-glow">
              <Trophy className="size-6 text-primary-foreground" />
            </div>
            <div>
              <div className="text-2xl font-bold">ЧМ-2026</div>
              <div className="text-xs uppercase tracking-widest text-gold">World Cup Predictor</div>
            </div>
          </div>
        </div>
        <div className="relative space-y-4 max-w-md">
          <h1 className="text-5xl font-bold leading-tight">
            Угадай счёт. <span className="text-gradient-gold">Заработай очки.</span>
          </h1>
          <p className="text-lg text-muted-foreground">
            Приватная лига друзей с прогнозами на Чемпионат мира 2026.
            БИНГО · Ничья · Исход — три способа победить.
          </p>
          <div className="grid grid-cols-3 gap-3 pt-4">
            {[{n:3,l:"БИНГО"},{n:2,l:"Ничья"},{n:1,l:"Исход"}].map(s=>(
              <div key={s.l} className="rounded-lg border border-border bg-card/50 backdrop-blur p-4 text-center">
                <div className="text-3xl font-bold text-gold">+{s.n}</div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mt-1">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-xs text-muted-foreground">Призовой фонд · <span className="text-gold font-bold">100 EURO</span></div>
      </div>

      <div className="flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8 text-center">
            <div className="inline-flex items-center gap-2 mb-3">
              <div className="size-10 rounded-full bg-gradient-to-br from-gold to-primary grid place-items-center">
                <Trophy className="size-5 text-primary-foreground" />
              </div>
              <div className="text-xl font-bold">ЧМ-2026</div>
            </div>
          </div>

          <Tabs value={mode === "reset" ? "login" : mode} onValueChange={(v) => setMode(v as "login" | "signup")}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="login">Войти</TabsTrigger>
              <TabsTrigger value="signup">Регистрация</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="space-y-4 mt-6">
              {mode === "reset" ? (
                <form onSubmit={onReset} className="space-y-4">
                  <h2 className="text-lg font-semibold">Восстановление</h2>
                  <div className="space-y-2"><Label>Email</Label><Input type="email" required value={email} onChange={e=>setEmail(e.target.value)} /></div>
                  <Button className="w-full" disabled={busy}>Отправить письмо</Button>
                  <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={()=>setMode("login")}>← Назад ко входу</button>
                </form>
              ) : (
                <form onSubmit={onLogin} className="space-y-4">
                  <div className="space-y-2"><Label>Email</Label><Input type="email" required value={email} onChange={e=>setEmail(e.target.value)} /></div>
                  <div className="space-y-2"><Label>Пароль</Label><Input type="password" required value={password} onChange={e=>setPassword(e.target.value)} /></div>
                  <Button className="w-full" disabled={busy}>{busy ? "..." : "Войти"}</Button>
                  <button type="button" className="text-xs text-muted-foreground hover:text-gold" onClick={()=>setMode("reset")}>Забыли пароль?</button>
                  <div className="relative my-2"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div><div className="relative flex justify-center text-xs"><span className="bg-background px-2 text-muted-foreground">или</span></div></div>
                  <Button type="button" variant="outline" className="w-full border-gold/40 text-gold hover:bg-gold/10" onClick={() => { localStorage.setItem(DEMO_KEY, "1"); window.location.href = "/schedule" }}>🎮 Войти как демо</Button>
                </form>
              )}
            </TabsContent>

            <TabsContent value="signup" className="space-y-4 mt-6">
              <form onSubmit={onSignup} className="space-y-4">
                <div className="space-y-2"><Label>Имя пользователя</Label><Input required value={username} onChange={e=>setUsername(e.target.value)} placeholder="Батя / Вадя / Саня / Даня / Я" /></div>
                <div className="space-y-2">
                  <Label>Машина</Label>
                  <select value={car} onChange={e=>setCar(e.target.value)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                    {CARS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-2"><Label>Email</Label><Input type="email" required value={email} onChange={e=>setEmail(e.target.value)} /></div>
                <div className="space-y-2"><Label>Пароль</Label><Input type="password" required minLength={6} value={password} onChange={e=>setPassword(e.target.value)} /></div>
                <Button className="w-full" disabled={busy}>{busy ? "..." : "Создать аккаунт"}</Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
