import { createFileRoute } from "@tanstack/react-router"
import { Trophy, Target, Equal, X, Crown } from "lucide-react"

export const Route = createFileRoute("/_authenticated/rules")({ component: RulesPage })

const rules = [
  { icon: Trophy, color: "text-gold", title: "БИНГО", pts: "+3", desc: "Точный счёт угадан", ex: "Прогноз 2:1 — Результат 2:1" },
  { icon: Equal, color: "text-primary", title: "Ничья", pts: "+2", desc: "Угадана ничья (но не точный счёт)", ex: "Прогноз 1:1 — Результат 0:0" },
  { icon: Target, color: "text-chart-3", title: "Исход", pts: "+1", desc: "Угадан победитель матча", ex: "Прогноз 2:0 — Результат 1:0" },
  { icon: X, color: "text-destructive", title: "Промах", pts: "0", desc: "Ничего не угадано", ex: "Прогноз 1:2 — Результат 3:0" },
]

function RulesPage() {
  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold">Правила турнира</h1>
        <p className="text-muted-foreground mt-2">Простые и понятные. Угадывай счёт и зарабатывай очки.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {rules.map(r => (
          <div key={r.title} className="rounded-xl border border-border bg-card p-5 shadow-card">
            <div className="flex items-start justify-between mb-3">
              <r.icon className={`size-8 ${r.color}`} />
              <span className={`text-3xl font-bold ${r.color}`}>{r.pts}</span>
            </div>
            <h3 className="font-bold text-lg">{r.title}</h3>
            <p className="text-sm text-muted-foreground mt-1">{r.desc}</p>
            <div className="mt-3 text-xs bg-secondary rounded-md p-2 font-mono">{r.ex}</div>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-gold/30 bg-gradient-to-br from-card to-gold/5 p-6 shadow-gold">
        <div className="flex items-start gap-4">
          <Crown className="size-8 text-gold flex-shrink-0" />
          <div>
            <h2 className="font-bold text-lg">Правило лидера</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Игрок с наибольшим количеством очков — текущий лидер. Возле его имени показывается значок 👑.
              <br /><span className="text-foreground font-medium">Лидер обязан публиковать прогнозы первым.</span>
            </p>
            <p className="text-xs text-muted-foreground mt-3">
              При равенстве очков лидерство определяется количеством БИНГО.
              Если и БИНГО одинаково — игроки делят первое место.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-bold text-xl">Призовой фонд</h2>
        <div className="mt-3 text-5xl font-bold text-gradient-gold">100 €</div>
        <p className="text-sm text-muted-foreground mt-3">
          Каждый участник условно вносит <span className="text-foreground font-semibold">20 евро</span>.
          Побеждает игрок с наибольшим количеством очков.
        </p>
        <p className="text-xs text-muted-foreground mt-3">
          При равенстве: больше БИНГО → если БИНГО одинаково, дополнительное правило определяется организаторами.
        </p>
      </section>
    </div>
  )
}
