import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import confetti from "canvas-confetti";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { Match, Prediction, LeaderboardRow } from "@/lib/types";
import {
  outcomeBadge,
  STAGE_LABELS,
  bettingOpensAt,
  formatRemaining,
  MAX_POINTS_PER_MATCH,
} from "@/lib/scoring";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Crown, Lock, Save, Users, Clock, Timer, AlertTriangle, Target } from "lucide-react";
import { toast } from "sonner";
import { TeamDisplay } from "@/components/TeamDisplay";
import { FinishedScore } from "@/components/FinishedScore";

export const Route = createFileRoute("/_authenticated/predictions")({ component: PredictionsPage });

interface OtherPrediction {
  id: string;
  match_id: string;
  user_id: string;
  home_score: number;
  away_score: number;
  outcome_type: string | null;
  points: number | null;
  profiles: { username: string; car: string | null } | null;
}

function PredictionsPage() {
  const { user } = useAuth();
  const [matches, setMatches] = useState<Match[]>([]);
  const [preds, setPreds] = useState<Record<string, Prediction>>({});
  const [otherPreds, setOtherPreds] = useState<Record<string, OtherPrediction[]>>({});
  const [allPreds, setAllPreds] = useState<Record<string, OtherPrediction[]>>({});
  const [draft, setDraft] = useState<Record<string, { h: string; a: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [leaderIds, setLeaderIds] = useState<Set<string>>(new Set());
  const [isLeader, setIsLeader] = useState(false);
  const [lateBetting, setLateBetting] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [quick, setQuick] = useState<"all" | "today" | "todo">("all");
  const [bucket, setBucket] = useState("all");

  // Тикаем каждую секунду — для живого обратного отсчёта на карточках.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  async function reload() {
    if (!user) return;
    const [{ data: ms }, { data: allPs }, { data: lb }, { data: profs }, { data: setting }] =
      await Promise.all([
        supabase.from("matches").select("*").order("kickoff"),
        supabase
          .from("predictions")
          .select("id, match_id, user_id, home_score, away_score, outcome_type, points"),
        supabase.from("leaderboard").select("*"),
        supabase.from("profiles").select("id, username, car"),
        supabase
          .from("app_settings")
          .select("bool_value")
          .eq("key", "late_betting_enabled")
          .maybeSingle(),
      ]);

    setMatches((ms ?? []) as Match[]);
    setLateBetting(Boolean(setting?.bool_value));

    // No FK from predictions.user_id -> profiles.id, so join profiles in JS.
    const profMap: Record<string, { username: string; car: string | null }> = {};
    for (const pr of (profs ?? []) as { id: string; username: string; car: string | null }[]) {
      profMap[pr.id] = { username: pr.username, car: pr.car };
    }

    const myMap: Record<string, Prediction> = {};
    const drafts: Record<string, { h: string; a: string }> = {};
    const opMap: Record<string, OtherPrediction[]> = {};
    const apMap: Record<string, OtherPrediction[]> = {};
    for (const raw of (allPs ?? []) as unknown as OtherPrediction[]) {
      const p: OtherPrediction = { ...raw, profiles: profMap[raw.user_id] ?? null };
      apMap[p.match_id] ??= [];
      apMap[p.match_id].push(p);
      if (p.user_id === user.id) {
        myMap[p.match_id] = p as unknown as Prediction;
        drafts[p.match_id] = { h: String(p.home_score), a: String(p.away_score) };
      } else {
        opMap[p.match_id] ??= [];
        opMap[p.match_id].push(p);
      }
    }
    setPreds(myMap);
    setDraft((d) => ({ ...drafts, ...d }));
    setOtherPreds(opMap);
    setAllPreds(apMap);
    // Сколько всего участников реально играет (поставил хоть один прогноз).
    setParticipantCount(new Set((allPs ?? []).map((p) => p.user_id)).size);

    const rows = (lb ?? []) as LeaderboardRow[];
    const maxPts = rows.reduce((mx, r) => Math.max(mx, r.total_points ?? 0), 0);
    if (maxPts > 0) {
      const leaders = rows.filter((r) => (r.total_points ?? 0) === maxPts);
      const ids = new Set(leaders.map((l) => l.user_id!).filter(Boolean));
      setLeaderIds(ids);
      setIsLeader(ids.has(user.id));
    } else {
      setLeaderIds(new Set());
      setIsLeader(true);
    }
  }
  useEffect(() => {
    reload();
  }, [user]);

  // Live-refresh when the admin opens/closes the late-betting window.
  useEffect(() => {
    const ch = supabase
      .channel("app_settings_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, () =>
        reload(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /** Betting window: opens at 00:00 the day before the match day, closes at kickoff */
  function canBet(m: Match): { allowed: boolean; reason?: string } {
    const kickoff = new Date(m.kickoff).getTime();
    const now = Date.now();
    if (m.status !== "scheduled" || now >= kickoff) {
      // Match has started/finished — only the admin's late-betting window unlocks it,
      // and only for players who haven't placed a prediction yet.
      if (lateBetting) return { allowed: true };
      return { allowed: false, reason: "Матч начался" };
    }
    const opensAtMs = bettingOpensAt(m.kickoff);
    if (now < opensAtMs) {
      const opensAt = new Date(opensAtMs);
      const dateStr = opensAt.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
      return { allowed: false, reason: `Откроется ${dateStr}` };
    }
    if (isLeader) return { allowed: true };
    const leaderArray = Array.from(leaderIds);
    if (leaderArray.length === 0) return { allowed: true };
    const leaderPredictions = (otherPreds[m.id] ?? []).filter((p) => leaderIds.has(p.user_id));
    const allLeadersBet = leaderArray.every(
      (lid) =>
        leaderPredictions.some((p) => p.user_id === lid) ||
        (preds[m.id] as unknown as OtherPrediction)?.user_id === lid,
    );
    if (!allLeadersBet) return { allowed: false, reason: "Ждём прогноза лидера" };
    return { allowed: true };
  }

  async function save(m: Match) {
    if (!user) return;
    // A saved prediction is final — it can't be edited.
    if (preds[m.id]) return toast.error("Прогноз уже сохранён, изменить нельзя");
    const { allowed, reason } = canBet(m);
    if (!allowed) return toast.error(reason ?? "Нельзя ставить прогноз");
    const d = draft[m.id];
    if (!d || d.h === "" || d.a === "") return toast.error("Введите счёт");
    const h = Number(d.h),
      a = Number(d.a);
    if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0)
      return toast.error("Некорректный счёт");
    if (
      !confirm(
        `Сохранить прогноз ${m.home_team} ${h}:${a} ${m.away_team}? Изменить его потом будет нельзя.`,
      )
    )
      return;
    setBusy(m.id);
    const { error } = await supabase
      .from("predictions")
      .insert({ user_id: user.id, match_id: m.id, home_score: h, away_score: a });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Прогноз сохранён");
    reload();
  }

  const future = matches.filter(
    (m) => new Date(m.kickoff).getTime() > now && m.status === "scheduled",
  );
  // Завершённые: свежие матчи сверху, самые первые — внизу.
  const past = matches
    .filter((m) => m.status === "finished" || new Date(m.kickoff).getTime() <= now)
    .sort((a, b) => new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime());
  // Вкладка «Участников»: свежие сверху, и матч показываем только когда все
  // участники уже сделали прогноз (чтобы нельзя было подсмотреть и списать).
  // Начавшиеся/завершённые матчи раскрываем всегда — ставить уже поздно.
  const participantsMatches = [...matches]
    .filter((m) => {
      if (m.status !== "scheduled") return true;
      const preds = allPreds[m.id] ?? [];
      return participantCount > 0 && preds.length >= participantCount;
    })
    .sort((a, b) => new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime());

  // ── Напоминалки и потенциальные очки ──
  const matchById: Record<string, Match> = {};
  for (const m of matches) matchById[m.id] = m;
  const openUnbet = future.filter((m) => canBet(m).allowed && !preds[m.id]);
  const pendingMine = Object.keys(preds).filter(
    (mid) => matchById[mid] && matchById[mid].status !== "finished",
  ).length;
  const potentialMax = pendingMine * MAX_POINTS_PER_MATCH;

  // ── Фильтры вкладки «Будущие» ──
  const bucketKey = (m: Match) =>
    m.stage === "group" ? `group:${m.group_name}` : `stage:${m.stage}`;
  const bucketLabel = (m: Match) =>
    m.stage === "group" ? `Группа ${m.group_name}` : STAGE_LABELS[m.stage];
  const bucketOptions = Array.from(new Map(future.map((m) => [bucketKey(m), bucketLabel(m)])));
  const isToday = (iso: string) => {
    const d = new Date(iso);
    const n = new Date(now);
    return (
      d.getFullYear() === n.getFullYear() &&
      d.getMonth() === n.getMonth() &&
      d.getDate() === n.getDate()
    );
  };
  const visibleFuture = future.filter((m) => {
    if (bucket !== "all" && bucketKey(m) !== bucket) return false;
    if (quick === "today" && !isToday(m.kickoff)) return false;
    if (quick === "todo" && !(canBet(m).allowed && !preds[m.id])) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Мои прогнозы</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Сохранённый прогноз изменить нельзя. Окно открывается за 2 дня до дня матча и закрывается
          с началом матча.
          {leaderIds.size > 0 && !isLeader && (
            <span className="ml-2 text-gold">👑 Лидер ставит первым</span>
          )}
          {isLeader && leaderIds.size > 0 && (
            <span className="ml-2 text-gold">👑 Вы лидер — ставьте первым!</span>
          )}
        </p>
      </div>

      {(openUnbet.length > 0 || potentialMax > 0) && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-gold/40 bg-gold/5 p-4">
          {openUnbet.length > 0 && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-gold">
              <AlertTriangle className="size-4" />
              Ты ещё не поставил на {openUnbet.length}{" "}
              {plural(openUnbet.length, "открытый матч", "открытых матча", "открытых матчей")}!
            </span>
          )}
          {potentialMax > 0 && (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Target className="size-4 text-primary" />
              На кону ещё до <span className="font-semibold text-foreground">
                {potentialMax}
              </span>{" "}
              {plural(potentialMax, "очка", "очков", "очков")} ({pendingMine}{" "}
              {plural(pendingMine, "активный прогноз", "активных прогноза", "активных прогнозов")})
            </span>
          )}
        </div>
      )}

      {lateBetting && (
        <div className="rounded-xl border border-primary/40 bg-primary/10 p-4 flex items-start gap-3">
          <Clock className="size-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold text-primary">Открыты поздние ставки</div>
            <p className="text-muted-foreground text-xs mt-0.5">
              Можно поставить прогноз на уже начавшиеся и завершённые матчи, если вы ещё не ставили.
              Прогноз на завершённый матч сразу учитывается в очках. Окно закроется, когда админ его
              выключит.
            </p>
          </div>
        </div>
      )}

      <Tabs defaultValue="mine">
        <TabsList className="grid w-full grid-cols-2 max-w-sm mb-2">
          <TabsTrigger value="mine">Мои прогнозы</TabsTrigger>
          <TabsTrigger value="participants" className="flex items-center gap-1.5">
            <Users className="size-4" />
            Участников
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mine">
          <Tabs defaultValue="future">
            <TabsList className="grid w-full grid-cols-2 max-w-md">
              <TabsTrigger value="future">Будущие ({future.length})</TabsTrigger>
              <TabsTrigger value="past">Завершённые ({past.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="future" className="space-y-3 mt-4">
              {future.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      ["all", "Все"],
                      ["today", "Сегодня"],
                      ["todo", "Без прогноза"],
                    ] as const
                  ).map(([v, l]) => (
                    <button
                      key={v}
                      onClick={() => setQuick(v)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        quick === v
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary hover:bg-accent"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                  {bucketOptions.length > 1 && (
                    <select
                      value={bucket}
                      onChange={(e) => setBucket(e.target.value)}
                      className="h-7 rounded-full border border-input bg-background px-2 text-xs"
                    >
                      <option value="all">Все этапы</option>
                      {bucketOptions.map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {visibleFuture.length} из {future.length}
                  </span>
                </div>
              )}
              {visibleFuture.length === 0 && (
                <Empty
                  text={
                    future.length === 0
                      ? "Нет предстоящих матчей."
                      : "Ничего не найдено по фильтру."
                  }
                />
              )}
              {visibleFuture.map((m) => {
                const d = draft[m.id] ?? { h: "", a: "" };
                const saved = !!preds[m.id];
                const { allowed, reason } = canBet(m);
                const editable = allowed && !saved;
                const others = otherPreds[m.id] ?? [];
                return (
                  <div
                    key={m.id}
                    className={`rounded-xl border bg-card p-4 shadow-card ${
                      editable ? "border-gold/50 ring-1 ring-inset ring-gold/25" : "border-border"
                    }`}
                  >
                    <div className="text-xs text-muted-foreground mb-2 flex justify-between">
                      <span>
                        {new Date(m.kickoff).toLocaleString("ru-RU", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="text-gold">
                        {STAGE_LABELS[m.stage]}
                        {m.group_name ? ` · Группа ${m.group_name}` : ""}
                      </span>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 sm:gap-3">
                      <TeamDisplay flag={m.home_flag} name={m.home_team} />
                      <div className="flex items-center gap-1.5 sm:gap-2 self-center pt-1">
                        <Input
                          className="size-12 sm:size-14 rounded-lg border-2 border-primary/50 bg-background text-center text-xl font-bold tabular-nums shadow-sm focus-visible:border-primary focus-visible:ring-2 disabled:border-border disabled:bg-muted/40"
                          inputMode="numeric"
                          placeholder="–"
                          value={d.h}
                          disabled={!editable}
                          onChange={(e) =>
                            setDraft((s) => ({
                              ...s,
                              [m.id]: { ...d, h: e.target.value.replace(/\D/g, "") },
                            }))
                          }
                        />
                        <span className="text-lg font-bold text-muted-foreground">:</span>
                        <Input
                          className="size-12 sm:size-14 rounded-lg border-2 border-primary/50 bg-background text-center text-xl font-bold tabular-nums shadow-sm focus-visible:border-primary focus-visible:ring-2 disabled:border-border disabled:bg-muted/40"
                          inputMode="numeric"
                          placeholder="–"
                          value={d.a}
                          disabled={!editable}
                          onChange={(e) =>
                            setDraft((s) => ({
                              ...s,
                              [m.id]: { ...d, a: e.target.value.replace(/\D/g, "") },
                            }))
                          }
                        />
                      </div>
                      <TeamDisplay flag={m.away_flag} name={m.away_team} />
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      {saved ? (
                        <span className="text-xs flex items-center gap-1 text-primary font-medium">
                          <Lock className="size-3" />
                          Прогноз сохранён — изменить нельзя
                        </span>
                      ) : !allowed ? (
                        <span className="text-xs flex items-center gap-1 text-gold">
                          <Crown className="size-3" />
                          {reason}
                        </span>
                      ) : (
                        <span className="text-xs flex items-center gap-1 text-primary font-medium">
                          <Timer className="size-3" />
                          до закрытия: {formatRemaining(new Date(m.kickoff).getTime() - now)}
                        </span>
                      )}
                      {!saved && (
                        <Button
                          size="sm"
                          onClick={() => save(m)}
                          disabled={busy === m.id || !editable}
                        >
                          <Save className="size-3.5 mr-1" />
                          Сохранить
                        </Button>
                      )}
                    </div>
                    {/* Others' predictions */}
                    {others.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border/50">
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-2">
                          <Users className="size-3" />
                          Прогнозы участников
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {others.map((op) => (
                            <div
                              key={op.id}
                              className="flex items-center gap-1 text-xs bg-secondary rounded-md px-2 py-1"
                            >
                              {leaderIds.has(op.user_id) && <Crown className="size-3 text-gold" />}
                              <span className="font-medium">{op.profiles?.username ?? "?"}</span>
                              <span className="tabular-nums text-muted-foreground">
                                {op.home_score}:{op.away_score}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </TabsContent>

            <TabsContent value="past" className="space-y-3 mt-4">
              {past.length === 0 && <Empty text="Завершённых матчей пока нет." />}
              {past.map((m) => {
                const p = preds[m.id];
                const b = outcomeBadge(p?.outcome_type ?? null);
                const others = otherPreds[m.id] ?? [];
                const d = draft[m.id] ?? { h: "", a: "" };
                const canLateBet = !p && canBet(m).allowed;
                return (
                  <div
                    key={m.id}
                    className="rounded-xl border border-border bg-card p-4 shadow-card"
                  >
                    <div className="text-xs text-muted-foreground mb-3 flex justify-between">
                      <span>
                        {new Date(m.kickoff).toLocaleString("ru-RU", {
                          day: "2-digit",
                          month: "short",
                        })}
                        {m.group_name ? ` · Гр. ${m.group_name}` : ""}
                      </span>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Lock className="size-3" />
                        Закрыт
                      </span>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 sm:gap-3">
                      <TeamDisplay flag={m.home_flag} name={m.home_team} size="sm" />
                      <div className="text-center self-center">
                        <div className="text-xl font-bold">
                          {m.status === "finished" ? (
                            <FinishedScore m={m} />
                          ) : (
                            <span className="tabular-nums whitespace-nowrap">—:—</span>
                          )}
                        </div>
                        {p && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            мой прогноз {p.home_score}:{p.away_score}
                          </div>
                        )}
                      </div>
                      <TeamDisplay flag={m.away_flag} name={m.away_team} size="sm" />
                    </div>
                    {p && m.status === "finished" && (
                      <div className="mt-3 flex justify-center items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${b.color}`}>
                          {b.label}
                        </span>
                        <span className="text-sm font-bold text-gold">+{p.points ?? 0}</span>
                      </div>
                    )}
                    {canLateBet && (
                      <div className="mt-3 pt-3 border-t border-border/50">
                        <div className="flex items-center justify-center gap-1.5 text-[11px] text-primary font-medium mb-2">
                          <Clock className="size-3" />
                          Поздняя ставка — изменить потом нельзя
                        </div>
                        <div className="flex items-center justify-center gap-2">
                          <Input
                            className="size-11 rounded-lg border-2 border-primary/50 bg-background text-center text-lg font-bold tabular-nums"
                            inputMode="numeric"
                            placeholder="–"
                            value={d.h}
                            onChange={(e) =>
                              setDraft((s) => ({
                                ...s,
                                [m.id]: { ...d, h: e.target.value.replace(/\D/g, "") },
                              }))
                            }
                          />
                          <span className="text-lg font-bold text-muted-foreground">:</span>
                          <Input
                            className="size-11 rounded-lg border-2 border-primary/50 bg-background text-center text-lg font-bold tabular-nums"
                            inputMode="numeric"
                            placeholder="–"
                            value={d.a}
                            onChange={(e) =>
                              setDraft((s) => ({
                                ...s,
                                [m.id]: { ...d, a: e.target.value.replace(/\D/g, "") },
                              }))
                            }
                          />
                          <Button size="sm" onClick={() => save(m)} disabled={busy === m.id}>
                            <Save className="size-3.5 mr-1" />
                            Сохранить
                          </Button>
                        </div>
                      </div>
                    )}
                    {!p && !canLateBet && (
                      <div className="text-center text-xs text-muted-foreground mt-3">
                        Прогноз не сделан
                      </div>
                    )}
                    {others.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border/50">
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-2">
                          <Users className="size-3" />
                          Прогнозы других участников
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {others.map((op) => {
                            const ob = outcomeBadge(op.outcome_type ?? null);
                            return (
                              <div
                                key={op.id}
                                className="flex items-center gap-1.5 text-xs bg-secondary rounded-md px-2 py-1"
                              >
                                <span className="font-medium">{op.profiles?.username ?? "?"}</span>
                                <span className="tabular-nums">
                                  {op.home_score}:{op.away_score}
                                </span>
                                {op.outcome_type && (
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ob.color}`}
                                  >
                                    {ob.label}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* ── PARTICIPANTS TAB ── */}
        <TabsContent value="participants" className="space-y-3 mt-4">
          {participantsMatches.length === 0 && (
            <Empty
              text={
                matches.length === 0
                  ? "Матчей пока нет."
                  : "Пока нет матчей, где все участники уже сделали прогноз. Откроются, как только закроются ставки или каждый поставит свой счёт."
              }
            />
          )}
          {participantsMatches.map((m) => {
            const participants = allPreds[m.id] ?? [];
            const isFinished = m.status === "finished";
            return (
              <div key={m.id} className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="text-xs text-muted-foreground mb-3 flex justify-between">
                  <span>
                    {new Date(m.kickoff).toLocaleString("ru-RU", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="text-gold">
                    {m.group_name ? `Группа ${m.group_name}` : STAGE_LABELS[m.stage]}
                  </span>
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 sm:gap-4 mb-3">
                  <TeamDisplay flag={m.home_flag} name={m.home_team} size="sm" />
                  <div className="text-center shrink-0 self-center">
                    {isFinished ? (
                      <FinishedScore m={m} className="text-xl font-bold" />
                    ) : (
                      <span className="text-muted-foreground font-bold text-sm">vs</span>
                    )}
                  </div>
                  <TeamDisplay flag={m.away_flag} name={m.away_team} size="sm" />
                </div>
                {participants.length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground py-2">
                    Прогнозов пока нет
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {[...participants]
                      .sort((a, b) =>
                        (a.profiles?.username ?? "").localeCompare(b.profiles?.username ?? ""),
                      )
                      .map((op) => {
                        const ob = outcomeBadge(op.outcome_type ?? null);
                        const isMe = op.user_id === user?.id;
                        return (
                          <div
                            key={op.id}
                            className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${isMe ? "bg-primary/10 border border-primary/20" : "bg-secondary/50"}`}
                          >
                            <div className="flex items-center gap-2">
                              {leaderIds.has(op.user_id) && (
                                <Crown className="size-3.5 text-gold" />
                              )}
                              <span className="font-medium">
                                {op.profiles?.username ?? "?"}
                                {isMe ? " (я)" : ""}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="tabular-nums font-bold">
                                {op.home_score}:{op.away_score}
                              </span>
                              {op.outcome_type && (
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ob.color}`}
                                >
                                  {ob.label}
                                </span>
                              )}
                              {op.points !== null && isFinished && (
                                <span className="text-gold text-xs font-bold">+{op.points}</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        </TabsContent>
      </Tabs>

      <ConfettiOnBingo preds={preds} />
    </div>
  );
}

/** Русское склонение: 1 матч, 2 матча, 5 матчей. */
function plural(n: number, one: string, few: string, many: string): string {
  const nn = Math.abs(n) % 100;
  const n1 = nn % 10;
  if (nn > 10 && nn < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}

function Empty({ text }: { text: string }) {
  return (
    <div className="text-center text-muted-foreground py-12 border border-dashed border-border rounded-xl">
      {text}
    </div>
  );
}

function ConfettiOnBingo({ preds }: { preds: Record<string, Prediction> }) {
  const [seen, setSeen] = useState<Set<string>>(new Set());
  useEffect(() => {
    for (const id in preds) {
      if (preds[id].outcome_type === "bingo" && !seen.has(id)) {
        confetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.6 },
          colors: ["#facc15", "#22c55e", "#3b82f6"],
        });
        setSeen((s) => new Set(s).add(id));
        break;
      }
    }
  }, [preds, seen]);
  return null;
}
