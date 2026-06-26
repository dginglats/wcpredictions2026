/**
 * Движок «Интересных фактов»: из прогнозов на счёт, сеток плей-офф и таблицы
 * лидеров генерирует список забавных авто-фактов про участников.
 *
 * Всё считается из уже существующих данных — никаких новых таблиц. Факты
 * естественно меняются по ходу турнира: до матчей живут факты из прогнозов и
 * сеток, после — серии, «никто не угадал» и гонка в таблице.
 */
import { GROUP_LETTERS, type BracketData } from "@/lib/bracket";

export type FactCategory = "bracket" | "scores" | "streak" | "consensus" | "leaderboard";

export interface FunFact {
  id: string;
  emoji: string;
  text: string;
  category: FactCategory;
  /** Чем выше — тем интереснее; влияет на порядок показа. */
  weight: number;
}

export interface FactMatch {
  id: string;
  kickoff: string;
  status: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  stage: string;
  group_name: string | null;
}

export interface FactPrediction {
  user_id: string;
  match_id: string;
  home_score: number;
  away_score: number;
  outcome_type: string | null;
  points: number | null;
}

export interface FactBracket {
  user_id: string;
  data: BracketData;
}

export interface FactLbRow {
  user_id: string | null;
  username: string | null;
  total_points: number | null;
  bingo_count: number | null;
}

export interface FactInput {
  matches: FactMatch[];
  predictions: FactPrediction[];
  brackets: FactBracket[];
  leaderboard: FactLbRow[];
  nameOf: Record<string, string>;
}

/** Русское склонение: 1 файл, 2 файла, 5 файлов. */
function plural(n: number, one: string, few: string, many: string): string {
  const nn = Math.abs(n) % 100;
  const n1 = nn % 10;
  if (nn > 10 && nn < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}

/** Дробное число в русском формате: 3.8 → "3,8". */
function fmt1(n: number): string {
  return n.toFixed(1).replace(".", ",");
}

/** Команда проходит из группы в этой сетке? pos: 0=1-е…3=4-е. */
function advancesInBracket(b: BracketData, group: string, pos: number): boolean {
  if (pos <= 1) return true; // 1-е и 2-е проходят всегда
  if (pos === 2) return b.thirds?.includes(group) ?? false; // 3-е — если выбрано
  return false; // 4-е не проходит
}

/**
 * Главный вход: собирает все факты, сортирует по «интересности» и перемешивает
 * по категориям, чтобы в споттлайте не шли подряд однотипные.
 */
export function buildFunFacts(input: FactInput): FunFact[] {
  const { matches, predictions, brackets, leaderboard, nameOf } = input;
  const name = (uid: string) => nameOf[uid] ?? "Кто-то";
  const matchById: Record<string, FactMatch> = {};
  for (const m of matches) matchById[m.id] = m;

  const facts: FunFact[] = [];

  // ── 1. «Похороненные» в группе команды (флагманский факт) ──
  {
    const advancedBy: Record<string, number> = {};
    const buriedByUsers: Record<string, string[]> = {};
    for (const b of brackets) {
      const groups = b.data?.groups;
      if (!groups) continue;
      for (const g of GROUP_LETTERS) {
        const order = groups[g];
        if (!order || order.length < 3) continue; // группа не расставлена
        order.forEach((team, idx) => {
          if (!team) return;
          if (advancesInBracket(b.data, g, idx)) advancedBy[team] = (advancedBy[team] ?? 0) + 1;
          else (buriedByUsers[team] ??= []).push(b.user_id);
        });
      }
    }
    const buried: FunFact[] = [];
    for (const [team, buriers] of Object.entries(buriedByUsers)) {
      const adv = advancedBy[team] ?? 0;
      const total = adv + buriers.length;
      if (total < 3 || adv === 0) continue;
      if (buriers.length > total / 2) continue; // если большинство хоронит — не сюрприз
      if (adv < Math.ceil(total * 0.6)) continue; // нужен явный перевес «за»
      for (const uid of buriers) {
        buried.push({
          id: `bury:${team}:${uid}`,
          emoji: "🪦",
          category: "bracket",
          weight: 60 + adv * 4 + (buriers.length === 1 ? 20 : 0),
          text: `По сетке ${name(uid)} ${team} не выходит из группы — хотя ${adv} из ${total} участников пропускают её дальше.`,
        });
      }
    }
    buried.sort((a, b) => b.weight - a.weight);
    facts.push(...buried.slice(0, 6));
  }

  // ── 2. Чемпион: одиночные ставки и фаворит ──
  {
    const champUsers: Record<string, string[]> = {};
    let totalBrackets = 0;
    for (const b of brackets) {
      const c = b.data?.final;
      if (!c) continue;
      totalBrackets++;
      (champUsers[c] ??= []).push(b.user_id);
    }
    const entries = Object.entries(champUsers);
    for (const [team, users] of entries) {
      if (users.length === 1 && totalBrackets >= 3) {
        facts.push({
          id: `lonechamp:${team}`,
          emoji: "👑",
          category: "bracket",
          weight: 70,
          text: `Только ${name(users[0])} верит в чемпионство ${team}.`,
        });
      }
    }
    if (entries.length) {
      const [topTeam, topUsers] = [...entries].sort((a, b) => b[1].length - a[1].length)[0];
      if (topUsers.length >= 2 && topUsers.length < totalBrackets) {
        facts.push({
          id: `topchamp:${topTeam}`,
          emoji: "🏆",
          category: "bracket",
          weight: 50,
          text: `Фаворит на титул — ${topTeam}: на чемпионство ставят ${topUsers.length} из ${totalBrackets}.`,
        });
      }
    }
  }

  // ── 3. Оптимист / «автобус» по среднему числу голов ──
  {
    const byUser: Record<string, { sum: number; n: number }> = {};
    for (const p of predictions) {
      const u = (byUser[p.user_id] ??= { sum: 0, n: 0 });
      u.sum += p.home_score + p.away_score;
      u.n++;
    }
    const arr = Object.entries(byUser)
      .filter(([, v]) => v.n >= 3)
      .map(([uid, v]) => ({ uid, avg: v.sum / v.n }));
    if (arr.length >= 2) {
      const opt = arr.reduce((a, b) => (b.avg > a.avg ? b : a));
      const pes = arr.reduce((a, b) => (b.avg < a.avg ? b : a));
      if (opt.uid !== pes.uid && opt.avg !== pes.avg) {
        facts.push({
          id: `optimist:${opt.uid}`,
          emoji: "🎢",
          category: "scores",
          weight: 45,
          text: `${name(opt.uid)} — главный оптимист: в среднем ${fmt1(opt.avg)} гола за матч в прогнозах.`,
        });
        facts.push({
          id: `bus:${pes.uid}`,
          emoji: "🚌",
          category: "scores",
          weight: 44,
          text: `${name(pes.uid)} ставит на «автобус»: всего ${fmt1(pes.avg)} гола за матч в среднем.`,
        });
      }
    }
  }

  // ── 4. Любимый счёт ──
  {
    const byUser: Record<string, Record<string, number>> = {};
    for (const p of predictions) {
      const key = `${p.home_score}:${p.away_score}`;
      (byUser[p.user_id] ??= {})[key] = ((byUser[p.user_id] ??= {})[key] ?? 0) + 1;
    }
    let best: { uid: string; score: string; n: number } | null = null;
    for (const [uid, m] of Object.entries(byUser)) {
      for (const [score, n] of Object.entries(m)) {
        if (n >= 3 && (!best || n > best.n)) best = { uid, score, n };
      }
    }
    if (best) {
      facts.push({
        id: `favscore:${best.uid}`,
        emoji: "🎯",
        category: "scores",
        weight: 48,
        text: `${name(best.uid)} обожает счёт ${best.score} — поставил его ${best.n} ${plural(best.n, "раз", "раза", "раз")}.`,
      });
    }
  }

  // ── 5. Самый дерзкий прогноз (разгром) ──
  {
    let bold: { p: FactPrediction; diff: number; total: number } | null = null;
    for (const p of predictions) {
      const diff = Math.abs(p.home_score - p.away_score);
      const total = p.home_score + p.away_score;
      if (!bold || diff > bold.diff || (diff === bold.diff && total > bold.total)) {
        bold = { p, diff, total };
      }
    }
    if (bold && bold.diff >= 3) {
      const m = matchById[bold.p.match_id];
      if (m) {
        facts.push({
          id: `bold:${bold.p.user_id}:${bold.p.match_id}`,
          emoji: "💥",
          category: "scores",
          weight: 42,
          text: `Самый дерзкий прогноз: ${name(bold.p.user_id)} ждёт разгром ${bold.p.home_score}:${bold.p.away_score} в матче ${m.home_team} — ${m.away_team}.`,
        });
      }
    }
  }

  // ── 6. Любитель ничьих ──
  {
    const byUser: Record<string, { d: number; n: number }> = {};
    for (const p of predictions) {
      const u = (byUser[p.user_id] ??= { d: 0, n: 0 });
      u.n++;
      if (p.home_score === p.away_score) u.d++;
    }
    const arr = Object.entries(byUser)
      .filter(([, v]) => v.n >= 4 && v.d >= 2)
      .map(([uid, v]) => ({ uid, ...v }));
    if (arr.length) {
      const top = arr.reduce((a, b) => (b.d > a.d ? b : a));
      facts.push({
        id: `draws:${top.uid}`,
        emoji: "🤝",
        category: "scores",
        weight: 38,
        text: `${name(top.uid)} верит в ничьи: поставил их ${top.d} ${plural(top.d, "раз", "раза", "раз")} из ${top.n} прогнозов.`,
      });
    }
  }

  // Прогнозы по матчам — нужно для консенсуса и «никто не угадал».
  const byMatch: Record<string, FactPrediction[]> = {};
  for (const p of predictions) (byMatch[p.match_id] ??= []).push(p);

  // ── 7. Единогласные прогнозы (на будущие матчи) ──
  {
    const consensus: FunFact[] = [];
    for (const [mid, ps] of Object.entries(byMatch)) {
      if (ps.length < 3) continue;
      const m = matchById[mid];
      if (!m) continue;
      const scores = new Set(ps.map((p) => `${p.home_score}:${p.away_score}`));
      if (scores.size === 1) {
        const [s] = [...scores];
        consensus.push({
          id: `unanimscore:${mid}`,
          emoji: "🎯",
          category: "consensus",
          weight: 66 + ps.length,
          text: `Единогласно: все ${ps.length} участников поставили ${s} в матче ${m.home_team} — ${m.away_team}.`,
        });
        continue;
      }
      if (m.status !== "scheduled") continue; // «ждут» — только про предстоящие
      const dirs = new Set(ps.map((p) => Math.sign(p.home_score - p.away_score)));
      if (dirs.size !== 1) continue;
      const d = [...dirs][0];
      if (d === 0) {
        consensus.push({
          id: `unanimdraw:${mid}`,
          emoji: "🤝",
          category: "consensus",
          weight: 46,
          text: `Все ${ps.length} участников ждут ничью в матче ${m.home_team} — ${m.away_team}.`,
        });
      } else {
        const winner = d > 0 ? m.home_team : m.away_team;
        const loser = d > 0 ? m.away_team : m.home_team;
        consensus.push({
          id: `unanimwin:${mid}`,
          emoji: "🤝",
          category: "consensus",
          weight: 40,
          text: `Все ${ps.length} участников ждут победы ${winner} над ${loser}.`,
        });
      }
    }
    consensus.sort((a, b) => b.weight - a.weight);
    facts.push(...consensus.slice(0, 5));
  }

  // ── 8. Серии: в огне / в холоде (по сыгранным матчам) ──
  {
    const finished: Record<string, Array<{ kickoff: number; points: number }>> = {};
    for (const p of predictions) {
      const m = matchById[p.match_id];
      if (!m || m.status !== "finished" || p.points == null) continue;
      (finished[p.user_id] ??= []).push({
        kickoff: new Date(m.kickoff).getTime(),
        points: p.points,
      });
    }
    let hot: { uid: string; n: number } | null = null;
    let cold: { uid: string; n: number } | null = null;
    for (const [uid, list] of Object.entries(finished)) {
      list.sort((a, b) => a.kickoff - b.kickoff);
      let hotN = 0;
      for (let i = list.length - 1; i >= 0 && list[i].points > 0; i--) hotN++;
      let coldN = 0;
      for (let i = list.length - 1; i >= 0 && list[i].points === 0; i--) coldN++;
      if (hotN >= 2 && (!hot || hotN > hot.n)) hot = { uid, n: hotN };
      if (coldN >= 2 && (!cold || coldN > cold.n)) cold = { uid, n: coldN };
    }
    if (hot) {
      facts.push({
        id: `hot:${hot.uid}`,
        emoji: "🔥",
        category: "streak",
        weight: 55 + hot.n * 3,
        text: `${name(hot.uid)} в огне: ${hot.n} ${plural(hot.n, "результативный прогноз", "результативных прогноза", "результативных прогнозов")} подряд.`,
      });
    }
    if (cold) {
      facts.push({
        id: `cold:${cold.uid}`,
        emoji: "🥶",
        category: "streak",
        weight: 40 + cold.n * 2,
        text: `${name(cold.uid)} мажет: ${cold.n} ${plural(cold.n, "промах", "промаха", "промахов")} подряд.`,
      });
    }
  }

  // ── 9. Король БИНГО (из таблицы) ──
  {
    const bk = leaderboard
      .filter((r) => r.user_id && (r.bingo_count ?? 0) >= 2)
      .sort((a, b) => (b.bingo_count ?? 0) - (a.bingo_count ?? 0))[0];
    if (bk) {
      const n = bk.bingo_count ?? 0;
      facts.push({
        id: `bingoking:${bk.user_id}`,
        emoji: "💎",
        category: "leaderboard",
        weight: 50,
        text: `Король БИНГО — ${bk.username ?? "?"}: ${n} ${plural(n, "точный счёт", "точных счёта", "точных счетов")}.`,
      });
    }
  }

  // ── 10. Матч, который не угадал никто / угадали все ──
  {
    for (const [mid, ps] of Object.entries(byMatch)) {
      const m = matchById[mid];
      if (!m || m.status !== "finished") continue;
      const scored = ps.filter((p) => p.points != null);
      if (scored.length < 3) continue;
      const sc = `${m.home_score}:${m.away_score}`;
      if (scored.every((p) => (p.points ?? 0) === 0)) {
        facts.push({
          id: `nobody:${mid}`,
          emoji: "🃏",
          category: "consensus",
          weight: 52,
          text: `Матч ${m.home_team} — ${m.away_team} (${sc}) не угадал никто из ${scored.length}.`,
        });
      } else if (scored.every((p) => p.outcome_type === "bingo")) {
        facts.push({
          id: `allbingo:${mid}`,
          emoji: "🤯",
          category: "consensus",
          weight: 64,
          text: `Точный счёт ${sc} в матче ${m.home_team} — ${m.away_team} угадали все ${scored.length}!`,
        });
      }
    }
  }

  // ── 11. Гонка в таблице ──
  {
    const sorted = leaderboard
      .filter((r) => r.user_id)
      .map((r) => ({ name: r.username ?? "?", pts: r.total_points ?? 0 }))
      .sort((a, b) => b.pts - a.pts);
    if (sorted.length >= 2 && sorted[0].pts > 0) {
      const gap = sorted[0].pts - sorted[1].pts;
      if (gap === 0) {
        facts.push({
          id: "tie-top",
          emoji: "⚔️",
          category: "leaderboard",
          weight: 58,
          text: `На вершине ничья: ${sorted[0].name} и ${sorted[1].name} идут очко в очко (${sorted[0].pts}).`,
        });
      } else if (gap <= 3) {
        facts.push({
          id: "tight-race",
          emoji: "📈",
          category: "leaderboard",
          weight: 50,
          text: `Гонка плотная: ${sorted[0].name} впереди всего на ${gap} ${plural(gap, "очко", "очка", "очков")}.`,
        });
      } else if (gap >= 10) {
        facts.push({
          id: "runaway",
          emoji: "🚀",
          category: "leaderboard",
          weight: 48,
          text: `${sorted[0].name} оторвался: +${gap} ${plural(gap, "очко", "очка", "очков")} от второго места.`,
        });
      }
    }
  }

  return diversify(facts);
}

/**
 * Сортирует по весу, затем «раскладывает» по категориям round-robin, чтобы в
 * ленте споттлайта подряд не шли однотипные факты.
 */
function diversify(facts: FunFact[]): FunFact[] {
  const buckets = new Map<FactCategory, FunFact[]>();
  for (const f of [...facts].sort((a, b) => b.weight - a.weight)) {
    (buckets.get(f.category) ?? buckets.set(f.category, []).get(f.category)!).push(f);
  }
  // Категории в порядке их лучшего факта.
  const order = [...buckets.entries()].sort((a, b) => b[1][0].weight - a[1][0].weight);
  const out: FunFact[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const [, list] of order) {
      const f = list.shift();
      if (f) {
        out.push(f);
        added = true;
      }
    }
  }
  return out;
}
