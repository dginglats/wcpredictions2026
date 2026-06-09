import { useEffect, useState } from "react"
import { WORLD_CUP_FINAL } from "@/lib/scoring"

function diff() {
  const d = WORLD_CUP_FINAL.getTime() - Date.now()
  if (d <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 }
  return {
    days: Math.floor(d / 86400000),
    hours: Math.floor((d / 3600000) % 24),
    minutes: Math.floor((d / 60000) % 60),
    seconds: Math.floor((d / 1000) % 60),
  }
}

export function Countdown() {
  const [t, setT] = useState(diff())
  useEffect(() => { const id = setInterval(() => setT(diff()), 1000); return () => clearInterval(id) }, [])
  const items = [
    { v: t.days, l: "дней" },
    { v: t.hours, l: "часов" },
    { v: t.minutes, l: "минут" },
    { v: t.seconds, l: "секунд" },
  ]
  return (
    <div className="flex items-center gap-2 md:gap-3">
      {items.map((i, idx) => (
        <div key={idx} className="bg-card/70 backdrop-blur border border-border rounded-lg px-3 py-2 min-w-14 text-center">
          <div className="text-xl md:text-2xl font-bold text-gold tabular-nums">{String(i.v).padStart(2,"0")}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{i.l}</div>
        </div>
      ))}
    </div>
  )
}
