import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Поля матча, нужные для отображения финального счёта. */
export type ScoreParts = {
  home_score: number | null;
  away_score: number | null;
  score_duration?: string | null;
  home_et?: number | null;
  away_et?: number | null;
  home_pen?: number | null;
  away_pen?: number | null;
};

/**
 * Счёт завершённого матча.
 *
 * Основной (крупный) счёт — это ОСНОВНОЕ ВРЕМЯ (home_score/away_score). Для
 * матчей плей-офф, ушедших дальше:
 *   • пенальти   → у каждой команды надстрочно в скобках счёт серии: 1⁽⁴⁾ : 1⁽²⁾
 *   • доп. время → у каждой команды надстрочно итог после доп. времени: 1² : 1¹
 * Группа и матчи, решённые в основное время, показываются как обычно «1:2».
 *
 * className   — внешний контейнер (размер/жирность шрифта),
 * scoreClassName — строка со счётом (например, золотой градиент),
 * noteClassName  — мелкая подпись «по пенальти» / «доп. время».
 */
export function FinishedScore({
  m,
  className,
  scoreClassName,
  noteClassName,
}: {
  m: ScoreParts;
  className?: string;
  scoreClassName?: string;
  noteClassName?: string;
}) {
  const h = m.home_score;
  const a = m.away_score;
  const sup = "align-super text-[0.6em] font-semibold text-muted-foreground";
  const note = cn("text-[10px] font-medium text-muted-foreground leading-none mt-0.5", noteClassName);

  // Содержимое строки со счётом + (опц.) подпись о доп. времени / пенальти.
  let scoreLine: ReactNode;
  let noteLine: ReactNode = null;

  if (h == null || a == null) {
    scoreLine = <>—:—</>;
  } else if (m.score_duration === "PENALTY_SHOOTOUT" && m.home_pen != null && m.away_pen != null) {
    // Пенальти: основное время + (счёт серии) надстрочно у каждой команды.
    scoreLine = (
      <>
        {h}
        <span className={sup}>({m.home_pen})</span>
        <span className="mx-0.5">:</span>
        {a}
        <span className={sup}>({m.away_pen})</span>
      </>
    );
    noteLine = <span className={note}>по пенальти</span>;
  } else if (m.score_duration === "EXTRA_TIME") {
    // Доп. время (без серии пенальти): основное время + итог после доп. времени надстрочно.
    const fh = h + (m.home_et ?? 0);
    const fa = a + (m.away_et ?? 0);
    scoreLine = (
      <>
        {h}
        <span className={sup}>{fh}</span>
        <span className="mx-0.5">:</span>
        {a}
        <span className={sup}>{fa}</span>
      </>
    );
    noteLine = <span className={note}>доп. время</span>;
  } else {
    scoreLine = (
      <>
        {h}:{a}
      </>
    );
  }

  return (
    <span className={cn("inline-flex flex-col items-center leading-tight", className)}>
      <span className={cn("tabular-nums whitespace-nowrap", scoreClassName)}>{scoreLine}</span>
      {noteLine}
    </span>
  );
}
