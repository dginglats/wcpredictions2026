import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { supabase } from "@/integrations/supabase/client"
import type { LeaderboardRow } from "@/lib/types"
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Legend, LineChart, Line } from "recharts"

export const Route = createFileRoute("/_authenticated/stats")({ component: StatsPage })

interface PredAgg { user_id: string; username: string; points: number; bingo: number }

function StatsPage() {
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [series, setSeries] = useState<Array<Record<string, string | number>>>([])

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("leaderboard").select("*")
      setRows((data ?? []) as LeaderboardRow[])

      const { data: ps } = await supabase.from("predictions")
        .select("user_id, points, updated_at, profiles(username), matches!inner(kickoff,status)")
      type PR = { user_id: string; points: number | null; updated_at: string; profiles: { username: string } | null; matches: { kickoff: string; status: string } }
      const list = ((ps ?? []) as unknown as PR[]).filter(p => p.matches?.status === "finished" && p.points !== null)
      list.sort((a,b) => new Date(a.matches.kickoff).getTime() - new Date(b.matches.kickoff).getTime())
      const users = Array.from(new Set(list.map(p => p.profiles?.username ?? "?")))
      const dayMap: Record<string, Record<string, number>> = {}
      const running: Record<string, number> = {}
      for (const p of list) {
        const day = new Date(p.matches.kickoff).toLocaleDateString("ru-RU", { day:"2-digit", month:"short" })
        const u = p.profiles?.username ?? "?"
        running[u] = (running[u] ?? 0) + (p.points ?? 0)
        dayMap[day] ??= { ...running }
        dayMap[day][u] = running[u]
        for (const usr of users) dayMap[day][usr] ??= running[usr] ?? 0
      }
      const arr: Array<Record<string, string | number>> = Object.entries(dayMap).map(([day, vals]) => ({ day, ...vals }))
      setSeries(arr)
    })()
  }, [])

  const bingoData: PredAgg[] = rows.map(r => ({ user_id: r.user_id ?? "", username: r.username ?? "?", points: r.total_points ?? 0, bingo: r.bingo_count ?? 0 }))

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Статистика</h1>

      <section className="rounded-xl border border-border bg-card p-5 shadow-card">
        <h2 className="font-semibold mb-4">Рост очков по дням</h2>
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={series}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="day" tick={{ fill: "#9ca3af", fontSize: 11 }} />
              <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
              <Tooltip contentStyle={{ background:"#1e293b", border:"1px solid #334155", borderRadius:8 }} />
              <Legend />
              {rows.map((r, i) => (
                <Line key={r.user_id ?? i} type="monotone" dataKey={r.username ?? "?"} stroke={["#22c55e","#facc15","#3b82f6","#f97316","#a855f7"][i%5]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-6">
        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h2 className="font-semibold mb-4">Очки игроков</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={bingoData}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="username" tick={{ fill:"#9ca3af", fontSize:11 }} />
                <YAxis tick={{ fill:"#9ca3af", fontSize:11 }} />
                <Tooltip contentStyle={{ background:"#1e293b", border:"1px solid #334155", borderRadius:8 }} />
                <Bar dataKey="points" fill="oklch(0.72 0.18 145)" radius={[6,6,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h2 className="font-semibold mb-4">Количество БИНГО</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={bingoData}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="username" tick={{ fill:"#9ca3af", fontSize:11 }} />
                <YAxis tick={{ fill:"#9ca3af", fontSize:11 }} />
                <Tooltip contentStyle={{ background:"#1e293b", border:"1px solid #334155", borderRadius:8 }} />
                <Bar dataKey="bingo" fill="oklch(0.82 0.16 85)" radius={[6,6,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  )
}
