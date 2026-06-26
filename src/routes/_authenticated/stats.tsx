import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { LeaderboardRow } from "@/lib/types";
import { STAGE_LABELS } from "@/lib/scoring";
import { FunFacts } from "@/components/FunFacts";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
  Legend,
  LineChart,
  Line,
  Cell,
  LabelList,
} from "recharts";
import { carEmblemDot } from "@/components/CarEmblem";
import { Medal, ThumbsUp, Skull } from "lucide-react";

export const Route = createFileRoute("/_authenticated/stats")({ component: StatsPage });

const PLAYER_COLORS = [
  "#22c55e",
  "#facc15",
  "#3b82f6",
  "#f97316",
  "#a855f7",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
];
const STAGE_ORDER = [
  "group",
  "round_of_32",
  "round_of_16",
  "quarter_final",
  "semi_final",
  "third_place",
  "final",
];

interface PredAgg {
  user_id: string;
  username: string;
  points: number;
  bingo: number;
  outcome: number;
  draw: number;
  miss: number;
  rate: number;
}
interface PredRow {
  user_id: string;
  match_id: string;
  home_score: number;
  away_score: number;
  outcome_type: string | null;
  points: number | null;
}
interface MatchRow {
  id: string;
  kickoff: string;
  status: string;
  stage: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
}

function StatsPage() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [preds, setPreds] = useState<PredRow[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [nameOf, setNameOf] = useState<Record<string, string>>({});

  async function load() {
    const [{ data }, { data: ps }, { data: ms }, { data: profs }] = await Promise.all([
      supabase.from("leaderboard").select("*"),
      supabase
        .from("predictions")
        .select("user_id, match_id, home_score, away_score, outcome_type, points"),
      supabase
        .from("matches")
        .select("id, kickoff, status, stage, home_team, away_team, home_score, away_score"),
      supabase.from("profiles").select("id, username"),
    ]);
    const sorted = [...((data ?? []) as LeaderboardRow[])].sort(
      (a, b) => (b.total_points ?? 0) - (a.total_points ?? 0),
    );
    setRows(sorted);
    setPreds((ps ?? []) as unknown as PredRow[]);
    setMatches((ms ?? []) as unknown as MatchRow[]);
    const names: Record<string, string> = {};
    for (const pr of (profs ?? []) as { id: string; username: string }[])
      names[pr.id] = pr.username;
    setNameOf(names);
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel("stats-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const matchById: Record<string, MatchRow> = {};
  for (const m of matches) matchById[m.id] = m;
  const predsByMatch: Record<string, PredRow[]> = {};
  for (const p of preds) (predsByMatch[p.match_id] ??= []).push(p);

  const barData: PredAgg[] = rows.map((r) => ({
    user_id: r.user_id ?? "",
    username: r.username ?? "?",
    points: r.total_points ?? 0,
    bingo: r.bingo_count ?? 0,
    outcome: r.outcome_count ?? 0,
    draw: r.draw_count ?? 0,
    miss: r.miss_count ?? 0,
    rate: Number(r.success_rate ?? 0),
  }));

  // ── Рост очков по дням (накопительно) ──
  const scoredFinished = preds
    .filter((p) => matchById[p.match_id]?.status === "finished" && p.points != null)
    .map((p) => ({ ...p, kickoff: matchById[p.match_id].kickoff }))
    .sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());
  const seriesUsers = Array.from(new Set(scoredFinished.map((p) => nameOf[p.user_id] ?? "?")));
  const dayMap: Record<string, Record<string, number>> = {};
  const running: Record<string, number> = {};
  for (const p of scoredFinished) {
    const day = new Date(p.kickoff).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
    const u = nameOf[p.user_id] ?? "?";
    running[u] = (running[u] ?? 0) + (p.points ?? 0);
    dayMap[day] ??= {};
    dayMap[day][u] = running[u];
    for (const usr of seriesUsers) if (!(usr in dayMap[day])) dayMap[day][usr] = running[usr] ?? 0;
  }
  const series: Array<Record<string, string | number>> = Object.entries(dayMap).map(
    ([day, vals]) => ({ day, ...vals }),
  );

  // ── Точность по стадиям ──
  const stageAgg: Record<string, { hits: number; total: number }> = {};
  for (const p of preds) {
    const m = matchById[p.match_id];
    if (!m || m.status !== "finished" || p.outcome_type == null) continue;
    const a = (stageAgg[m.stage] ??= { hits: 0, total: 0 });
    a.total++;
    if (p.outcome_type !== "miss") a.hits++;
  }
  const stageData = STAGE_ORDER.filter((s) => stageAgg[s]?.total).map((s) => ({
    stage: STAGE_LABELS[s] ?? s,
    rate: Math.round((stageAgg[s].hits / stageAgg[s].total) * 100),
  }));

  // ── Победитель дня ──
  const dayAgg: Record<string, { time: number; perUser: Record<string, number> }> = {};
  for (const p of preds) {
    const m = matchById[p.match_id];
    if (!m || m.status !== "finished" || p.points == null) continue;
    const d = new Date(m.kickoff);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const agg = (dayAgg[String(dayStart)] ??= { time: dayStart, perUser: {} });
    agg.perUser[p.user_id] = (agg.perUser[p.user_id] ?? 0) + p.points;
  }
  const dayWinners = Object.values(dayAgg)
    .map(({ time, perUser }) => {
      const max = Math.max(0, ...Object.values(perUser));
      const winners = Object.entries(perUser)
        .filter(([, v]) => v === max)
        .map(([uid]) => nameOf[uid] ?? "?");
      return {
        time,
        label: new Date(time).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }),
        winners,
        points: max,
      };
    })
    .filter((d) => d.points > 0)
    .sort((a, b) => b.time - a.time);

  // ── Самые предсказуемые / сенсационные матчи ──
  const matchAgg = matches
    .filter((m) => m.status === "finished")
    .map((m) => {
      const ps = (predsByMatch[m.id] ?? []).filter((p) => p.points != null);
      const hits = ps.filter((p) => p.outcome_type !== "miss").length;
      const bingos = ps.filter((p) => p.outcome_type === "bingo").length;
      return { m, count: ps.length, hits, bingos, rate: ps.length ? hits / ps.length : 0 };
    })
    .filter((x) => x.count >= 1);
  const predictable = [...matchAgg]
    .sort((a, b) => b.rate - a.rate || b.bingos - a.bingos)
    .slice(0, 3);
  const surprising = [...matchAgg]
    .sort((a, b) => a.rate - b.rate || a.bingos - b.bingos)
    .slice(0, 3);

  // ── Топ предсказанных счётов ──
  const scoreCount: Record<string, number> = {};
  for (const p of preds) {
    const k = `${p.home_score}:${p.away_score}`;
    scoreCount[k] = (scoreCount[k] ?? 0) + 1;
  }
  const topScores = Object.entries(scoreCount)
    .map(([score, n]) => ({ score, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);

  // ── Прогресс турнира ──
  const totalMatches = matches.length;
  const finishedMatches = matches.filter((m) => m.status === "finished").length;
  const pct = totalMatches ? Math.round((finishedMatches / totalMatches) * 100) : 0;
  const pointsAwarded = preds.reduce(
    (s, p) => s + (matchById[p.match_id]?.status === "finished" ? (p.points ?? 0) : 0),
    0,
  );

  const card = "rounded-xl border border-border bg-card p-5 shadow-card";
  const tooltipStyle = { background: "#1e293b", border: "1px solid #334155", borderRadius: 8 };

  const matchLabel = (m: MatchRow) =>
    `${m.home_team} ${m.home_score}:${m.away_score} ${m.away_team}`;

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Статистика</h1>

      <FunFacts />

      {/* Прогресс турнира */}
      {totalMatches > 0 && (
        <section className={card}>
          <h2 className="font-semibold mb-4">Прогресс турнира</h2>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <Stat label="Сыграно матчей" value={`${finishedMatches} / ${totalMatches}`} />
            <Stat label="Очков разыграно" value={String(pointsAwarded)} />
            <Stat label="Осталось матчей" value={String(totalMatches - finishedMatches)} />
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-gold transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1.5 text-right text-xs text-muted-foreground tabular-nums">
            {pct}% турнира позади
          </div>
        </section>
      )}

      {/* 1. Рост очков по дням */}
      {series.length > 0 && (
        <section className={card}>
          <h2 className="font-semibold mb-4">Рост очков по дням</h2>
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 16, right: 34, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                {rows.map((r, i) => {
                  const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
                  const renderDot = (p: {
                    cx?: number;
                    cy?: number;
                    index?: number;
                    key?: string;
                  }) => {
                    const { cx, cy, index, key } = p;
                    if (cx == null || cy == null) return <g key={key} />;
                    if (index === series.length - 1)
                      return carEmblemDot(r.car, color, cx, cy, 28, key);
                    return <circle key={key} cx={cx} cy={cy} r={2.5} fill={color} />;
                  };
                  return (
                    <Line
                      key={r.user_id ?? i}
                      type="monotone"
                      dataKey={r.username ?? "?"}
                      stroke={color}
                      strokeWidth={2.5}
                      dot={renderDot}
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* 2. Очки игроков */}
      {barData.length > 0 && (
        <section className={card}>
          <h2 className="font-semibold mb-4">Очки игроков</h2>
          <div style={{ height: Math.max(200, barData.length * 52) }}>
            <ResponsiveContainer>
              <BarChart
                data={barData}
                layout="vertical"
                margin={{ left: 8, right: 48, top: 4, bottom: 4 }}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="username"
                  width={90}
                  tick={{ fill: "#e2e8f0", fontSize: 12, fontWeight: 600 }}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number) => [`${v} очков`, "Очки"]}
                />
                <Bar dataKey="points" radius={[0, 6, 6, 0]} maxBarSize={32}>
                  <LabelList dataKey="points" position="right" fill="#9ca3af" fontSize={12} />
                  {barData.map((_, i) => (
                    <Cell key={i} fill={PLAYER_COLORS[i % PLAYER_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* 3. Точность по стадиям */}
      {stageData.length > 0 && (
        <section className={card}>
          <h2 className="font-semibold mb-1">Точность по стадиям</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Доля прогнозов с очками (исход/ничья/БИНГО) на каждой стадии.
          </p>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={stageData} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis
                  dataKey="stage"
                  tick={{ fill: "#9ca3af", fontSize: 10 }}
                  interval={0}
                  angle={-15}
                  textAnchor="end"
                  height={50}
                />
                <YAxis
                  type="number"
                  domain={[0, 100]}
                  unit="%"
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number) => [`${v}%`, "Точность"]}
                />
                <Bar dataKey="rate" radius={[6, 6, 0, 0]} maxBarSize={48} fill="#22c55e">
                  <LabelList
                    dataKey="rate"
                    position="top"
                    fill="#9ca3af"
                    fontSize={11}
                    formatter={(v: number) => `${v}%`}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* 4. Победитель дня */}
      {dayWinners.length > 0 && (
        <section className={card}>
          <h2 className="font-semibold mb-1 flex items-center gap-2">
            <Medal className="size-5 text-gold" />
            Победитель дня
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            Кто набрал больше всех очков в каждый игровой день.
          </p>
          <div className="space-y-1.5">
            {dayWinners.map((d) => (
              <div
                key={d.time}
                className="flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-2 text-sm"
              >
                <span className="text-muted-foreground tabular-nums">{d.label}</span>
                <span className="flex items-center gap-2 font-medium">
                  🥇 {d.winners.join(", ")}
                  <span className="text-gold font-bold">+{d.points}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 5. Разбивка по типам результата */}
      {barData.length > 0 && (
        <section className={card}>
          <h2 className="font-semibold mb-4">Разбивка по типам результата</h2>
          <div style={{ height: Math.max(220, barData.length * 52) }}>
            <ResponsiveContainer>
              <BarChart
                data={barData}
                layout="vertical"
                margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="username"
                  width={90}
                  tick={{ fill: "#e2e8f0", fontSize: 12, fontWeight: 600 }}
                />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Bar dataKey="bingo" name="БИНГО" stackId="a" fill="#facc15" maxBarSize={28} />
                <Bar dataKey="draw" name="Ничья" stackId="a" fill="#3b82f6" maxBarSize={28} />
                <Bar dataKey="outcome" name="Исход" stackId="a" fill="#22c55e" maxBarSize={28} />
                <Bar
                  dataKey="miss"
                  name="Промах"
                  stackId="a"
                  fill="#ef4444"
                  maxBarSize={28}
                  radius={[0, 6, 6, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* 6. Процент успешных прогнозов */}
      {barData.length > 0 && (
        <section className={card}>
          <h2 className="font-semibold mb-4">Процент успешных прогнозов</h2>
          <div style={{ height: Math.max(200, barData.length * 52) }}>
            <ResponsiveContainer>
              <BarChart
                data={barData}
                layout="vertical"
                margin={{ left: 8, right: 56, top: 4, bottom: 4 }}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  unit="%"
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                />
                <YAxis
                  type="category"
                  dataKey="username"
                  width={90}
                  tick={{ fill: "#e2e8f0", fontSize: 12, fontWeight: 600 }}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number) => [`${v}%`, "Успех"]}
                />
                <Bar dataKey="rate" radius={[0, 6, 6, 0]} maxBarSize={32}>
                  <LabelList
                    dataKey="rate"
                    position="right"
                    fill="#9ca3af"
                    fontSize={12}
                    formatter={(v: number) => `${v}%`}
                  />
                  {barData.map((_, i) => (
                    <Cell
                      key={i}
                      fill={PLAYER_COLORS[i % PLAYER_COLORS.length]}
                      fillOpacity={0.8}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* 7. Топ предсказанных счётов */}
      {topScores.length > 0 && (
        <section className={card}>
          <h2 className="font-semibold mb-1">Любимые счёты</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Какие счёты участники прогнозируют чаще всего.
          </p>
          <div style={{ height: Math.max(180, topScores.length * 34) }}>
            <ResponsiveContainer>
              <BarChart
                data={topScores}
                layout="vertical"
                margin={{ left: 8, right: 40, top: 4, bottom: 4 }}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                />
                <YAxis
                  type="category"
                  dataKey="score"
                  width={48}
                  tick={{ fill: "#e2e8f0", fontSize: 13, fontWeight: 700 }}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number) => [`${v} раз`, "Поставили"]}
                />
                <Bar dataKey="n" radius={[0, 6, 6, 0]} maxBarSize={26} fill="#06b6d4">
                  <LabelList dataKey="n" position="right" fill="#9ca3af" fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* 8. Народные / провальные матчи */}
      {matchAgg.length > 0 && (
        <section className={card}>
          <h2 className="font-semibold mb-4">Народные и сенсационные матчи</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-pitch">
                <ThumbsUp className="size-4" />
                Угадали почти все
              </div>
              <div className="space-y-1.5">
                {predictable.map(({ m, hits, count }) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 px-3 py-2 text-sm"
                  >
                    <span className="truncate">{matchLabel(m)}</span>
                    <span className="shrink-0 text-xs text-pitch font-semibold tabular-nums">
                      {hits}/{count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-destructive">
                <Skull className="size-4" />
                Сенсации (мало кто угадал)
              </div>
              <div className="space-y-1.5">
                {surprising.map(({ m, hits, count }) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 px-3 py-2 text-sm"
                  >
                    <span className="truncate">{matchLabel(m)}</span>
                    <span className="shrink-0 text-xs text-destructive font-semibold tabular-nums">
                      {hits}/{count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {barData.length === 0 && series.length === 0 && totalMatches === 0 && (
        <div className="text-center text-muted-foreground py-20 border border-dashed border-border rounded-xl">
          Статистика появится после первых сыгранных матчей
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/50 px-3 py-3 text-center">
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
