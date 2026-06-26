import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CARS } from "@/lib/scoring";
import type { LeaderboardRow } from "@/lib/types";
import type { BracketData } from "@/lib/bracket";
import { rankByDay, type DayPred } from "@/lib/standings";
import { computeAchievements, ACHIEVEMENT_CATALOG, type AchPrediction } from "@/lib/achievements";
import { toast } from "sonner";
import { Crown, Flame } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/_authenticated/profile")({ component: ProfilePage });

interface PredRow {
  user_id: string;
  match_id: string;
  home_score: number;
  away_score: number;
  points: number | null;
  outcome_type: string | null;
  matches: { kickoff: string; status: string } | null;
}

function ProfilePage() {
  const { user, profile, isAdmin, refreshProfile } = useAuth();
  const [username, setUsername] = useState("");
  const [car, setCar] = useState("");
  const [busy, setBusy] = useState(false);

  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [preds, setPreds] = useState<PredRow[]>([]);
  const [champions, setChampions] = useState<Array<{ user_id: string; champion: string }>>([]);

  useEffect(() => {
    if (profile) {
      setUsername(profile.username);
      setCar(profile.car ?? "");
    }
  }, [profile]);

  async function loadStats() {
    const [{ data: lb }, { data: ps }, { data: brs }] = await Promise.all([
      supabase.from("leaderboard").select("*"),
      supabase
        .from("predictions")
        .select(
          "user_id, match_id, home_score, away_score, points, outcome_type, matches!inner(kickoff, status)",
        ),
      supabase.from("bracket_predictions").select("user_id, data"),
    ]);
    setRows((lb ?? []) as LeaderboardRow[]);
    setPreds((ps ?? []) as unknown as PredRow[]);
    setChampions(
      ((brs ?? []) as { user_id: string; data: unknown }[]).map((b) => ({
        user_id: b.user_id,
        champion: (b.data as BracketData)?.final ?? "",
      })),
    );
  }
  useEffect(() => {
    loadStats();
    const ch = supabase
      .channel("profile-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, loadStats)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, loadStats)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  async function save() {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ username, car: car || null })
      .eq("id", user.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Профиль обновлён");
    refreshProfile();
  }

  // ── Моя статистика ──
  const myRow = rows.find((r) => r.user_id === user?.id);
  const myRank = myRow
    ? 1 +
      rows.filter(
        (r) =>
          (r.total_points ?? 0) > (myRow.total_points ?? 0) ||
          ((r.total_points ?? 0) === (myRow.total_points ?? 0) &&
            (r.bingo_count ?? 0) > (myRow.bingo_count ?? 0)),
      ).length
    : null;

  const myPreds = preds.filter((p) => p.user_id === user?.id);
  const myFinished = myPreds
    .filter((p) => p.matches?.status === "finished" && p.points != null)
    .map((p) => ({ kickoff: new Date(p.matches!.kickoff).getTime(), points: p.points as number }))
    .sort((a, b) => a.kickoff - b.kickoff);

  let streak = 0;
  for (let i = myFinished.length - 1; i >= 0 && myFinished[i].points > 0; i--) streak++;

  // Лучший день
  const dayPts: Record<string, number> = {};
  for (const f of myFinished) {
    const d = new Date(f.kickoff);
    const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    dayPts[key] = (dayPts[key] ?? 0) + f.points;
  }
  const bestDay = Object.entries(dayPts).sort((a, b) => b[1] - a[1])[0];

  // Любимый счёт
  const scoreCount: Record<string, number> = {};
  for (const p of myPreds)
    scoreCount[`${p.home_score}:${p.away_score}`] =
      (scoreCount[`${p.home_score}:${p.away_score}`] ?? 0) + 1;
  const favScore = Object.entries(scoreCount).sort((a, b) => b[1] - a[1])[0];

  // История места (мой ранг по дням)
  const dayPreds: DayPred[] = preds
    .filter((p) => p.matches?.status === "finished" && p.points != null)
    .map((p) => ({
      user_id: p.user_id,
      kickoff: new Date(p.matches!.kickoff).getTime(),
      points: p.points as number,
      bingo: p.outcome_type === "bingo",
    }));
  const { days, ranks } = rankByDay(dayPreds);
  const myRankSeries = (user ? ranks[user.id] : undefined) ?? [];
  const rankHistory = days
    .map((d, i) => ({
      day: new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }),
      rank: myRankSeries[i],
    }))
    .filter((x) => x.rank != null);
  const maxRank = Math.max(2, ...myRankSeries);

  // Ачивки
  const achPreds: AchPrediction[] = preds
    .filter((p) => p.matches)
    .map((p) => ({
      user_id: p.user_id,
      home_score: p.home_score,
      away_score: p.away_score,
      outcome_type: p.outcome_type,
      points: p.points,
      kickoff: p.matches!.kickoff,
      status: p.matches!.status,
    }));
  const achByUser = computeAchievements({
    leaderboard: rows,
    predictions: achPreds,
    brackets: champions,
  });
  const myAch = user ? (achByUser[user.id] ?? []) : [];
  const earned = new Map(myAch.map((a) => [a.id, a]));

  const hasStats = myPreds.length > 0;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-3xl font-bold">Профиль</h1>

      {/* Шапка */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-card">
        <div className="flex items-center gap-4">
          <div className="size-16 rounded-full bg-gradient-to-br from-pitch to-primary grid place-items-center text-2xl font-bold">
            {profile?.username?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div>
            <div className="font-semibold flex items-center gap-1">
              {profile?.username}
              {isAdmin && <Crown className="size-4 text-gold" />}
            </div>
            <div className="text-sm text-muted-foreground">{profile?.email}</div>
            {myRank && (
              <div className="mt-1 text-xs text-muted-foreground">
                Место в турнире: <span className="font-semibold text-foreground">#{myRank}</span>
                {myAch.length > 0 && (
                  <span className="ml-2">
                    {myAch.map((a) => (
                      <span key={a.id} title={`${a.title}: ${a.desc}`} className="text-sm">
                        {a.emoji}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Мой турнир в цифрах */}
      {hasStats && (
        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h2 className="font-semibold mb-4">Мой турнир в цифрах</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Место" value={myRank ? `#${myRank}` : "—"} accent />
            <Stat label="Очки" value={String(myRow?.total_points ?? 0)} />
            <Stat label="БИНГО" value={String(myRow?.bingo_count ?? 0)} />
            <Stat label="Успех" value={`${myRow?.success_rate ?? 0}%`} />
            <Stat label="Серия" value={streak >= 2 ? `${streak} 🔥` : String(streak)} />
            <Stat label="Прогнозов" value={String(myPreds.length)} />
            <Stat label="Лучший день" value={bestDay ? `+${bestDay[1]}` : "—"} />
            <Stat label="Любимый счёт" value={favScore ? favScore[0] : "—"} />
          </div>
        </section>
      )}

      {/* История места */}
      {rankHistory.length >= 2 && (
        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h2 className="font-semibold mb-1">История места</h2>
          <p className="text-xs text-muted-foreground mb-4">Чем выше линия — тем выше место.</p>
          <div className="h-48">
            <ResponsiveContainer>
              <LineChart data={rankHistory} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <YAxis
                  reversed
                  domain={[1, maxRank]}
                  allowDecimals={false}
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                  width={28}
                />
                <Tooltip
                  contentStyle={{
                    background: "#1e293b",
                    border: "1px solid #334155",
                    borderRadius: 8,
                  }}
                  formatter={(v: number) => [`#${v}`, "Место"]}
                />
                <Line
                  type="monotone"
                  dataKey="rank"
                  stroke="#facc15"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "#facc15" }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Витрина ачивок */}
      <section className="rounded-xl border border-border bg-card p-5 shadow-card">
        <h2 className="font-semibold mb-1">Ачивки</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Получено: <span className="font-semibold text-foreground">{myAch.length}</span> из{" "}
          {ACHIEVEMENT_CATALOG.length}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {ACHIEVEMENT_CATALOG.map((a) => {
            const got = earned.get(a.id);
            return (
              <div
                key={a.id}
                className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                  got ? "border-gold/40 bg-gold/5" : "border-border bg-secondary/30 opacity-60"
                }`}
              >
                <span className={`text-2xl leading-none ${got ? "" : "grayscale"}`}>{a.emoji}</span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{a.title}</div>
                  <div className="text-xs text-muted-foreground">{got ? got.desc : a.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Настройки */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-card space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Flame className="size-4 text-muted-foreground" />
          Настройки профиля
        </h2>
        <div>
          <Label>Имя пользователя</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div>
          <Label>Машина</Label>
          <select
            value={car}
            onChange={(e) => setCar(e.target.value)}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">— не выбрана —</option>
            {CARS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={save} disabled={busy}>
          Сохранить
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-secondary/50 px-3 py-3 text-center">
      <div className={`text-xl font-bold tabular-nums ${accent ? "text-gold" : ""}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
