import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import confetti from "canvas-confetti"
import { supabase } from "@/integrations/supabase/client"
import { useAuth } from "@/lib/auth"
import type { Match, Prediction } from "@/lib/types"
import { outcomeBadge, STAGE_LABELS } from "@/lib/scoring"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Lock, Save } from "lucide-react"
import { toast } from "sonner"

export const Route = createFileRoute("/_authenticated/predictions")({ component: PredictionsPage })

function PredictionsPage() {
  const { user } = useAuth()
  const [matches, setMatches] = useState<Match[]>([])
  const [preds, setPreds] = useState<Record<string, Prediction>>({})
  const [draft, setDraft] = useState<Record<string, { h: string; a: string }>>({})
  const [busy, setBusy] = useState<string | null>(null)

  async function reload() {
    if (!user) return
    const [{ data: ms }, { data: ps }] = await Promise.all([
      supabase.from("matches").select("*").order("kickoff"),
      supabase.from("predictions").select("*").eq("user_id", user.id),
    ])
    setMatches((ms ?? []) as Match[])
    const map: Record<string, Prediction> = {}
    const drafts: Record<string, { h: string; a: string }> = {}
    for (const p of (ps ?? []) as Prediction[]) {
      map[p.match_id] = p
      drafts[p.match_id] = { h: String(p.home_score), a: String(p.away_score) }
    }
    setPreds(map); setDraft(d => ({ ...drafts, ...d }))
  }
  useEffect(() => { reload() }, [user])

  async function save(m: Match) {
    if (!user) return
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
        <p className="text-muted-foreground text-sm mt-1">Прогноз можно изменить до начала матча.</p>
      </div>

      <Tabs defaultValue="future">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="future">Будущие ({future.length})</TabsTrigger>
          <TabsTrigger value="past">Завершённые ({past.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="future" className="space-y-3 mt-4">
          {future.length === 0 && <Empty text="Нет предстоящих матчей." />}
          {future.map(m => {
            const d = draft[m.id] ?? { h: "", a: "" }
            return (
              <div key={m.id} className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="text-xs text-muted-foreground mb-2 flex justify-between">
                  <span>{new Date(m.kickoff).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="text-gold">{STAGE_LABELS[m.stage]}</span>
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div className="text-right font-semibold">{m.home_team}</div>
                  <div className="flex items-center gap-2">
                    <Input className="w-14 text-center tabular-nums" inputMode="numeric" value={d.h} onChange={e=>setDraft(s=>({...s,[m.id]:{...d,h:e.target.value.replace(/\D/g,"")}}))} />
                    <span className="text-muted-foreground">:</span>
                    <Input className="w-14 text-center tabular-nums" inputMode="numeric" value={d.a} onChange={e=>setDraft(s=>({...s,[m.id]:{...d,a:e.target.value.replace(/\D/g,"")}}))} />
                  </div>
                  <div className="font-semibold">{m.away_team}</div>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button size="sm" onClick={()=>save(m)} disabled={busy===m.id}><Save className="size-3.5 mr-1" />Сохранить</Button>
                </div>
              </div>
            )
          })}
        </TabsContent>

        <TabsContent value="past" className="space-y-3 mt-4">
          {past.length === 0 && <Empty text="Завершённых матчей пока нет." />}
          {past.map(m => {
            const p = preds[m.id]
            const b = outcomeBadge(p?.outcome_type ?? null)
            return (
              <div key={m.id} className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="text-xs text-muted-foreground mb-2 flex justify-between">
                  <span>{new Date(m.kickoff).toLocaleString("ru-RU", { day: "2-digit", month: "short" })}</span>
                  <span className="flex items-center gap-1 text-muted-foreground"><Lock className="size-3" />Закрыт</span>
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div className="text-right font-semibold">{m.home_team}</div>
                  <div className="text-center">
                    <div className="text-xl font-bold tabular-nums">{m.status === "finished" ? `${m.home_score}:${m.away_score}` : "—:—"}</div>
                    {p && <div className="text-[10px] text-muted-foreground mt-0.5">прогноз {p.home_score}:{p.away_score}</div>}
                  </div>
                  <div className="font-semibold">{m.away_team}</div>
                </div>
                {p && m.status === "finished" && (
                  <div className="mt-3 flex justify-center items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${b.color}`}>{b.label}</span>
                    <span className="text-sm font-bold text-gold">+{p.points ?? 0}</span>
                  </div>
                )}
                {!p && <div className="text-center text-xs text-muted-foreground mt-3">Прогноз не сделан</div>}
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
