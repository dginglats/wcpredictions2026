import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { Match, Prediction } from "@/lib/types";
import { STAGE_LABELS, bettingState, bettingOpensAt, formatRemaining } from "@/lib/scoring";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Search,
  MapPin,
  Calendar,
  Lock,
  Unlock,
  Hourglass,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import { Countdown } from "@/components/Countdown";
import { TeamDisplay } from "@/components/TeamDisplay";

export const Route = createFileRoute("/_authenticated/schedule")({ component: SchedulePage });

/** Re-renders the subtree once per second so countdowns/badges stay live. */
function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(d: Date) {
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  const base = cap(
    d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }),
  );
  if (dayKey(d) === dayKey(today)) return `Сегодня · ${base}`;
  if (dayKey(d) === dayKey(tomorrow)) return `Завтра · ${base}`;
  return base;
}

function groupByDay(list: Match[]) {
  const groups: { key: string; date: Date; items: Match[] }[] = [];
  const index: Record<string, number> = {};
  for (const m of list) {
    const d = new Date(m.kickoff);
    const k = dayKey(d);
    if (index[k] === undefined) {
      index[k] = groups.length;
      groups.push({ key: k, date: d, items: [] });
    }
    groups[index[k]].items.push(m);
  }
  return groups;
}

function SchedulePage() {
  const { user } = useAuth();
  const [matches, setMatches] = useState<Match[]>([]);
  const [preds, setPreds] = useState<Record<string, Prediction>>({});
  const [predCounts, setPredCounts] = useState<Record<string, { bingo: number; outcome: number }>>(
    {},
  );
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<string>("all");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("matches")
        .select("*")
        .order("kickoff", { ascending: true });
      setMatches((data ?? []) as Match[]);
      if (user) {
        const { data: ps } = await supabase.from("predictions").select("*").eq("user_id", user.id);
        const map: Record<string, Prediction> = {};
        for (const p of (ps ?? []) as Prediction[]) map[p.match_id] = p;
        setPreds(map);
      }
      const { data: allp } = await supabase.from("predictions").select("match_id,outcome_type");
      const counts: Record<string, { bingo: number; outcome: number }> = {};
      for (const p of (allp ?? []) as { match_id: string; outcome_type: string | null }[]) {
        counts[p.match_id] ??= { bingo: 0, outcome: 0 };
        if (p.outcome_type === "bingo") counts[p.match_id].bingo++;
        if (p.outcome_type === "bingo" || p.outcome_type === "outcome" || p.outcome_type === "draw")
          counts[p.match_id].outcome++;
      }
      setPredCounts(counts);
    })();

    const ch = supabase
      .channel("matches-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, async () => {
        const { data } = await supabase
          .from("matches")
          .select("*")
          .order("kickoff", { ascending: true });
        setMatches((data ?? []) as Match[]);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  const filtered = useMemo(
    () =>
      matches.filter(
        (m) =>
          (stage === "all" || m.stage === stage) &&
          (q === "" ||
            (m.home_team + m.away_team + (m.group_name ?? ""))
              .toLowerCase()
              .includes(q.toLowerCase())),
      ),
    [matches, q, stage],
  );

  const now = Date.now();
  const upcoming = filtered.filter(
    (m) => m.status !== "finished" && new Date(m.kickoff).getTime() > now,
  );
  const today = filtered.filter((m) => {
    const d = new Date(m.kickoff);
    return d.toDateString() === new Date().toDateString() || m.status === "live";
  });
  const finished = filtered.filter((m) => m.status === "finished");

  const remaining = matches.filter((m) => m.status !== "finished").length;

  // Featured match: prefer a live one, else the genuine next kickoff (ignores filters).
  const featured = useMemo(() => {
    const live = matches.find((m) => m.status === "live");
    if (live) return live;
    return matches
      .filter((m) => m.status === "scheduled" && new Date(m.kickoff).getTime() > now)
      .sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime())[0];
  }, [matches, now]);

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-2xl bg-hero border border-border p-6 md:p-8">
        <div className="absolute inset-0 pitch-lines opacity-20" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <div className="text-xs uppercase tracking-widest text-gold mb-2">
              До финала ЧМ-2026
            </div>
            <Countdown />
            <div className="text-xs text-muted-foreground mt-3">
              Осталось матчей: <span className="text-foreground font-semibold">{remaining}</span> ·
              Всего: {matches.length}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              Призовой фонд
            </div>
            <div className="text-4xl md:text-5xl font-bold text-gradient-gold">100 €</div>
          </div>
        </div>
      </section>

      {featured && <FeaturedMatch m={featured} pred={preds[featured.id]} />}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Поиск команды или группы..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">Все стадии</option>
          {Object.entries(STAGE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <Tabs defaultValue="upcoming">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="upcoming" className="text-xs sm:text-sm px-1 sm:px-3">
            Ближайшие ({upcoming.length})
          </TabsTrigger>
          <TabsTrigger value="today" className="text-xs sm:text-sm px-1 sm:px-3">
            Сегодня ({today.length})
          </TabsTrigger>
          <TabsTrigger value="finished" className="text-xs sm:text-sm px-1 sm:px-3">
            Завершённые ({finished.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming" className="mt-4">
          <DayGroupedList list={upcoming} preds={preds} predCounts={predCounts} userId={user?.id} />
        </TabsContent>
        <TabsContent value="today" className="mt-4">
          <DayGroupedList list={today} preds={preds} predCounts={predCounts} userId={user?.id} />
        </TabsContent>
        <TabsContent value="finished" className="mt-4">
          <DayGroupedList
            list={finished}
            preds={preds}
            predCounts={predCounts}
            userId={user?.id}
            reverse
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DayGroupedList({
  list,
  preds,
  predCounts,
  userId,
  reverse = false,
}: {
  list: Match[];
  preds: Record<string, Prediction>;
  predCounts: Record<string, { bingo: number; outcome: number }>;
  userId?: string;
  reverse?: boolean;
}) {
  if (list.length === 0) return <Empty />;
  const ordered = reverse ? [...list].reverse() : list;
  const groups = groupByDay(ordered);
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.key} className="space-y-3">
          <div className="sticky top-0 z-10 flex items-center gap-2 bg-background/80 backdrop-blur py-1">
            <Calendar className="size-3.5 text-gold shrink-0" />
            <span className="text-sm font-semibold">{dayLabel(g.date)}</span>
            <span className="text-xs text-muted-foreground">
              · {g.items.length} {g.items.length === 1 ? "матч" : "матчей"}
            </span>
            <div className="flex-1 h-px bg-border ml-1" />
          </div>
          {g.items.map((m) => (
            <MatchCard
              key={m.id}
              m={m}
              pred={preds[m.id]}
              counts={predCounts[m.id]}
              hasUser={!!userId}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Live betting-deadline badge for a match card. */
function DeadlineBadge({ m }: { m: Match }) {
  const now = useNow(1000);
  if (m.status === "finished" || m.status === "live") return null;
  const state = bettingState(m.kickoff, m.status, now);

  if (state === "closed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <Lock className="size-3" />
        Приём закрыт
      </span>
    );
  }
  if (state === "not_open") {
    const opens = new Date(bettingOpensAt(m.kickoff));
    const dateStr = opens.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <Unlock className="size-3" />
        Откроется {dateStr}
      </span>
    );
  }
  // open — count down to kickoff
  const ms = new Date(m.kickoff).getTime() - now;
  const urgent = ms < 3 * 60 * 60 * 1000; // < 3h
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        urgent ? "bg-destructive/15 text-destructive animate-pulse" : "bg-gold/15 text-gold"
      }`}
    >
      <Hourglass className="size-3" />
      Закроется через {formatRemaining(ms)}
    </span>
  );
}

function Empty() {
  return (
    <div className="text-center text-muted-foreground py-16 border border-dashed border-border rounded-xl">
      Матчей пока нет. Админ может добавить расписание.
    </div>
  );
}

function FeaturedMatch({ m, pred }: { m: Match; pred?: Prediction }) {
  const now = useNow(1000);
  const isLive = m.status === "live";
  const state = bettingState(m.kickoff, m.status, now);
  const ms = new Date(m.kickoff).getTime() - now;
  const date = new Date(m.kickoff);

  const boxes = (() => {
    if (ms <= 0) return null;
    const s = Math.floor(ms / 1000);
    return [
      { v: Math.floor(s / 86400), l: "дн" },
      { v: Math.floor((s % 86400) / 3600), l: "ч" },
      { v: Math.floor((s % 3600) / 60), l: "мин" },
      { v: s % 60, l: "сек" },
    ];
  })();

  const canBetNow = state === "open" && !pred;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-primary/40 bg-card shadow-glow">
      <div className="absolute inset-0 pitch-lines opacity-10" />
      <div className="relative p-5 md:p-7">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs uppercase tracking-widest text-gold flex items-center gap-2">
            {isLive ? (
              <>
                <span className="size-2 rounded-full bg-primary animate-pulse" />
                Идёт сейчас
              </>
            ) : (
              <>★ Следующий матч</>
            )}
          </div>
          <span className="text-xs text-gold">
            {STAGE_LABELS[m.stage]}
            {m.group_name ? ` · Группа ${m.group_name}` : ""}
          </span>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 md:gap-6">
          <TeamDisplay flag={m.home_flag} name={m.home_team} />
          <div className="self-center text-center">
            {isLive ? (
              <div className="text-3xl md:text-5xl font-bold tabular-nums text-gradient-gold whitespace-nowrap">
                {m.home_score}:{m.away_score}
              </div>
            ) : (
              <div className="text-2xl md:text-3xl font-bold text-muted-foreground">vs</div>
            )}
          </div>
          <TeamDisplay flag={m.away_flag} name={m.away_team} />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-4">
          <span className="flex items-center gap-1">
            <Calendar className="size-3" />
            {date.toLocaleString("ru-RU", {
              weekday: "short",
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {(m.stadium || m.city) && (
            <span className="flex items-center gap-1">
              <MapPin className="size-3" />
              {[m.stadium, m.city].filter(Boolean).join(", ")}
            </span>
          )}
        </div>

        {!isLive && boxes && (
          <div className="flex items-center justify-center gap-2 md:gap-3 mt-4">
            {boxes.map((b, i) => (
              <div
                key={i}
                className="bg-background/60 backdrop-blur border border-border rounded-lg px-2.5 py-1.5 min-w-12 text-center"
              >
                <div className="text-lg md:text-xl font-bold text-foreground tabular-nums">
                  {String(b.v).padStart(2, "0")}
                </div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  {b.l}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col items-center gap-2 mt-5">
          {pred ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Твой прогноз:</span>
              <span className="font-bold tabular-nums text-gold">
                {pred.home_score}:{pred.away_score}
              </span>
            </div>
          ) : canBetNow ? (
            <Link
              to="/predictions"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow transition hover:opacity-90"
            >
              Сделать прогноз
              <ArrowRight className="size-4" />
            </Link>
          ) : (
            <DeadlineBadge m={m} />
          )}
        </div>
      </div>
    </section>
  );
}

function MatchCard({
  m,
  pred,
  counts,
  hasUser,
}: {
  m: Match;
  pred?: Prediction;
  counts?: { bingo: number; outcome: number };
  hasUser?: boolean;
}) {
  const date = new Date(m.kickoff);
  const isFinished = m.status === "finished";
  const isLive = m.status === "live";
  const bettingOpen = bettingState(m.kickoff, m.status) === "open";
  const needsPrediction = hasUser && !pred && bettingOpen;
  return (
    <div
      className={`relative rounded-xl border bg-card shadow-card overflow-hidden ${isLive ? "border-primary shadow-glow" : needsPrediction ? "border-gold/50" : "border-border"}`}
    >
      {isLive && (
        <div className="absolute top-2 right-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary">
          <span className="size-2 rounded-full bg-primary animate-pulse" />
          LIVE
        </div>
      )}
      <div className="p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground mb-3">
          <span className="flex items-center gap-1">
            <Calendar className="size-3 shrink-0" />
            {date.toLocaleString("ru-RU", {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {m.group_name && (
            <span className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
              Группа {m.group_name}
            </span>
          )}
          <span className="ml-auto text-gold">{STAGE_LABELS[m.stage]}</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 sm:gap-4">
          <TeamDisplay flag={m.home_flag} name={m.home_team} />
          <div className="self-center px-1">
            {isFinished ? (
              <div className="text-2xl sm:text-3xl md:text-4xl font-bold tabular-nums text-gradient-gold whitespace-nowrap">
                {m.home_score}:{m.away_score}
              </div>
            ) : (
              <div className="text-xl sm:text-2xl font-bold text-muted-foreground">vs</div>
            )}
          </div>
          <TeamDisplay flag={m.away_flag} name={m.away_team} />
        </div>
        {(m.stadium || m.city) && (
          <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mt-3">
            <MapPin className="size-3" /> {[m.stadium, m.city].filter(Boolean).join(", ")}
          </div>
        )}

        {/* Betting deadline + "not predicted yet" call-to-action */}
        {!isFinished && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <DeadlineBadge m={m} />
            {needsPrediction && (
              <Link
                to="/predictions"
                className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-semibold text-gold transition hover:bg-gold/25"
              >
                <AlertCircle className="size-3" />
                Ты ещё не поставил
                <ArrowRight className="size-3" />
              </Link>
            )}
          </div>
        )}

        {pred && (
          <div className="mt-3 flex items-center justify-center gap-2 text-xs">
            <span className="text-muted-foreground">Твой прогноз:</span>
            <span className="font-bold tabular-nums">
              {pred.home_score}:{pred.away_score}
            </span>
            {pred.points !== null && (
              <span className="px-2 py-0.5 rounded bg-gold text-gold-foreground font-bold">
                +{pred.points}
              </span>
            )}
          </div>
        )}
        {isFinished && counts && (
          <div className="mt-3 flex justify-center gap-4 text-[11px] text-muted-foreground">
            <span>
              🎯 БИНГО: <b className="text-gold">{counts.bingo}</b>
            </span>
            <span>
              ✓ Угадали исход: <b className="text-primary">{counts.outcome}</b>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
