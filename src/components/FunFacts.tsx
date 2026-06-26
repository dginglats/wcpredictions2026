import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { BracketData } from "@/lib/bracket";
import {
  buildFunFacts,
  type FunFact,
  type FactMatch,
  type FactPrediction,
  type FactBracket,
  type FactLbRow,
} from "@/lib/funFacts";
import { Sparkles, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Карточка-споттлайт «Интересные факты»: один крупный факт с авто-сменой,
 * ручным листанием и разворачиваемым списком всех фактов. Сама грузит данные и
 * подписывается на изменения, поэтому её можно вставить в любую вкладку.
 */
export function FunFacts() {
  const [facts, setFacts] = useState<FunFact[]>([]);
  const [idx, setIdx] = useState(0);
  const [expanded, setExpanded] = useState(false);

  async function load() {
    const [{ data: ms }, { data: ps }, { data: brs }, { data: profs }, { data: lb }] =
      await Promise.all([
        supabase
          .from("matches")
          .select(
            "id, kickoff, status, home_team, away_team, home_score, away_score, stage, group_name",
          ),
        supabase
          .from("predictions")
          .select("user_id, match_id, home_score, away_score, outcome_type, points"),
        supabase.from("bracket_predictions").select("user_id, data"),
        supabase.from("profiles").select("id, username"),
        supabase.from("leaderboard").select("user_id, username, total_points, bingo_count"),
      ]);

    const nameOf: Record<string, string> = {};
    for (const p of (profs ?? []) as { id: string; username: string }[]) nameOf[p.id] = p.username;

    const brackets: FactBracket[] = ((brs ?? []) as { user_id: string; data: unknown }[]).map(
      (b) => ({ user_id: b.user_id, data: b.data as BracketData }),
    );

    const next = buildFunFacts({
      matches: (ms ?? []) as unknown as FactMatch[],
      predictions: (ps ?? []) as unknown as FactPrediction[],
      brackets,
      leaderboard: (lb ?? []) as unknown as FactLbRow[],
      nameOf,
    });
    setFacts(next);
    setIdx((i) => (next.length ? i % next.length : 0));
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel("funfacts-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "bracket_predictions" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  // Авто-смена факта каждые 6 секунд (пока список не развёрнут).
  useEffect(() => {
    if (expanded || facts.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % facts.length), 6000);
    return () => clearInterval(t);
  }, [expanded, facts.length]);

  if (facts.length === 0) return null;
  const pos = idx % facts.length;
  const cur = facts[pos];
  const go = (d: number) => setIdx((i) => (i + d + facts.length) % facts.length);

  return (
    <section className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-4 shadow-card sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Sparkles className="size-4" />
          Интересный факт
        </div>
        {facts.length > 1 && facts.length <= 8 && (
          <div className="flex items-center gap-1">
            {facts.map((f, i) => (
              <button
                key={f.id}
                onClick={() => setIdx(i)}
                aria-label={`Факт ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === pos
                    ? "w-4 bg-primary"
                    : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60"
                }`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex min-h-[3.5rem] items-start gap-3">
        <span className="shrink-0 text-3xl leading-none">{cur.emoji}</span>
        <p className="text-sm font-medium leading-snug sm:text-base">{cur.text}</p>
      </div>

      <div className="mt-3 flex items-center justify-between">
        {facts.length > 1 ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => go(-1)}
              aria-label="Предыдущий факт"
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
              {pos + 1} / {facts.length}
            </span>
            <button
              onClick={() => go(1)}
              aria-label="Следующий факт"
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        ) : (
          <span />
        )}
        {facts.length > 1 && (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-xs font-medium text-primary hover:underline"
          >
            {expanded ? "свернуть" : `показать все (${facts.length})`}
          </button>
        )}
      </div>

      {expanded && (
        <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto border-t border-border/50 pt-3">
          {facts.map((f, i) => (
            <li key={f.id}>
              <button
                onClick={() => {
                  setIdx(i);
                  setExpanded(false);
                }}
                className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/50 ${
                  i === pos ? "bg-accent/40" : ""
                }`}
              >
                <span className="shrink-0 text-base leading-none">{f.emoji}</span>
                <span className="text-muted-foreground">{f.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
