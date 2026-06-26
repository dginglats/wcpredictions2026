import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { LeaderboardRow } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import { Crown, Download, Trophy, Flame, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FunFacts } from "@/components/FunFacts";
import { movementByUser, type DayPred } from "@/lib/standings";
import { computeAchievements, type AchPrediction } from "@/lib/achievements";
import type { BracketData } from "@/lib/bracket";

export const Route = createFileRoute("/_authenticated/leaderboard")({ component: LeaderboardPage });

/** Прогноз с полями для формы/серии/ачивок/движения. */
interface PredRow {
  user_id: string;
  match_id: string;
  home_score: number;
  away_score: number;
  points: number | null;
  outcome_type: string | null;
  matches: { kickoff: string; status: string } | null;
}

/** Цвет точки формы по типу результата. */
const FORM_COLOR: Record<string, string> = {
  bingo: "bg-gold",
  outcome: "bg-pitch",
  draw: "bg-primary",
  miss: "bg-destructive",
};

function LeaderboardPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [preds, setPreds] = useState<PredRow[]>([]);
  const [champions, setChampions] = useState<Array<{ user_id: string; champion: string }>>([]);

  async function load() {
    const [{ data }, { data: ps }, { data: brs }] = await Promise.all([
      supabase.from("leaderboard").select("*"),
      supabase
        .from("predictions")
        .select(
          "user_id, match_id, home_score, away_score, points, outcome_type, matches!inner(kickoff, status)",
        ),
      supabase.from("bracket_predictions").select("user_id, data"),
    ]);
    const sorted = [...((data ?? []) as LeaderboardRow[])].sort(
      (a, b) =>
        (b.total_points ?? 0) - (a.total_points ?? 0) ||
        (b.bingo_count ?? 0) - (a.bingo_count ?? 0) ||
        (a.username ?? "").localeCompare(b.username ?? ""),
    );
    setRows(sorted);
    setPreds((ps ?? []) as unknown as PredRow[]);
    setChampions(
      ((brs ?? []) as { user_id: string; data: unknown }[]).map((b) => ({
        user_id: b.user_id,
        champion: (b.data as BracketData)?.final ?? "",
      })),
    );
  }
  useEffect(() => {
    load();
    const ch = supabase
      .channel("lb-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "bracket_predictions" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  // ── Производные данные по игрокам: форма (последние 5), серия, кол-во прогнозов ──
  const madeBy: Record<string, number> = {};
  const finishedBy: Record<
    string,
    Array<{ kickoff: number; points: number; outcome: string | null }>
  > = {};
  for (const p of preds) {
    madeBy[p.user_id] = (madeBy[p.user_id] ?? 0) + 1;
    if (p.matches?.status === "finished" && p.points != null) {
      (finishedBy[p.user_id] ??= []).push({
        kickoff: new Date(p.matches.kickoff).getTime(),
        points: p.points,
        outcome: p.outcome_type,
      });
    }
  }
  const formBy: Record<string, string[]> = {};
  const streakBy: Record<string, number> = {};
  for (const [uid, list] of Object.entries(finishedBy)) {
    list.sort((a, b) => a.kickoff - b.kickoff);
    formBy[uid] = list.slice(-5).map((x) => x.outcome ?? "miss");
    let s = 0;
    for (let i = list.length - 1; i >= 0 && list[i].points > 0; i--) s++;
    streakBy[uid] = s;
  }

  // Движение мест со вчерашнего игрового дня.
  const dayPreds: DayPred[] = [];
  for (const [uid, list] of Object.entries(finishedBy)) {
    for (const x of list)
      dayPreds.push({
        user_id: uid,
        kickoff: x.kickoff,
        points: x.points,
        bingo: x.outcome === "bingo",
      });
  }
  const movementBy = movementByUser(dayPreds);

  // Ачивки игроков.
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

  // rank with ties
  const ranks: number[] = [];
  rows.forEach((r, i) => {
    if (i === 0) ranks.push(1);
    else {
      const prev = rows[i - 1];
      if (
        (r.total_points ?? 0) === (prev.total_points ?? 0) &&
        (r.bingo_count ?? 0) === (prev.bingo_count ?? 0)
      )
        ranks.push(ranks[i - 1]);
      else ranks.push(i + 1);
    }
  });
  const leaders = rows.filter((_, i) => ranks[i] === 1);
  const topPoints = rows[0]?.total_points ?? 0;

  function exportCsv() {
    const headers = [
      "Место",
      "Игрок",
      "Машина",
      "Очки",
      "Отрыв",
      "БИНГО",
      "Ничьи",
      "Исходы",
      "Промахи",
      "Прогнозов",
      "%",
    ];
    const lines = rows.map((r, i) =>
      [
        ranks[i],
        r.username,
        r.car ?? "",
        r.total_points,
        topPoints - (r.total_points ?? 0),
        r.bingo_count,
        r.draw_count,
        r.outcome_count,
        r.miss_count,
        madeBy[r.user_id ?? ""] ?? 0,
        r.success_rate,
      ].join(","),
    );
    const csv = "﻿" + [headers.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "leaderboard.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Trophy className="size-7 text-gold" />
            Турнирная таблица
          </h1>
          {leaders.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              👑 Лидер{leaders.length > 1 ? "ы" : ""}:{" "}
              <span className="text-gold font-semibold">
                {leaders.map((l) => l.username).join(", ")}
              </span>{" "}
              · должен публиковать прогнозы первым.
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="size-4 mr-2" />
          CSV
        </Button>
      </div>

      <FunFacts />

      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-secondary-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-3 text-left">Место</th>
                <th className="px-3 py-3 text-left">Игрок</th>
                <th className="px-3 py-3 text-center hidden md:table-cell">Форма</th>
                <th className="px-3 py-3 text-left hidden lg:table-cell">Машина</th>
                <th className="px-3 py-3 text-right">Очки</th>
                <th className="px-3 py-3 text-right">БИНГО</th>
                <th className="px-3 py-3 text-right hidden sm:table-cell">Ничьи</th>
                <th className="px-3 py-3 text-right hidden sm:table-cell">Исходы</th>
                <th className="px-3 py-3 text-right hidden lg:table-cell">Прогн.</th>
                <th className="px-3 py-3 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const rank = ranks[i];
                const isLeader = rank === 1;
                const isTop3 = rank <= 3;
                const isMe = r.user_id === user?.id;
                const gap = topPoints - (r.total_points ?? 0);
                const streak = streakBy[r.user_id ?? ""] ?? 0;
                const form = formBy[r.user_id ?? ""] ?? [];
                const move = movementBy[r.user_id ?? ""] ?? 0;
                const badges = achByUser[r.user_id ?? ""] ?? [];
                return (
                  <tr
                    key={r.user_id}
                    className={`border-t transition-all ${
                      isMe
                        ? "bg-primary/10 ring-1 ring-inset ring-primary/40 border-primary/30"
                        : isLeader
                          ? "bg-gold/10 border-border"
                          : isTop3
                            ? "bg-accent/40 border-border"
                            : "border-border"
                    }`}
                  >
                    <td className="px-3 py-3 font-bold">
                      <div className="flex items-center gap-1">
                        {isLeader && <Crown className="size-4 text-gold" />}
                        <span className={isLeader ? "text-gold" : isTop3 ? "text-primary" : ""}>
                          {rank}
                        </span>
                        {move > 0 && (
                          <span
                            title={`Поднялся на ${move}`}
                            className="inline-flex items-center text-[10px] font-bold text-pitch"
                          >
                            <ArrowUp className="size-3" />
                            {move}
                          </span>
                        )}
                        {move < 0 && (
                          <span
                            title={`Опустился на ${-move}`}
                            className="inline-flex items-center text-[10px] font-bold text-destructive"
                          >
                            <ArrowDown className="size-3" />
                            {-move}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-semibold">
                      <div className="flex items-center gap-1.5">
                        <span>
                          {r.username}
                          {isMe ? " (я)" : ""}
                        </span>
                        {streak >= 2 && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-bold text-orange-500">
                            <Flame className="size-3" />
                            {streak}
                          </span>
                        )}
                        {badges.length > 0 && (
                          <span className="flex items-center gap-0.5">
                            {badges.slice(0, 3).map((b) => (
                              <span
                                key={b.id}
                                title={`${b.title}: ${b.desc}`}
                                className="text-sm leading-none"
                              >
                                {b.emoji}
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      <div className="flex items-center justify-center gap-1">
                        {form.length === 0 ? (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        ) : (
                          form.map((o, j) => (
                            <span
                              key={j}
                              title={o}
                              className={`size-2.5 rounded-full ${FORM_COLOR[o] ?? "bg-muted"}`}
                            />
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-gold text-xs hidden lg:table-cell">
                      {r.car ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="font-bold tabular-nums text-lg leading-none">
                        {r.total_points}
                      </div>
                      {gap > 0 && (
                        <div className="text-[10px] text-muted-foreground tabular-nums">−{gap}</div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <span className="inline-flex items-center justify-center min-w-7 px-2 py-0.5 rounded-md bg-gold/20 text-gold font-bold">
                        {r.bingo_count}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums hidden sm:table-cell">
                      {r.draw_count}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums hidden sm:table-cell">
                      {r.outcome_count}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground hidden lg:table-cell">
                      {madeBy[r.user_id ?? ""] ?? 0}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {r.success_rate}%
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-muted-foreground">
                    Пока пусто.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Легенда формы */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
        <span className="font-medium">Форма:</span>
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-full bg-gold" /> БИНГО
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-full bg-pitch" /> Исход
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-full bg-primary" /> Ничья
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-full bg-destructive" /> Промах
        </span>
        <span className="flex items-center gap-1">
          <Flame className="size-3 text-orange-500" /> — серия результативных
        </span>
        <span className="flex items-center gap-1">
          <ArrowUp className="size-3 text-pitch" />
          <ArrowDown className="size-3 text-destructive" /> — движение места со вчера
        </span>
        <span className="ml-auto">Эмодзи у имени — ачивки (наведи, чтобы прочитать)</span>
      </div>
    </div>
  );
}
