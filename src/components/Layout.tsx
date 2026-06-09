import { Link, Outlet, useRouter } from "@tanstack/react-router"
import { useAuth } from "@/lib/auth"
import { Trophy, Calendar, Target, BarChart3, BookOpen, Shield, LogOut, User, Menu, X } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"

const navItems = [
  { to: "/schedule", label: "Расписание", icon: Calendar },
  { to: "/predictions", label: "Прогнозы", icon: Target },
  { to: "/leaderboard", label: "Таблица", icon: Trophy },
  { to: "/stats", label: "Статистика", icon: BarChart3 },
  { to: "/rules", label: "Правила", icon: BookOpen },
]

export function Layout() {
  const { profile, isAdmin, signOut } = useAuth()
  const router = useRouter()
  const [open, setOpen] = useState(false)

  async function onSignOut() {
    await signOut()
    router.navigate({ to: "/auth" })
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b border-border/60 backdrop-blur-xl bg-background/70">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <Link to="/schedule" className="flex items-center gap-2 group">
            <div className="size-9 rounded-full bg-gradient-to-br from-primary to-pitch grid place-items-center shadow-glow">
              <Trophy className="size-5 text-primary-foreground" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-bold text-sm">ЧМ-2026</span>
              <span className="text-[10px] uppercase tracking-widest text-gold">Прогнозы</span>
            </div>
          </Link>

          <nav className="hidden lg:flex items-center gap-1">
            {navItems.map(n => (
              <Link key={n.to} to={n.to}
                className="px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-2"
                activeProps={{ className: "text-foreground bg-accent" }}>
                <n.icon className="size-4" />{n.label}
              </Link>
            ))}
            {isAdmin && (
              <Link to="/admin"
                className="px-3 py-2 rounded-md text-sm font-medium text-gold hover:bg-accent flex items-center gap-2"
                activeProps={{ className: "bg-accent" }}>
                <Shield className="size-4" />Админ
              </Link>
            )}
          </nav>

          <div className="hidden lg:flex items-center gap-2">
            <Link to="/profile" className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-accent">
              <div className="size-8 rounded-full bg-gradient-to-br from-pitch to-primary grid place-items-center text-xs font-bold">
                {profile?.username?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="text-left">
                <div className="text-xs font-medium leading-none">{profile?.username}</div>
                {profile?.car && <div className="text-[10px] text-gold leading-none mt-0.5">{profile.car}</div>}
              </div>
            </Link>
            <Button variant="ghost" size="icon" onClick={onSignOut} title="Выйти">
              <LogOut className="size-4" />
            </Button>
          </div>

          <button className="lg:hidden p-2" onClick={() => setOpen(!open)}>
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {open && (
          <div className="lg:hidden border-t border-border bg-background/95 backdrop-blur-xl">
            <div className="container mx-auto px-4 py-3 flex flex-col gap-1">
              {navItems.map(n => (
                <Link key={n.to} to={n.to} onClick={() => setOpen(false)}
                  className="px-3 py-2.5 rounded-md text-sm flex items-center gap-3 hover:bg-accent"
                  activeProps={{ className: "bg-accent text-foreground" }}>
                  <n.icon className="size-4" />{n.label}
                </Link>
              ))}
              {isAdmin && (
                <Link to="/admin" onClick={() => setOpen(false)}
                  className="px-3 py-2.5 rounded-md text-sm flex items-center gap-3 text-gold hover:bg-accent">
                  <Shield className="size-4" />Админ
                </Link>
              )}
              <Link to="/profile" onClick={() => setOpen(false)}
                className="px-3 py-2.5 rounded-md text-sm flex items-center gap-3 hover:bg-accent">
                <User className="size-4" />{profile?.username} {profile?.car && <span className="text-gold text-xs">· {profile.car}</span>}
              </Link>
              <button onClick={onSignOut} className="px-3 py-2.5 rounded-md text-sm flex items-center gap-3 hover:bg-accent text-destructive">
                <LogOut className="size-4" />Выйти
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 md:py-10">
        <Outlet />
      </main>

      <footer className="border-t border-border/60 mt-10">
        <div className="container mx-auto px-4 py-6 text-xs text-muted-foreground text-center">
          World Cup Predictor 2026 · Приватная лига друзей
        </div>
      </footer>
    </div>
  )
}
