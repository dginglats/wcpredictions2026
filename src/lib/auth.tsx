import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { Session, User } from "@supabase/supabase-js"
import { supabase } from "@/integrations/supabase/client"
import type { Profile } from "@/lib/types"

export const DEMO_KEY = "__demo_session__"

export const DEMO_USER = {
  user: { id: "demo-user-id", email: "demo@mundial2026.local" } as User,
  session: {} as Session,
  profile: { id: "demo-user-id", username: "Demo Player", email: "demo@mundial2026.local", car: null } as Profile,
  isAdmin: false,
}

interface AuthCtx {
  user: User | null
  session: Session | null
  profile: Profile | null
  isAdmin: boolean
  loading: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const Ctx = createContext<AuthCtx>({
  user: null, session: null, profile: null, isAdmin: false, loading: true,
  signOut: async () => {}, refreshProfile: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const isDemo = typeof window !== "undefined" && localStorage.getItem(DEMO_KEY) === "1"

  const [session, setSession] = useState<Session | null>(isDemo ? DEMO_USER.session : null)
  const [user, setUser] = useState<User | null>(isDemo ? DEMO_USER.user : null)
  const [profile, setProfile] = useState<Profile | null>(isDemo ? DEMO_USER.profile : null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(!isDemo)

  async function loadProfile(uid: string) {
    const [{ data: prof }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
    ])
    setProfile((prof as Profile) ?? null)
    setIsAdmin(Boolean(roles?.some((r: { role: string }) => r.role === "admin")))
  }

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(DEMO_KEY) === "1") return
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s); setUser(s?.user ?? null)
      if (s?.user) { setTimeout(() => loadProfile(s.user.id), 0) }
      else { setProfile(null); setIsAdmin(false) }
    })
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session); setUser(data.session?.user ?? null)
      if (data.session?.user) loadProfile(data.session.user.id).finally(() => setLoading(false))
      else setLoading(false)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  return (
    <Ctx.Provider value={{
      user, session, profile, isAdmin, loading,
      signOut: async () => { localStorage.removeItem(DEMO_KEY); await supabase.auth.signOut() },
      refreshProfile: async () => { if (user) await loadProfile(user.id) },
    }}>{children}</Ctx.Provider>
  )
}

export const useAuth = () => useContext(Ctx)
