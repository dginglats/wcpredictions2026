/**
 * Ачивки/бейджи игроков — считаются из таблицы лидеров, прогнозов на счёт и
 * сеток. Возвращает map user_id → список наград. Используется в Таблице
 * (значки у имени) и в Профиле (витрина).
 */

export interface Achievement {
  id: string;
  emoji: string;
  title: string;
  desc: string;
}

export interface AchLbRow {
  user_id: string | null;
  total_points: number | null;
  bingo_count: number | null;
  draw_count: number | null;
  success_rate: number | null;
  finished_count: number | null;
}

export interface AchPrediction {
  user_id: string;
  home_score: number;
  away_score: number;
  outcome_type: string | null;
  points: number | null;
  kickoff: string;
  status: string;
}

export interface AchBracket {
  user_id: string;
  champion: string;
}

export interface AchInput {
  leaderboard: AchLbRow[];
  predictions: AchPrediction[];
  brackets: AchBracket[];
}

function fmt1(n: number): string {
  return n.toFixed(1).replace(".", ",");
}

/** Все определения ачивок — для витрины в профиле (даже не полученные). */
export const ACHIEVEMENT_CATALOG: Achievement[] = [
  { id: "leader", emoji: "👑", title: "Лидер", desc: "Возглавляет таблицу." },
  { id: "bingo-machine", emoji: "💎", title: "БИНГО-машина", desc: "Больше всех точных счетов." },
  {
    id: "oracle",
    emoji: "🎯",
    title: "Оракул",
    desc: "Самый высокий процент успеха (от 5 матчей).",
  },
  { id: "peacemaker", emoji: "🤝", title: "Миротворец", desc: "Чаще всех угадывает ничьи." },
  { id: "optimist", emoji: "🎢", title: "Оптимист", desc: "Больше всех голов в прогнозах." },
  { id: "bus", emoji: "🚌", title: "Автобус", desc: "Самые осторожные прогнозы." },
  { id: "on-fire", emoji: "🔥", title: "На волне", desc: "Серия результативных прогнозов подряд." },
  { id: "kamikaze", emoji: "🎰", title: "Камикадзе", desc: "Чаще всех ставит на разгром." },
  { id: "dark-horse", emoji: "🐎", title: "Тёмная лошадка", desc: "Уникальный выбор чемпиона." },
];

export function computeAchievements({
  leaderboard,
  predictions,
  brackets,
}: AchInput): Record<string, Achievement[]> {
  const out: Record<string, Achievement[]> = {};
  const add = (uid: string, a: Achievement) => {
    (out[uid] ??= []).push(a);
  };
  const rows = leaderboard.filter((r): r is AchLbRow & { user_id: string } => Boolean(r.user_id));

  /** user_id'ы с максимальным значением среди прошедших guard (значение > 0). */
  const leadersBy = (
    val: (r: AchLbRow & { user_id: string }) => number,
    guard: (r: AchLbRow & { user_id: string }) => boolean = () => true,
  ) => {
    const elig = rows.filter(guard);
    if (!elig.length) return { uids: [] as string[], val: 0 };
    const max = Math.max(...elig.map(val));
    if (max <= 0) return { uids: [] as string[], val: 0 };
    return { uids: elig.filter((r) => val(r) === max).map((r) => r.user_id), val: max };
  };

  // 👑 Лидер
  for (const uid of leadersBy((r) => r.total_points ?? 0).uids) {
    add(uid, { id: "leader", emoji: "👑", title: "Лидер", desc: "Возглавляет таблицу." });
  }
  // 💎 БИНГО-машина
  {
    const { uids, val } = leadersBy((r) => r.bingo_count ?? 0);
    for (const uid of uids)
      add(uid, {
        id: "bingo-machine",
        emoji: "💎",
        title: "БИНГО-машина",
        desc: `Больше всех точных счетов (${val}).`,
      });
  }
  // 🎯 Оракул — % успеха, минимум 5 сыгранных
  {
    const { uids, val } = leadersBy(
      (r) => r.success_rate ?? 0,
      (r) => (r.finished_count ?? 0) >= 5,
    );
    for (const uid of uids)
      add(uid, {
        id: "oracle",
        emoji: "🎯",
        title: "Оракул",
        desc: `Самый высокий процент успеха (${val}%).`,
      });
  }
  // 🤝 Миротворец — больше всех угаданных ничьих
  {
    const { uids, val } = leadersBy(
      (r) => r.draw_count ?? 0,
      (r) => (r.draw_count ?? 0) >= 2,
    );
    for (const uid of uids)
      add(uid, {
        id: "peacemaker",
        emoji: "🤝",
        title: "Миротворец",
        desc: `Чаще всех угадывает ничьи (${val}).`,
      });
  }

  // ── Из сырых прогнозов: голы, серия, дерзость ──
  const goals: Record<string, { sum: number; n: number }> = {};
  const kamikaze: Record<string, number> = {};
  const finished: Record<string, Array<{ k: number; pts: number }>> = {};
  for (const p of predictions) {
    const g = (goals[p.user_id] ??= { sum: 0, n: 0 });
    g.sum += p.home_score + p.away_score;
    g.n++;
    if (Math.abs(p.home_score - p.away_score) >= 3)
      kamikaze[p.user_id] = (kamikaze[p.user_id] ?? 0) + 1;
    if (p.status === "finished" && p.points != null)
      (finished[p.user_id] ??= []).push({ k: new Date(p.kickoff).getTime(), pts: p.points });
  }

  // 🎢 Оптимист / 🚌 Автобус
  const goalArr = Object.entries(goals)
    .filter(([, v]) => v.n >= 3)
    .map(([uid, v]) => ({ uid, avg: v.sum / v.n }));
  if (goalArr.length >= 2) {
    const opt = goalArr.reduce((a, b) => (b.avg > a.avg ? b : a));
    const bus = goalArr.reduce((a, b) => (b.avg < a.avg ? b : a));
    if (opt.avg !== bus.avg) {
      add(opt.uid, {
        id: "optimist",
        emoji: "🎢",
        title: "Оптимист",
        desc: `Больше всех голов в прогнозах (${fmt1(opt.avg)} за матч).`,
      });
      add(bus.uid, {
        id: "bus",
        emoji: "🚌",
        title: "Автобус",
        desc: `Самые осторожные прогнозы (${fmt1(bus.avg)} гола за матч).`,
      });
    }
  }

  // 🔥 На волне — самая длинная текущая серия результативных
  {
    let best: { uid: string; n: number } | null = null;
    for (const [uid, list] of Object.entries(finished)) {
      list.sort((a, b) => a.k - b.k);
      let n = 0;
      for (let i = list.length - 1; i >= 0 && list[i].pts > 0; i--) n++;
      if (n >= 3 && (!best || n > best.n)) best = { uid, n };
    }
    if (best)
      add(best.uid, {
        id: "on-fire",
        emoji: "🔥",
        title: "На волне",
        desc: `Серия из ${best.n} результативных прогнозов подряд.`,
      });
  }

  // 🎰 Камикадзе — больше всех «дерзких» прогнозов (разница ≥ 3)
  {
    const arr = Object.entries(kamikaze).filter(([, n]) => n >= 2);
    if (arr.length) {
      const max = Math.max(...arr.map(([, n]) => n));
      for (const [uid, n] of arr)
        if (n === max)
          add(uid, {
            id: "kamikaze",
            emoji: "🎰",
            title: "Камикадзе",
            desc: `Чаще всех ставит на разгром (×${n}).`,
          });
    }
  }

  // 🐎 Тёмная лошадка — уникальный выбор чемпиона
  {
    const count: Record<string, string[]> = {};
    for (const b of brackets) if (b.champion) (count[b.champion] ??= []).push(b.user_id);
    const total = brackets.filter((b) => b.champion).length;
    if (total >= 3) {
      for (const [team, users] of Object.entries(count)) {
        if (users.length === 1)
          add(users[0], {
            id: "dark-horse",
            emoji: "🐎",
            title: "Тёмная лошадка",
            desc: `Единственный поставил на чемпионство ${team}.`,
          });
      }
    }
  }

  return out;
}
