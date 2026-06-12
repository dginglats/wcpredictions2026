import { createFileRoute, useRouter } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { supabase } from "@/integrations/supabase/client"
import { useAuth } from "@/lib/auth"
import type { Match, MatchStage, MatchStatus, Profile } from "@/lib/types"
import { STAGE_LABELS } from "@/lib/scoring"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { toast } from "sonner"
import { Plus, Trash2, Save } from "lucide-react"

export const Route = createFileRoute("/_authenticated/admin")({ component: AdminPage })

function AdminPage() {
  const { isAdmin, loading } = useAuth()
  const router = useRouter()
  useEffect(() => { if (!loading && !isAdmin) router.navigate({ to: "/schedule" }) }, [isAdmin, loading, router])
  if (loading) return <div>Загрузка...</div>
  if (!isAdmin) return null
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Панель администратора</h1>
      <Tabs defaultValue="matches">
        <TabsList>
          <TabsTrigger value="matches">Матчи</TabsTrigger>
          <TabsTrigger value="predictions">Прогнозы</TabsTrigger>
          <TabsTrigger value="players">Игроки</TabsTrigger>
        </TabsList>
        <TabsContent value="matches" className="mt-4 space-y-6"><MatchesAdmin /></TabsContent>
        <TabsContent value="predictions" className="mt-4"><PredictionsAdmin /></TabsContent>
        <TabsContent value="players" className="mt-4"><PlayersAdmin /></TabsContent>
      </Tabs>
    </div>
  )
}

function MatchesAdmin() {
  const [matches, setMatches] = useState<Match[]>([])
  const [form, setForm] = useState({ home_team:"", away_team:"", home_flag:"", away_flag:"", kickoff:"", stadium:"", city:"", stage:"group" as MatchStage, group_name:"" })

  async function load() {
    const { data } = await supabase.from("matches").select("*").order("kickoff")
    setMatches((data ?? []) as Match[])
  }
  useEffect(() => { load() }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!form.home_team || !form.away_team || !form.kickoff) return toast.error("Заполните обязательные поля")
    const { error } = await supabase.from("matches").insert({ ...form, group_name: form.group_name || null })
    if (error) return toast.error(error.message)
    toast.success("Матч добавлен")
    setForm({ home_team:"", away_team:"", home_flag:"", away_flag:"", kickoff:"", stadium:"", city:"", stage:"group", group_name:"" })
    load()
  }

  async function setResult(m: Match, h: number, a: number, status: MatchStatus) {
    const { error } = await supabase.from("matches").update({ home_score: h, away_score: a, status }).eq("id", m.id)
    if (error) return toast.error(error.message)
    toast.success("Результат сохранён, очки пересчитаны")
    load()
  }

  async function remove(id: string) {
    if (!confirm("Удалить матч?")) return
    const { error } = await supabase.from("matches").delete().eq("id", id)
    if (error) return toast.error(error.message)
    load()
  }

  return (
    <div className="space-y-6">
      <form onSubmit={create} className="rounded-xl border border-border bg-card p-5 shadow-card space-y-4">
        <h2 className="font-semibold">Добавить матч</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>Хозяева</Label><Input required value={form.home_team} onChange={e=>setForm({...form,home_team:e.target.value})} /></div>
          <div><Label>Гости</Label><Input required value={form.away_team} onChange={e=>setForm({...form,away_team:e.target.value})} /></div>
          <div><Label>Флаг хозяев (код страны, 2 буквы)</Label><Input value={form.home_flag} onChange={e=>setForm({...form,home_flag:e.target.value})} placeholder="MX" /></div>
          <div><Label>Флаг гостей (код страны, 2 буквы)</Label><Input value={form.away_flag} onChange={e=>setForm({...form,away_flag:e.target.value})} placeholder="ZA" /></div>
          <div><Label>Начало (ваше время)</Label><Input required type="datetime-local" value={form.kickoff} onChange={e=>setForm({...form,kickoff:e.target.value})} /></div>
          <div><Label>Стадия</Label>
            <select value={form.stage} onChange={e=>setForm({...form,stage:e.target.value as MatchStage})} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
              {Object.entries(STAGE_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div><Label>Группа</Label><Input value={form.group_name} onChange={e=>setForm({...form,group_name:e.target.value})} placeholder="A" /></div>
          <div><Label>Стадион</Label><Input value={form.stadium} onChange={e=>setForm({...form,stadium:e.target.value})} /></div>
          <div className="sm:col-span-2"><Label>Город</Label><Input value={form.city} onChange={e=>setForm({...form,city:e.target.value})} /></div>
        </div>
        <Button type="submit"><Plus className="size-4 mr-1" />Добавить</Button>
      </form>

      <div className="space-y-3">
        <h2 className="font-semibold">Все матчи ({matches.length})</h2>
        {matches.map(m => <MatchAdminRow key={m.id} m={m} onResult={setResult} onDelete={remove} />)}
      </div>
    </div>
  )
}

function MatchAdminRow({ m, onResult, onDelete }: { m: Match; onResult: (m:Match,h:number,a:number,s:MatchStatus)=>void; onDelete:(id:string)=>void }) {
  const [h, setH] = useState(String(m.home_score ?? ""))
  const [a, setA] = useState(String(m.away_score ?? ""))
  const [status, setStatus] = useState<MatchStatus>(m.status)
  return (
    <div className="rounded-lg border border-border bg-card p-3 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[200px]">
        <div className="text-xs text-muted-foreground">{new Date(m.kickoff).toLocaleString("ru-RU")} · {STAGE_LABELS[m.stage]}{m.group_name?` · гр.${m.group_name}`:""}</div>
        <div className="font-semibold">{m.home_team} — {m.away_team}</div>
      </div>
      <Input className="w-14 text-center" value={h} onChange={e=>setH(e.target.value.replace(/\D/g,""))} placeholder="—" />
      <span>:</span>
      <Input className="w-14 text-center" value={a} onChange={e=>setA(e.target.value.replace(/\D/g,""))} placeholder="—" />
      <select value={status} onChange={e=>setStatus(e.target.value as MatchStatus)} className="h-10 rounded-md border border-input bg-background px-2 text-sm">
        <option value="scheduled">Запланирован</option>
        <option value="live">Идёт</option>
        <option value="finished">Завершён</option>
      </select>
      <Button size="sm" onClick={()=>onResult(m, Number(h||0), Number(a||0), status)}><Save className="size-3.5" /></Button>
      <Button size="sm" variant="destructive" onClick={()=>onDelete(m.id)}><Trash2 className="size-3.5" /></Button>
    </div>
  )
}

interface AdminPrediction {
  id: string
  user_id: string
  home_score: number
  away_score: number
}

function PredictionsAdmin() {
  const [matches, setMatches] = useState<Match[]>([])
  const [profs, setProfs] = useState<Record<string, Profile>>({})
  const [matchId, setMatchId] = useState<string>("")
  const [preds, setPreds] = useState<AdminPrediction[]>([])
  const [draft, setDraft] = useState<Record<string, { h: string; a: string }>>({})
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const [{ data: ms }, { data: ps }] = await Promise.all([
        supabase.from("matches").select("*").order("kickoff"),
        supabase.from("profiles").select("*"),
      ])
      const list = (ms ?? []) as Match[]
      setMatches(list)
      const pm: Record<string, Profile> = {}
      for (const p of (ps ?? []) as Profile[]) pm[p.id] = p
      setProfs(pm)
      if (!matchId && list.length) {
        const now = Date.now()
        const next = list.find(m => new Date(m.kickoff).getTime() > now && m.status === "scheduled") ?? list[0]
        setMatchId(next.id)
      }
    })()
  }, [])

  async function loadPreds(id: string) {
    const { data } = await supabase.from("predictions").select("id, user_id, home_score, away_score").eq("match_id", id)
    const rows = (data ?? []) as AdminPrediction[]
    setPreds(rows)
    setDraft(Object.fromEntries(rows.map(r => [r.id, { h: String(r.home_score), a: String(r.away_score) }])))
  }
  useEffect(() => { if (matchId) loadPreds(matchId) }, [matchId])

  const selected = matches.find(m => m.id === matchId)
  const started = selected ? (new Date(selected.kickoff).getTime() <= Date.now() || selected.status !== "scheduled") : false

  async function save(p: AdminPrediction) {
    const d = draft[p.id]
    if (!d || d.h === "" || d.a === "") return toast.error("Введите счёт")
    const h = Number(d.h), a = Number(d.a)
    if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0) return toast.error("Некорректный счёт")
    setBusy(p.id)
    const { error } = await supabase.from("predictions").update({ home_score: h, away_score: a }).eq("id", p.id)
    setBusy(null)
    if (error) return toast.error(error.message)
    toast.success("Прогноз изменён")
    loadPreds(matchId)
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>Матч</Label>
        <select value={matchId} onChange={e=>setMatchId(e.target.value)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
          {matches.map(m => (
            <option key={m.id} value={m.id}>
              {new Date(m.kickoff).toLocaleString("ru-RU", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })} · {m.home_team} — {m.away_team}
            </option>
          ))}
        </select>
      </div>

      {started && <p className="text-xs text-gold">⚠ Матч уже начался — изменение прогнозов повлияет на уже начисленные очки.</p>}

      {preds.length === 0
        ? <p className="text-sm text-muted-foreground">На этот матч прогнозов нет.</p>
        : (
          <div className="space-y-2">
            {[...preds]
              .sort((a, b) => (profs[a.user_id]?.username ?? "").localeCompare(profs[b.user_id]?.username ?? ""))
              .map(p => {
                const d = draft[p.id] ?? { h:"", a:"" }
                return (
                  <div key={p.id} className="rounded-lg border border-border bg-card p-3 flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[150px]">
                      <div className="font-medium">{profs[p.user_id]?.username ?? "?"}</div>
                      <div className="text-xs text-muted-foreground">{profs[p.user_id]?.email}</div>
                    </div>
                    <Input className="w-14 text-center" inputMode="numeric" value={d.h} onChange={e=>setDraft(s=>({...s,[p.id]:{...d,h:e.target.value.replace(/\D/g,"")}}))} />
                    <span>:</span>
                    <Input className="w-14 text-center" inputMode="numeric" value={d.a} onChange={e=>setDraft(s=>({...s,[p.id]:{...d,a:e.target.value.replace(/\D/g,"")}}))} />
                    <Button size="sm" onClick={()=>save(p)} disabled={busy===p.id}><Save className="size-3.5 mr-1" />Сохранить</Button>
                  </div>
                )
              })}
          </div>
        )
      }
    </div>
  )
}

function PlayersAdmin() {
  const [profs, setProfs] = useState<Profile[]>([])
  async function load() {
    const { data } = await supabase.from("profiles").select("*").order("username")
    setProfs((data ?? []) as Profile[])
  }
  useEffect(() => { load() }, [])
  async function save(p: Profile) {
    const { error } = await supabase.from("profiles").update({ username: p.username, car: p.car }).eq("id", p.id)
    if (error) return toast.error(error.message)
    toast.success("Сохранено"); load()
  }
  return (
    <div className="space-y-3">
      {profs.map(p => (
        <div key={p.id} className="rounded-lg border border-border bg-card p-3 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[150px]">
            <div className="text-xs text-muted-foreground">{p.email}</div>
            <Input value={p.username} onChange={e=>setProfs(s=>s.map(x=>x.id===p.id?{...x,username:e.target.value}:x))} />
          </div>
          <Input className="w-36" value={p.car ?? ""} onChange={e=>setProfs(s=>s.map(x=>x.id===p.id?{...x,car:e.target.value}:x))} placeholder="Машина" />
          <Button size="sm" onClick={()=>save(p)}><Save className="size-3.5 mr-1" />Сохранить</Button>
        </div>
      ))}
    </div>
  )
}
