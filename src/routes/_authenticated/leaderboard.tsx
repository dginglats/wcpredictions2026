import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { supabase } from "@/integrations/supabase/client"
import type { LeaderboardRow } from "@/lib/types"
import { Crown, Download, Trophy } from "lucide-react"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/_authenticated/leaderboard")({ component: LeaderboardPage })

function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardRow[]>([])

  async function load() {
    const { data } = await supabase.from("leaderboard").select("*")
    const sorted = [...((data ?? []) as LeaderboardRow[])].sort((a,b) =>
      (b.total_points ?? 0) - (a.total_points ?? 0)
      || (b.bingo_count ?? 0) - (a.bingo_count ?? 0)
      || (a.username ?? "").localeCompare(b.username ?? "")
    )
    setRows(sorted)
  }
  useEffect(() => {
    load()
    const ch = supabase.channel("lb-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  // rank with ties
  const ranks: number[] = []
  rows.forEach((r, i) => {
    if (i === 0) ranks.push(1)
    else {
      const prev = rows[i-1]
      if ((r.total_points ?? 0) === (prev.total_points ?? 0) && (r.bingo_count ?? 0) === (prev.bingo_count ?? 0)) ranks.push(ranks[i-1])
      else ranks.push(i+1)
    }
  })
  const leaders = rows.filter((_,i) => ranks[i] === 1)

  function exportCsv() {
    const headers = ["Место","Игрок","Машина","Очки","БИНГО","Ничьи","Исходы","Промахи","%"]
    const lines = rows.map((r,i) => [ranks[i], r.username, r.car ?? "", r.total_points, r.bingo_count, r.draw_count, r.outcome_count, r.miss_count, r.success_rate].join(","))
    const csv = "\uFEFF" + [headers.join(","), ...lines].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href = url; a.download = "leaderboard.csv"; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><Trophy className="size-7 text-gold" />Турнирная таблица</h1>
          {leaders.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              👑 Лидер{leaders.length>1?"ы":""}: <span className="text-gold font-semibold">{leaders.map(l=>l.username).join(", ")}</span> · должен публиковать прогнозы первым.
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}><Download className="size-4 mr-2" />CSV</Button>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-secondary-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-3 text-left">Место</th>
                <th className="px-3 py-3 text-left">Игрок</th>
                <th className="px-3 py-3 text-left hidden sm:table-cell">Машина</th>
                <th className="px-3 py-3 text-right">Очки</th>
                <th className="px-3 py-3 text-right">БИНГО</th>
                <th className="px-3 py-3 text-right hidden md:table-cell">Ничьи</th>
                <th className="px-3 py-3 text-right hidden md:table-cell">Исходы</th>
                <th className="px-3 py-3 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r,i) => {
                const rank = ranks[i]
                const isLeader = rank === 1
                const isTop3 = rank <= 3
                return (
                  <tr key={r.user_id} className={`border-t border-border transition-all ${isLeader ? "bg-gold/10" : isTop3 ? "bg-accent/40" : ""}`}>
                    <td className="px-3 py-3 font-bold">
                      <div className="flex items-center gap-1">
                        {isLeader && <Crown className="size-4 text-gold" />}
                        <span className={isLeader ? "text-gold" : isTop3 ? "text-primary" : ""}>{rank}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-semibold">{r.username}</td>
                    <td className="px-3 py-3 text-gold text-xs hidden sm:table-cell">{r.car ?? "—"}</td>
                    <td className="px-3 py-3 text-right font-bold tabular-nums text-lg">{r.total_points}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <span className="inline-flex items-center justify-center min-w-7 px-2 py-0.5 rounded-md bg-gold/20 text-gold font-bold">{r.bingo_count}</span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums hidden md:table-cell">{r.draw_count}</td>
                    <td className="px-3 py-3 text-right tabular-nums hidden md:table-cell">{r.outcome_count}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{r.success_rate}%</td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">Пока пусто.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
