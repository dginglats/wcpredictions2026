export const CARS = ["TOYOTA", "AUDI", "VOLVO", "BMW", "ŠKODA"] as const;

export const STAGE_LABELS: Record<string, string> = {
  group: "Группа",
  round_of_32: "1/16 финала",
  round_of_16: "1/8 финала",
  quarter_final: "1/4 финала",
  semi_final: "1/2 финала",
  third_place: "Матч за 3-е место",
  final: "ФИНАЛ",
};

export const WORLD_CUP_FINAL = new Date("2026-07-19T20:00:00Z");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Betting opens at 00:00, two calendar days before the match day.
 * e.g. a match on Jun 15 opens for predictions on Jun 13 at 00:00 (local time).
 */
export function bettingOpensAt(kickoffIso: string): number {
  const kickoff = new Date(kickoffIso);
  const matchDayStart = new Date(kickoff.getFullYear(), kickoff.getMonth(), kickoff.getDate());
  return matchDayStart.getTime() - 2 * DAY_MS;
}

export type BettingState = "open" | "not_open" | "closed";

/**
 * Time-based betting window state (ignores the leader-bets-first rule).
 * - "not_open": window hasn't opened yet
 * - "open": window is open, closes at kickoff
 * - "closed": match started/finished, no more bets
 */
export function bettingState(
  kickoffIso: string,
  status: string,
  now: number = Date.now(),
): BettingState {
  const kickoff = new Date(kickoffIso).getTime();
  if (status !== "scheduled" || now >= kickoff) return "closed";
  if (now < bettingOpensAt(kickoffIso)) return "not_open";
  return "open";
}

/** Human-readable remaining time, e.g. "2д 5ч", "3ч 12м", "8м 40с". */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "0с";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}д ${h}ч`;
  if (h > 0) return `${h}ч ${m}м`;
  return `${m}м ${sec}с`;
}

export function pointsLabel(p: number | null) {
  if (p === null) return "—";
  return `+${p}`;
}

export function outcomeBadge(o: string | null) {
  switch (o) {
    case "bingo":
      return { label: "БИНГО", color: "bg-gold text-gold-foreground" };
    case "draw":
      return { label: "Ничья", color: "bg-primary text-primary-foreground" };
    case "outcome":
      return { label: "Исход", color: "bg-chart-3 text-white" };
    case "miss":
      return { label: "Промах", color: "bg-destructive text-destructive-foreground" };
    default:
      return { label: "—", color: "bg-muted text-muted-foreground" };
  }
}
