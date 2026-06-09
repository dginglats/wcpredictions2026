import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import confetti from "canvas-confetti"
import { supabase } from "@/integrations/supabase/client"
import { useAuth } from "@/lib/auth"
import type { Match, Prediction, LeaderboardRow } from "@/lib/types"
import { outcomeBadge, STAGE_LABELS } from "@/lib/scoring"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Crown, Lock, Save, Users, Clock } from "lucide-react"
import { toast } from "sonner"

const DAY_MS = 24 * 60 * 60 * 1000

export const Route = createFileRoute("/_authenticated/predictions")({ component: PredictionsPage })

interface OtherPrediction {
  id: string
  match_id: string
  user_id: string
  home_score: number
  away_score: number
  outcome_type: string | null
  points: number | null
  profiles: { username: string; car: string | null } | null
}

function PredictionsPage() {
  const { user } = useAuth()
  const [matches, setMatches] = useState<Match[]>([])
  const [preds, setPreds] = useState<Record<string, Prediction>>({})
  const [otherPreds, setOtherPreds] = useState<Record<string, OtherPrediction[]>>({})
  const [allPreds, setAllPreds] = useState<Record<string, OtherPrediction[]>>({})
  const [draft, setDraft] = useState<Record<string, { h: string; a: string }>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [leaderIds, setLeaderIds] = useState<Set<string>>(new Set())
  const [isLeader, setIsLeader] = useState(false)

  async function reload() {
    if (!user) return
    const [{ data: ms }, { data: allPs }, { data: lb }] = await Promise.all([
      supabase.from("matches").select("*").order("kickoff"),
      supabase.from("predictions").select("id, match_id, user_id, home_score, away_score, outcome_type, points, profiles(username, car)"),
      supabase.from("leaderboard").select("*"),
    ])

    setMatches((ms ?? []) as Match[])

    const myMap: Record<string, Prediction> = {}
    const drafts: Record<string, { h: string; a: string }> = {}
    const opMap: Record<string, OtherPrediction[]> = {}
    const apMap: Record<string, OtherPrediction[]> = {}
    for (const p of (allPs ?? []) as unknown as OtherPrediction[]) {
      apMap[p.match_id] ??= []
      apMap[p.match_id].push(p)
      if (p.user_id === user.id) {
        myMap[p.match_id] = p as unknown as Prediction
        drafts[p.match_id] = { h: String(p.home_score), a: String(p.away_score) }
      } else {
        opMap[p.match_id] ??= []
        opMap[p.match_id].push(p)
      }
    }
    setPreds(myMap)
    setDraft(d => ({ ...drafts, ...d }))
    setOtherPreds(opMap)
    setAllPreds(apMap)

    const rows = (lb ?? []) as LeaderboardRow[]
    const maxPts = rows.reduce((mx, r) => Math.max(mx, r.total_points ?? 0), 0)
    if (maxPts > 0) {
      const leaders = rows.filter(r => (r.total_points ?? 0) === maxPts)
      const ids = new Set(leaders.map(l => l.user_id!).filter(Boolean))
      setLeaderIds(ids)
      setIsLeader(ids.has(user.id))
    } else {
      setLeaderIds(new Set())
      setIsLeader(true)
    }
  }
  useEffect(() => { reload() }, [user])

  /** Betting window: opens 24h before kickoff, closes at kickoff */
  function canBet(m: Match): { allowed: boolean; reason?: string } {
    const kickoff = new Date(m.kickoff).getTime()
    const now = Date.now()
    if (m.status !== "scheduled" || now >= kickoff) {
      return { allowed: false, reason: "Матч начался" }
    }
    if (now < kickoff - DAY_MS) {
      const opensAt = new Date(kickoff - DAY_MS)
      const dateStr = opensAt.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
      return { allowed: false, reason: `Откроется ${dateStr}` }
    }
    if (isLeader) return { allowed: true }
    const leaderArray = Array.from(leaderIds)
    if (leaderArray.length === 0) return { allowed: true }
    const leaderPredictions = (otherPreds[m.id] ?? []).filter(p => leaderIds.has(p.user_id))
    const allLeadersBet = leaderArray.every(lid =>
      leaderPredictions.some(p => p.user_id === lid) || (preds[m.id] as unknown as OtherPrediction)?.user_id === lid
    )
    if (!allLeadersBet) return { allowed: false, reason: "Ждём прогноза лидера" }
    return { allowed: true }
  }

  async function save(m: Match) {
    if (!user) return
    const { allowed, reason } = canBet(m)
    if (!allowed) return toast.error(reason ?? "Нельзя ставить прогноз")
    const d = draft[m.id]
    if (!d || d.h === "" || d.a === "") return toast.error("Введите счёт")
    const h = Number(d.h), a = Number(d.a)
    if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0) return toast.error("Некорректный счёт")
    setBusy(m.id)
    const existing = preds[m.id]
    const { error } = existing
      ? await supabase.from("predictions").update({ home_score: h, away_score: a }).eq("id", existing.id)
      : await supabase.from("predictions").insert({ user_id: user.id, match_id: m.id, home_score: h, away_score: a })
    setBusy(null)
    if (error) return toast.error(error.message)
    toast.success("Прогноз сохранён")
    reload()
  }

  const now = Date.now()
  const future = matches.filter(m => new Date(m.kickoff).getTime() > now && m.status === "scheduled")
  const past = matches.filter(m => m.status === "finished" || new Date(m.kickoff).getTime() <= now)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Мои прогнозы</h1>
        <p className="text-muted-foreground text-sm mt-1">Прогноз можно изменить до начала матча.
          {leaderIds.size > 0 && !isLeader && <span className="ml-2 text-gold">👑 Лидер ставит первым</span>}
          {isLeader && leaderIds.size > 0 && <span className="ml-2 text-gold">👑 Вы лидер — ставьте первым!</span>}
        </p>
      </div>

      <Tabs defaultValue="mine">
        <TabsList className="grid w-full grid-cols-2 max-w-sm mb-2">
          <TabsTrigger value="mine">Мои прогнозы</TabsTrigger>
          <TabsTrigger value="participants" className="flex items-center gap-1.5"><Users className="size-4" />Участников</TabsTrigger>
        </TabsList>

        <TabsContent value="mine">
        <Tabs defaultValue="future">
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="future">Будущие ({future.length})</TabsTrigger>
            <TabsTrigger value="past">Завершённые ({past.length})</TabsTrigger>
          </TabsList>

        <TabsContent value="future" className="space-y-3 mt-4">
          {future.length === 0 && <Empty text="Нет предстоящих матчей." />}
          {future.map(m => {
            const d = draft[m.id] ?? { h: "", a: "" }
            const { allowed, reason } = canBet(m)
            const others = otherPreds[m.id] ?? []
            return (
              <div key={m.id} className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="text-xs text-muted-foreground mb-2 flex justify-between">
                  <span>{new Date(m.kickoff).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="text-gold">{STAGE_LABELS[m.stage]}{m.group_name ? ` · Группа ${m.group_name}` : ""}</span>
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div className="text-right font-semibold">{m.home_flag} {m.home_team}</div>
                  <div className="flex items-center gap-2">
                    <Input
                      className="w-14 text-center tabular-nums"
                      inputMode="numeric"
                      value={d.h}
                      disabled={!allowed}
                      onChange={e=>setDraft(s=>({...s,[m.id]:{...d,h:e.target.value.replace(/\D/g,"")}}))}
                    />
                    <span className="text-muted-foreground">:</span>
                    <Input
                      className="w-14 text-center tabular-nums"
                      inputMode="numeric"
                      value={d.a}
                      disabled={!allowed}
                      onChange={e=>setDraft(s=>({...s,[m.id]:{...d,a:e.target.value.replace(/\D/g,"")}}))}
                    />
                  </div>
                  <div className="font-semibold">{m.away_team} {m.away_flag}</div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  {!allowed
                    ? <span className="text-xs flex items-center gap-1 text-gold"><Crown className="size-3" />{reason}</span>
                    : <span />
                  }
                  <Button size="sm" onClick={()=>save(m)} disabled={busy===m.id || !allowed}>
                    <Save className="size-3.5 mr-1" />Сохранить
                  </Button>
                </div>
                {/* Others' predictions */}
                {others.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/50">
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-2">
                      <Users className="size-3" />Прогнозы участников
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {others.map(op => (
                        <div key={op.id} className="flex items-center gap-1 text-xs bg-secondary rounded-md px-2 py-1">
                          {leaderIds.has(op.user_id) && <Crown className="size-3 text-gold" />}
                          <span className="font-medium">{op.profiles?.username ?? "?"}</span>
                          <span className="tabular-nums text-muted-foreground">{op.home_score}:{op.away_score}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </TabsContent>

            <TabsContent value="past" className="space-y-3 mt-4">
              {past.length === 0 && <Empty text="Завершённых матчей пока нет." />}
              {past.map(m => {
                const p = preds[m.id]
                const b = outcomeBadge(p?.outcome_type ?? null)
                const others = otherPreds[m.id] ?? []
                return (
                  <div key={m.id} className="rounded-xl border border-border bg-card p-4 shadow-card">
                    <div className="text-xs text-muted-foreground mb-3 flex justify-between">
                      <span>{new Date(m.kickoff).toLocaleString("ru-RU", { day: "2-digit", month: "short" })}{m.group_name ? ` · Гр. ${m.group_name}` : ""}</span>
                      <span className="flex items-center gap-1 text-muted-foreground"><Lock className="size-3" />Закрыт</span>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                      <div className="flex flex-col items-end gap-0.5">
                        {m.home_flag && <span className="text-2xl leading-none">{m.home_flag}</span>}
                        <span className="font-semibold text-sm">{m.home_team}</span>
                      </div>
                      <div className="text-center">
                        <div className="text-xl font-bold tabular-nums">{m.status === "finished" ? `${m.home_score}:${m.away_score}` : "—:—"}</div>
                        {p && <div className="text-[10px] text-muted-foreground mt-0.5">мой прогноз {p.home_score}:{p.away_score}</div>}
                      </div>
                      <div className="flex flex-col items-start gap-0.5">
                        {m.away_flag && <span className="text-2xl leading-none">{m.away_flag}</span>}
                        <span className="font-semibold text-sm">{m.away_team}</span>
                      </div>
                    </div>
                    {p && m.status === "finished" && (
                      <div className="mt-3 flex justify-center items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${b.color}`}>{b.label}</span>
                        <span className="text-sm font-bold text-gold">+{p.points ?? 0}</span>
                      </div>
                    )}
                    {!p && <div className="text-center text-xs text-muted-foreground mt-3">Прогноз не сделан</div>}
                    {others.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border/50">
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-2">
                          <Users className="size-3" />Прогнозы других участников
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {others.map(op => {
                            const ob = outcomeBadge(op.outcome_type ?? null)
                            return (
                              <div key={op.id} className="flex items-center gap-1.5 text-xs bg-secondary rounded-md px-2 py-1">
                                <span className="font-medium">{op.profiles?.username ?? "?"}</span>
                                <span className="tabular-nums">{op.home_score}:{op.away_score}</span>
                                {op.outcome_type && (
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ob.color}`}>{ob.label}</span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* ── PARTICIPANTS TAB ── */}
        <TabsContent value="participants" className="space-y-3 mt-4">
          {matches.length === 0 && <Empty text="Матчей пока нет." />}
          {matches.map(m => {
            const participants = allPreds[m.id] ?? []
            const isFinished = m.status === "finished"
            return (
              <div key={m.id} className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="text-xs text-muted-foreground mb-3 flex justify-between">
                  <span>{new Date(m.kickoff).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="text-gold">{m.group_name ? `Группа ${m.group_name}` : STAGE_LABELS[m.stage]}</span>
                </div>
                <div className="flex items-center justify-center gap-6 mb-3">
                  <div className="flex flex-col items-end gap-0.5">
                    {m.home_flag && <span className="text-2xl leading-none">{m.home_flag}</span>}
                    <span className="font-semibold text-sm">{m.home_team}</span>
                  </div>
                  <div className="text-center shrink-0">
                    {isFinished
                      ? <span className="text-xl font-bold tabular-nums">{m.home_score}:{m.away_score}</span>
                      : <span className="text-muted-foreground font-bold text-sm">vs</span>
                    }
                  </div>
                  <div className="flex flex-col items-start gap-0.5">
                    {m.away_flag && <span className="text-2xl leading-none">{m.away_flag}</span>}
                    <span className="font-semibold text-sm">{m.away_team}</span>
                  </div>
                </div>
                {participants.length === 0
                  ? <p className="text-center text-xs text-muted-foreground py-2">Прогнозов пока нет</p>
                  : (
                    <div className="space-y-1.5">
                      {[...participants]
                        .sort((a, b) => (a.profiles?.username ?? "").localeCompare(b.profiles?.username ?? ""))
                        .map(op => {
                          const ob = outcomeBadge(op.outcome_type ?? null)
                          const isMe = op.user_id === user?.id
                          return (
                            <div key={op.id} className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${isMe ? "bg-primary/10 border border-primary/20" : "bg-secondary/50"}`}>
                              <div className="flex items-center gap-2">
                                {leaderIds.has(op.user_id) && <Crown className="size-3.5 text-gold" />}
                                <span className="font-medium">{op.profiles?.username ?? "?"}{isMe ? " (я)" : ""}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="tabular-nums font-bold">{op.home_score}:{op.away_score}</span>
                                {op.outcome_type && (
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ob.color}`}>{ob.label}</span>
                                )}
                                {op.points !== null && isFinished && (
                                  <span className="text-gold text-xs font-bold">+{op.points}</span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  )
                }
              </div>
            )
          })}
        </TabsContent>
      </Tabs>

      <ConfettiOnBingo preds={preds} />
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="text-center text-muted-foreground py-12 border border-dashed border-border rounded-xl">{text}</div>
}

function ConfettiOnBingo({ preds }: { preds: Record<string, Prediction> }) {
  const [seen, setSeen] = useState<Set<string>>(new Set())
  useEffect(() => {
    for (const id in preds) {
      if (preds[id].outcome_type === "bingo" && !seen.has(id)) {
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 }, colors: ["#facc15","#22c55e","#3b82f6"] })
        setSeen(s => new Set(s).add(id))
        break
      }
    }
  }, [preds, seen])
  return null
}
