import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/integrations/supabase/client"
import { useAuth } from "@/lib/auth"
import type { Match, Prediction } from "@/lib/types"
import { STAGE_LABELS } from "@/lib/scoring"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Search, MapPin, Calendar } from "lucide-react"
import { Countdown } from "@/components/Countdown"
import { TeamDisplay } from "@/components/TeamDisplay"

export const Route = createFileRoute("/_authenticated/schedule")({ component: SchedulePage })

function SchedulePage() {
  const { user } = useAuth()
  const [matches, setMatches] = useState<Match[]>([])
  const [preds, setPreds] = useState<Record<string, Prediction>>({})
  const [predCounts, setPredCounts] = useState<Record<string, { bingo: number; outcome: number }>>({})
  const [q, setQ] = useState("")
  const [stage, setStage] = useState<string>("all")

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("matches").select("*").order("kickoff", { ascending: true })
      setMatches((data ?? []) as Match[])
      if (user) {
        const { data: ps } = await supabase.from("predictions").select("*").eq("user_id", user.id)
        const map: Record<string, Prediction> = {}
        for (const p of (ps ?? []) as Prediction[]) map[p.match_id] = p
        setPreds(map)
      }
      const { data: allp } = await supabase.from("predictions").select("match_id,outcome_type")
      const counts: Record<string, { bingo: number; outcome: number }> = {}
      for (const p of (allp ?? []) as { match_id: string; outcome_type: string | null }[]) {
        counts[p.match_id] ??= { bingo: 0, outcome: 0 }
        if (p.outcome_type === "bingo") counts[p.match_id].bingo++
        if (p.outcome_type === "bingo" || p.outcome_type === "outcome" || p.outcome_type === "draw") counts[p.match_id].outcome++
      }
      setPredCounts(counts)
    })()

    const ch = supabase.channel("matches-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, async () => {
        const { data } = await supabase.from("matches").select("*").order("kickoff", { ascending: true })
        setMatches((data ?? []) as Match[])
      }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [user])

  const filtered = useMemo(() => matches.filter(m =>
    (stage === "all" || m.stage === stage) &&
    (q === "" || (m.home_team + m.away_team + (m.group_name ?? "")).toLowerCase().includes(q.toLowerCase()))
  ), [matches, q, stage])

  const now = Date.now()
  const upcoming = filtered.filter(m => m.status !== "finished" && new Date(m.kickoff).getTime() > now)
  const today = filtered.filter(m => {
    const d = new Date(m.kickoff)
    return d.toDateString() === new Date().toDateString() || m.status === "live"
  })
  const finished = filtered.filter(m => m.status === "finished")

  const remaining = matches.filter(m => m.status !== "finished").length

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-2xl bg-hero border border-border p-6 md:p-8">
        <div className="absolute inset-0 pitch-lines opacity-20" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <div className="text-xs uppercase tracking-widest text-gold mb-2">До финала ЧМ-2026</div>
            <Countdown />
            <div className="text-xs text-muted-foreground mt-3">Осталось матчей: <span className="text-foreground font-semibold">{remaining}</span> · Всего: {matches.length}</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Призовой фонд</div>
            <div className="text-4xl md:text-5xl font-bold text-gradient-gold">100 €</div>
          </div>
        </div>
      </section>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Поиск команды или группы..." value={q} onChange={e=>setQ(e.target.value)} className="pl-9" />
        </div>
        <select value={stage} onChange={e=>setStage(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">Все стадии</option>
          {Object.entries(STAGE_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <Tabs defaultValue="upcoming">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="upcoming" className="text-xs sm:text-sm px-1 sm:px-3">Ближайшие ({upcoming.length})</TabsTrigger>
          <TabsTrigger value="today" className="text-xs sm:text-sm px-1 sm:px-3">Сегодня ({today.length})</TabsTrigger>
          <TabsTrigger value="finished" className="text-xs sm:text-sm px-1 sm:px-3">Завершённые ({finished.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming" className="space-y-3 mt-4">
          {upcoming.length === 0 ? <Empty /> : upcoming.map(m => <MatchCard key={m.id} m={m} pred={preds[m.id]} counts={predCounts[m.id]} />)}
        </TabsContent>
        <TabsContent value="today" className="space-y-3 mt-4">
          {today.length === 0 ? <Empty /> : today.map(m => <MatchCard key={m.id} m={m} pred={preds[m.id]} counts={predCounts[m.id]} />)}
        </TabsContent>
        <TabsContent value="finished" className="space-y-3 mt-4">
          {finished.length === 0 ? <Empty /> : finished.map(m => <MatchCard key={m.id} m={m} pred={preds[m.id]} counts={predCounts[m.id]} />)}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Empty() {
  return <div className="text-center text-muted-foreground py-16 border border-dashed border-border rounded-xl">Матчей пока нет. Админ может добавить расписание.</div>
}

function MatchCard({ m, pred, counts }: { m: Match; pred?: Prediction; counts?: { bingo: number; outcome: number } }) {
  const date = new Date(m.kickoff)
  const isFinished = m.status === "finished"
  const isLive = m.status === "live"
  return (
    <div className={`relative rounded-xl border bg-card shadow-card overflow-hidden ${isLive ? "border-primary shadow-glow" : "border-border"}`}>
      {isLive && <div className="absolute top-2 right-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary"><span className="size-2 rounded-full bg-primary animate-pulse" />LIVE</div>}
      <div className="p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground mb-3">
          <span className="flex items-center gap-1">
            <Calendar className="size-3 shrink-0" />
            {date.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
          {m.group_name && <span className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">Группа {m.group_name}</span>}
          <span className="ml-auto text-gold">{STAGE_LABELS[m.stage]}</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 sm:gap-4">
          <TeamDisplay flag={m.home_flag} name={m.home_team} />
          <div className="self-center px-1">
            {isFinished ? (
              <div className="text-2xl sm:text-3xl md:text-4xl font-bold tabular-nums text-gradient-gold whitespace-nowrap">{m.home_score}:{m.away_score}</div>
            ) : (
              <div className="text-xl sm:text-2xl font-bold text-muted-foreground">vs</div>
            )}
          </div>
          <TeamDisplay flag={m.away_flag} name={m.away_team} />
        </div>
        {(m.stadium || m.city) && (
          <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mt-3">
            <MapPin className="size-3" /> {[m.stadium, m.city].filter(Boolean).join(", ")}
          </div>
        )}
        {pred && (
          <div className="mt-3 flex items-center justify-center gap-2 text-xs">
            <span className="text-muted-foreground">Твой прогноз:</span>
            <span className="font-bold tabular-nums">{pred.home_score}:{pred.away_score}</span>
            {pred.points !== null && <span className="px-2 py-0.5 rounded bg-gold text-gold-foreground font-bold">+{pred.points}</span>}
          </div>
        )}
        {isFinished && counts && (
          <div className="mt-3 flex justify-center gap-4 text-[11px] text-muted-foreground">
            <span>🎯 БИНГО: <b className="text-gold">{counts.bingo}</b></span>
            <span>✓ Угадали исход: <b className="text-primary">{counts.outcome}</b></span>
          </div>
        )}
      </div>
    </div>
  )
}
