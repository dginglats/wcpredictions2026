import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { supabase } from "@/integrations/supabase/client"
import type { LeaderboardRow } from "@/lib/types"
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
  Legend, LineChart, Line, Cell, LabelList,
} from "recharts"
import { carEmblemDot } from "@/components/CarEmblem"

export const Route = createFileRoute("/_authenticated/stats")({ component: StatsPage })

const PLAYER_COLORS = ["#22c55e","#facc15","#3b82f6","#f97316","#a855f7","#ec4899","#06b6d4","#84cc16"]

interface PredAgg { user_id: string; username: string; points: number; bingo: number; outcome: number; draw: number; miss: number; rate: number }

// Custom bar label showing the value on top
const BarLabel = (props: { x?: number; y?: number; width?: number; value?: number }) => {
  const { x = 0, y = 0, width = 0, value = 0 } = props
  if (!value) return null
  return <text x={x + width / 2} y={y - 4} fill="#9ca3af" textAnchor="middle" fontSize={11}>{value}</text>
}

function StatsPage() {
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [series, setSeries] = useState<Array<Record<string, string | number>>>([])

  async function load() {
    const [{ data }, { data: ps }, { data: profs }] = await Promise.all([
      supabase.from("leaderboard").select("*"),
      // No FK from predictions.user_id -> profiles.id, so fetch profiles separately and join in JS.
      supabase.from("predictions").select("user_id, points, updated_at, matches!inner(kickoff,status)"),
      supabase.from("profiles").select("id, username"),
    ])
    const sorted = [...((data ?? []) as LeaderboardRow[])].sort((a, b) => (b.total_points ?? 0) - (a.total_points ?? 0))
    setRows(sorted)

    const nameOf: Record<string, string> = {}
    for (const pr of (profs ?? []) as { id: string; username: string }[]) nameOf[pr.id] = pr.username

    type PR = { user_id: string; points: number | null; updated_at: string; matches: { kickoff: string; status: string } }
    const list = ((ps ?? []) as unknown as PR[]).filter(p => p.matches?.status === "finished" && p.points !== null)
    list.sort((a,b) => new Date(a.matches.kickoff).getTime() - new Date(b.matches.kickoff).getTime())
    const users = Array.from(new Set(list.map(p => nameOf[p.user_id] ?? "?")))
    const dayMap: Record<string, Record<string, number>> = {}
    const running: Record<string, number> = {}
    for (const p of list) {
      const day = new Date(p.matches.kickoff).toLocaleDateString("ru-RU", { day:"2-digit", month:"short" })
      const u = nameOf[p.user_id] ?? "?"
      running[u] = (running[u] ?? 0) + (p.points ?? 0)
      dayMap[day] ??= {}
      dayMap[day][u] = running[u]
      for (const usr of users) { if (!(usr in dayMap[day])) dayMap[day][usr] = running[usr] ?? 0 }
    }
    const arr: Array<Record<string, string | number>> = Object.entries(dayMap).map(([day, vals]) => ({ day, ...vals }))
    setSeries(arr)
  }

  useEffect(() => {
    load()
    const ch = supabase.channel("stats-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const barData: PredAgg[] = rows.map(r => ({
    user_id: r.user_id ?? "",
    username: r.username ?? "?",
    points: r.total_points ?? 0,
    bingo: r.bingo_count ?? 0,
    outcome: r.outcome_count ?? 0,
    draw: r.draw_count ?? 0,
    miss: r.miss_count ?? 0,
    rate: Number(r.success_rate ?? 0),
  }))

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Статистика</h1>

      {/* 1. Points growth over time (line chart) */}
      {series.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h2 className="font-semibold mb-4">Рост очков по дням</h2>
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 16, right: 34, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <Tooltip contentStyle={{ background:"#1e293b", border:"1px solid #334155", borderRadius:8 }} />
                <Legend />
                {rows.map((r, i) => {
                  const color = PLAYER_COLORS[i % PLAYER_COLORS.length]
                  // Маленькая точка на промежуточных днях, эмблема машины — на последнем.
                  const renderDot = (p: { cx?: number; cy?: number; index?: number; key?: string }) => {
                    const { cx, cy, index, key } = p
                    if (cx == null || cy == null) return <g key={key} />
                    if (index === series.length - 1) return carEmblemDot(r.car, color, cx, cy, 28, key)
                    return <circle key={key} cx={cx} cy={cy} r={2.5} fill={color} />
                  }
                  return (
                    <Line
                      key={r.user_id ?? i}
                      type="monotone"
                      dataKey={r.username ?? "?"}
                      stroke={color}
                      strokeWidth={2.5}
                      dot={renderDot}
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  )
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* 2. Points per player — horizontal bar chart with names */}
      {barData.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h2 className="font-semibold mb-4">Очки игроков</h2>
          <div style={{ height: Math.max(200, barData.length * 52) }}>
            <ResponsiveContainer>
              <BarChart data={barData} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" tick={{ fill:"#9ca3af", fontSize:11 }} />
                <YAxis type="category" dataKey="username" width={90} tick={{ fill:"#e2e8f0", fontSize:12, fontWeight:600 }} />
                <Tooltip
                  contentStyle={{ background:"#1e293b", border:"1px solid #334155", borderRadius:8 }}
                  formatter={(v: number) => [`${v} очков`, "Очки"]}
                />
                <Bar dataKey="points" radius={[0,6,6,0]} maxBarSize={32}>
                  <LabelList dataKey="points" position="right" fill="#9ca3af" fontSize={12} />
                  {barData.map((_, i) => <Cell key={i} fill={PLAYER_COLORS[i % PLAYER_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* 3. Breakdown: bingo / outcome / draw / miss per player */}
      {barData.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h2 className="font-semibold mb-4">Разбивка по типам результата</h2>
          <div style={{ height: Math.max(220, barData.length * 52) }}>
            <ResponsiveContainer>
              <BarChart data={barData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" tick={{ fill:"#9ca3af", fontSize:11 }} />
                <YAxis type="category" dataKey="username" width={90} tick={{ fill:"#e2e8f0", fontSize:12, fontWeight:600 }} />
                <Tooltip contentStyle={{ background:"#1e293b", border:"1px solid #334155", borderRadius:8 }} />
                <Legend />
                <Bar dataKey="bingo"   name="БИНГО"   stackId="a" fill="#facc15" maxBarSize={28} />
                <Bar dataKey="draw"    name="Ничья"   stackId="a" fill="#3b82f6" maxBarSize={28} />
                <Bar dataKey="outcome" name="Исход"   stackId="a" fill="#22c55e" maxBarSize={28} />
                <Bar dataKey="miss"    name="Промах"  stackId="a" fill="#ef4444" maxBarSize={28} radius={[0,6,6,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* 4. Success rate */}
      {barData.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h2 className="font-semibold mb-4">Процент успешных прогнозов</h2>
          <div style={{ height: Math.max(200, barData.length * 52) }}>
            <ResponsiveContainer>
              <BarChart data={barData} layout="vertical" margin={{ left: 8, right: 56, top: 4, bottom: 4 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" domain={[0,100]} unit="%" tick={{ fill:"#9ca3af", fontSize:11 }} />
                <YAxis type="category" dataKey="username" width={90} tick={{ fill:"#e2e8f0", fontSize:12, fontWeight:600 }} />
                <Tooltip
                  contentStyle={{ background:"#1e293b", border:"1px solid #334155", borderRadius:8 }}
                  formatter={(v: number) => [`${v}%`, "Успех"]}
                />
                <Bar dataKey="rate" radius={[0,6,6,0]} maxBarSize={32}>
                  <LabelList dataKey="rate" position="right" fill="#9ca3af" fontSize={12} formatter={(v: number) => `${v}%`} />
                  {barData.map((_, i) => <Cell key={i} fill={PLAYER_COLORS[i % PLAYER_COLORS.length]} fillOpacity={0.8} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {barData.length === 0 && series.length === 0 && (
        <div className="text-center text-muted-foreground py-20 border border-dashed border-border rounded-xl">
          Статистика появится после первых сыгранных матчей
        </div>
      )}
    </div>
  )
}
