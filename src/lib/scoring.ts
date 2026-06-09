export const CARS = ["TOYOTA", "AUDI", "VOLVO", "BMW", "ŠKODA"] as const

export const STAGE_LABELS: Record<string, string> = {
  group: "Группа",
  round_of_32: "1/16 финала",
  round_of_16: "1/8 финала",
  quarter_final: "1/4 финала",
  semi_final: "1/2 финала",
  third_place: "Матч за 3-е место",
  final: "ФИНАЛ",
}

export const WORLD_CUP_FINAL = new Date("2026-07-19T20:00:00Z")

export function pointsLabel(p: number | null) {
  if (p === null) return "—"
  return `+${p}`
}

export function outcomeBadge(o: string | null) {
  switch (o) {
    case "bingo": return { label: "БИНГО", color: "bg-gold text-gold-foreground" }
    case "draw": return { label: "Ничья", color: "bg-primary text-primary-foreground" }
    case "outcome": return { label: "Исход", color: "bg-chart-3 text-white" }
    case "miss": return { label: "Промах", color: "bg-destructive text-destructive-foreground" }
    default: return { label: "—", color: "bg-muted text-muted-foreground" }
  }
}
