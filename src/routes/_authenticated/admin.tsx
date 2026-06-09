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
          <TabsTrigger value="players">Игроки</TabsTrigger>
        </TabsList>
        <TabsContent value="matches" className="mt-4 space-y-6"><MatchesAdmin /></TabsContent>
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
          <div><Label>Флаг хозяев (emoji)</Label><Input value={form.home_flag} onChange={e=>setForm({...form,home_flag:e.target.value})} placeholder="🇷🇺" /></div>
          <div><Label>Флаг гостей</Label><Input value={form.away_flag} onChange={e=>setForm({...form,away_flag:e.target.value})} placeholder="🇧🇷" /></div>
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
