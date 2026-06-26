/**
 * Реконструкция таблицы по игровым дням: проигрывает сыгранные прогнозы по
 * датам и считает место каждого игрока на конец каждого дня. Нужна для стрелок
 * движения в таблице и для истории места в профиле — без новых таблиц в БД.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DayPred {
  user_id: string;
  /** Время начала матча, мс. */
  kickoff: number;
  points: number;
  /** Был ли это точный счёт (для тай-брейка, как в таблице). */
  bingo: boolean;
}

function toDayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Возвращает отсортированные игровые дни и место каждого игрока на конец
 * каждого дня (ranks[user_id][dayIndex]). Тай-брейк: очки → БИНГО.
 */
export function rankByDay(preds: DayPred[]): { days: number[]; ranks: Record<string, number[]> } {
  const days = Array.from(new Set(preds.map((p) => toDayStart(p.kickoff)))).sort((a, b) => a - b);
  const users = Array.from(new Set(preds.map((p) => p.user_id)));
  const ranks: Record<string, number[]> = {};
  for (const u of users) ranks[u] = [];

  days.forEach((day, di) => {
    const cutoff = day + DAY_MS; // включительно весь этот день
    const agg = users
      .map((u) => {
        let pts = 0;
        let bingo = 0;
        for (const p of preds) {
          if (p.user_id === u && p.kickoff < cutoff) {
            pts += p.points;
            if (p.bingo) bingo++;
          }
        }
        return { u, pts, bingo };
      })
      .sort((a, b) => b.pts - a.pts || b.bingo - a.bingo);

    agg.forEach((x, i) => {
      const prev = agg[i - 1];
      ranks[x.u][di] =
        i > 0 && prev.pts === x.pts && prev.bingo === x.bingo ? ranks[prev.u][di] : i + 1;
    });
  });

  return { days, ranks };
}

/** Движение места между двумя последними игровыми днями: >0 — поднялся. */
export function movementByUser(preds: DayPred[]): Record<string, number> {
  const { days, ranks } = rankByDay(preds);
  const move: Record<string, number> = {};
  if (days.length < 2) return move;
  const last = days.length - 1;
  for (const [uid, series] of Object.entries(ranks)) {
    const prev = series[last - 1];
    const curr = series[last];
    if (prev != null && curr != null) move[uid] = prev - curr;
  }
  return move;
}
