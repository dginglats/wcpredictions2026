import { createFileRoute, redirect, Outlet, useRouter } from "@tanstack/react-router"
import { useEffect } from "react"
import { useAuth } from "@/lib/auth"
import { Layout } from "@/components/Layout"
import { supabase } from "@/integrations/supabase/client"

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    if (typeof localStorage !== "undefined" && localStorage.getItem("__demo_session__") === "1") return
    const { data } = await supabase.auth.getSession()
    if (!data.session) throw redirect({ to: "/auth" })
  },
  component: AuthGate,
})

function AuthGate() {
  const { user, loading } = useAuth()
  const router = useRouter()
  useEffect(() => { if (!loading && !user) router.navigate({ to: "/auth" }) }, [user, loading, router])
  if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Загрузка...</div>
  if (!user) return null
  return <Layout />
}
