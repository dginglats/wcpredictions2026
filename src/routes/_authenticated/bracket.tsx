import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { STAGE_LABELS } from "@/lib/scoring";
import {
  Trophy,
  Medal,
  Lock,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  RotateCcw,
  Users,
  Flag as FlagIcon,
} from "lucide-react";
import {
  GROUP_LETTERS,
  STEP_TITLES,
  emptyBracket,
  thirdPlaceOf,
  stepComplete,
  bracketComplete,
  flagCode,
  computeActualGroups,
  actualBestThirds,
  actualKnockout,
  knockoutWinner,
  r32Matchups,
  r16Matchups,
  qfMatchups,
  sfMatchups,
  finalMatchup,
  thirdMatchup,
  type BracketData,
  type ActualMatch,
  type Standing,
} from "@/lib/bracket";
import { FinishedScore } from "@/components/FinishedScore";

export const Route = createFileRoute("/_authenticated/bracket")({ component: BracketPage });

/** Раунды плей-офф, чьи победители хранятся массивом. */
const KNOCKOUT_AFTER: Record<string, Array<"r16" | "qf" | "sf">> = {
  r32: ["r16", "qf", "sf"],
  r16: ["qf", "sf"],
  qf: ["sf"],
  sf: [],
};

const KO_STAGES = [
  "round_of_32",
  "round_of_16",
  "quarter_final",
  "semi_final",
  "third_place",
  "final",
] as const;

export interface Actual {
  standings: Record<string, Standing[]>;
  done: Record<string, boolean>;
  bestThirds: string[];
  advanced: Record<"r32" | "r16" | "qf" | "sf", Set<string>>;
  champion: string;
  third: string;
}

type ChipFn = (name: string) => React.ReactNode;

/** Картинка флага: emoji/ISO/URL → flagcdn. */
function Flag({ flag }: { flag?: string | null }) {
  const code = flagCode(flag);
  if (!code) return <span className="text-base leading-none">🏳️</span>;
  const isUrl = /^https?:\/\//i.test(code);
  const src = isUrl ? code : `https://flagcdn.com/w40/${code}.png`;
  const srcSet = isUrl
    ? undefined
    : `https://flagcdn.com/w40/${code}.png 1x, https://flagcdn.com/w80/${code}.png 2x`;
  return (
    <img
      src={src}
      srcSet={srcSet}
      alt=""
      loading="lazy"
      className="inline-block h-3.5 w-5 shrink-0 rounded-[2px] border border-border/40 object-cover"
    />
  );
}

interface Participant {
  user_id: string;
  username: string;
  data: BracketData;
  isMe: boolean;
}

function BracketPage() {
  const { user } = useAuth();
  const [groupTeams, setGroupTeams] = useState<Record<string, string[]>>({});
  const [flagOf, setFlagOf] = useState<Record<string, string>>({});
  const [matches, setMatches] = useState<ActualMatch[]>([]);
  const [data, setData] = useState<BracketData>(emptyBracket);
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState<BracketData | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!user) return;
    const [{ data: ms }, { data: brackets }, { data: profs }] = await Promise.all([
      // select("*") — чтобы страница не падала, если миграция с новыми колонками
      // (score_duration / *_et / *_pen) ещё не применена: их просто не будет в
      // ответе, knockoutWinner/FinishedScore корректно обработают undefined.
      supabase.from("matches").select("*"),
      supabase.from("bracket_predictions").select("user_id, data"),
      supabase.from("profiles").select("id, username"),
    ]);

    const teams: Record<string, string[]> = {};
    const flags: Record<string, string> = {};
    const all = (ms ?? []) as Array<
      ActualMatch & { home_flag: string | null; away_flag: string | null }
    >;
    for (const m of all) {
      for (const [name, flag] of [
        [m.home_team, m.home_flag],
        [m.away_team, m.away_flag],
      ] as const) {
        if (flag && !flags[name]) flags[name] = flag;
      }
      if (m.stage === "group" && m.group_name) {
        teams[m.group_name] ??= [];
        for (const name of [m.home_team, m.away_team]) {
          if (!teams[m.group_name].includes(name)) teams[m.group_name].push(name);
        }
      }
    }
    setGroupTeams(teams);
    setFlagOf(flags);
    setMatches(all);

    const nameOf: Record<string, string> = {};
    for (const p of (profs ?? []) as { id: string; username: string }[]) nameOf[p.id] = p.username;
    const list: Participant[] = ((brackets ?? []) as { user_id: string; data: Json }[]).map(
      (b) => ({
        user_id: b.user_id,
        username: nameOf[b.user_id] ?? "?",
        data: b.data as unknown as BracketData,
        isMe: b.user_id === user.id,
      }),
    );
    list.sort((a, b) => (a.isMe ? -1 : b.isMe ? 1 : a.username.localeCompare(b.username)));
    setParticipants(list);
    setSaved(list.find((p) => p.isMe)?.data ?? null);
    setLoading(false);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const actual: Actual = useMemo(() => {
    const { standings, done } = computeActualGroups(matches);
    const ko = actualKnockout(matches);
    return { standings, done, bestThirds: actualBestThirds(standings, done), ...ko };
  }, [matches]);

  const chip: ChipFn = (name) =>
    name ? (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <Flag flag={flagOf[name]} />
        <span className="truncate">{name}</span>
      </span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );

  // ── Группы: тап по команде расставляет места по порядку ──
  function tapGroup(letter: string, team: string) {
    setData((d) => {
      const order = [...(d.groups[letter] ?? [])];
      const idx = order.indexOf(team);
      if (idx >= 0) order.splice(idx);
      else {
        order.push(team);
        const all = groupTeams[letter] ?? [];
        if (order.length === all.length - 1) {
          const last = all.find((t) => !order.includes(t));
          if (last) order.push(last);
        }
      }
      return {
        ...d,
        groups: { ...d.groups, [letter]: order },
        thirds: [],
        r32: [],
        r16: [],
        qf: [],
        sf: [],
        final: "",
        third: "",
      };
    });
  }

  function toggleThird(letter: string) {
    setData((d) => {
      const has = d.thirds.includes(letter);
      let thirds = has ? d.thirds.filter((l) => l !== letter) : [...d.thirds, letter];
      if (thirds.length > 8) return d;
      thirds = GROUP_LETTERS.filter((g) => thirds.includes(g));
      return { ...d, thirds, r32: [], r16: [], qf: [], sf: [], final: "", third: "" };
    });
  }

  function setWinner(roundKey: "r32" | "r16" | "qf" | "sf", index: number, team: string) {
    setData((d) => {
      const arr = [...d[roundKey]];
      arr[index] = team;
      const next: BracketData = { ...d, [roundKey]: arr, final: "", third: "" };
      for (const k of KNOCKOUT_AFTER[roundKey]) next[k] = [];
      return next;
    });
  }

  const canNext = stepComplete(step, data, groupTeams);
  const allDone = bracketComplete(data, groupTeams);

  async function save() {
    if (!user || !allDone) return;
    if (!confirm("Сохранить сетку? Изменить её потом будет нельзя.")) return;
    setBusy(true);
    const { error } = await supabase
      .from("bracket_predictions")
      .insert({ user_id: user.id, data: data as unknown as Json });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Сетка сохранена!");
    reload();
  }

  if (loading) return <div className="text-muted-foreground">Загрузка…</div>;
  if (Object.keys(groupTeams).length === 0)
    return (
      <div className="rounded-xl border border-dashed border-border py-20 text-center text-muted-foreground">
        Группы ещё не заданы — сетка появится, когда добавят матчи группового этапа.
      </div>
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Сетка</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Прогноз всего плей-офф ЧМ-2026: места в группах, 8 лучших третьих мест и победители до
          финала. Сохранить можно один раз.
        </p>
      </div>

      <Tabs defaultValue="mine">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="mine">Моя сетка</TabsTrigger>
          <TabsTrigger value="others" className="flex items-center gap-1.5">
            <Users className="size-4" />
            Участники
          </TabsTrigger>
          <TabsTrigger value="real" className="flex items-center gap-1.5">
            <FlagIcon className="size-4" />
            Реальность
          </TabsTrigger>
        </TabsList>

        {/* ── МОЯ СЕТКА ── */}
        <TabsContent value="mine" className="mt-4">
          {saved ? (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Lock className="size-3.5" />
                Ваша сетка сохранена и не изменяется. Зелёным отмечено угаданное.
              </p>
              <BracketReview data={saved} chip={chip} actual={actual} />
            </div>
          ) : (
            <div className="space-y-6">
              <Stepper step={step} data={data} groupTeams={groupTeams} onJump={setStep} />
              <section className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
                <h2 className="mb-4 flex items-center gap-2 font-semibold">
                  <span className="grid size-6 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {step + 1}
                  </span>
                  {STEP_TITLES[step]}
                </h2>

                {step === 0 && (
                  <GroupsStep
                    groupTeams={groupTeams}
                    data={data}
                    chip={chip}
                    onTap={tapGroup}
                    onReset={(g) =>
                      setData((d) => ({
                        ...d,
                        groups: { ...d.groups, [g]: [] },
                        thirds: [],
                        r32: [],
                        r16: [],
                        qf: [],
                        sf: [],
                        final: "",
                        third: "",
                      }))
                    }
                  />
                )}
                {step === 1 && <ThirdsStep data={data} chip={chip} onToggle={toggleThird} />}
                {step === 2 && (
                  <RoundStep
                    title="Выберите победителей 1/16"
                    matchups={r32Matchups(data)}
                    winners={data.r32}
                    chip={chip}
                    onPick={(i, t) => setWinner("r32", i, t)}
                  />
                )}
                {step === 3 && (
                  <RoundStep
                    title="Выберите победителей 1/8"
                    matchups={r16Matchups(data)}
                    winners={data.r16}
                    chip={chip}
                    onPick={(i, t) => setWinner("r16", i, t)}
                  />
                )}
                {step === 4 && (
                  <RoundStep
                    title="Выберите победителей 1/4"
                    matchups={qfMatchups(data)}
                    winners={data.qf}
                    chip={chip}
                    onPick={(i, t) => setWinner("qf", i, t)}
                  />
                )}
                {step === 5 && (
                  <RoundStep
                    title="Выберите победителей 1/2"
                    matchups={sfMatchups(data)}
                    winners={data.sf}
                    chip={chip}
                    onPick={(i, t) => setWinner("sf", i, t)}
                  />
                )}
                {step === 6 && (
                  <FinalStep
                    data={data}
                    chip={chip}
                    onFinal={(t) => setData((d) => ({ ...d, final: t }))}
                    onThird={(t) => setData((d) => ({ ...d, third: t }))}
                  />
                )}
              </section>

              <div className="flex items-center justify-between gap-3">
                <Button
                  variant="outline"
                  disabled={step === 0}
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                >
                  <ChevronLeft className="mr-1 size-4" />
                  Назад
                </Button>
                {step < STEP_TITLES.length - 1 ? (
                  <Button disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
                    Далее
                    <ChevronRight className="ml-1 size-4" />
                  </Button>
                ) : (
                  <Button disabled={!allDone || busy} onClick={save}>
                    <Lock className="mr-1 size-4" />
                    Сохранить сетку
                  </Button>
                )}
              </div>
              {!canNext && (
                <p className="text-center text-xs text-gold">
                  Заполните этот этап полностью, чтобы продолжить.
                </p>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── УЧАСТНИКИ ── */}
        <TabsContent value="others" className="mt-4">
          <ParticipantsView list={participants} chip={chip} actual={actual} />
        </TabsContent>

        {/* ── РЕАЛЬНОСТЬ ── */}
        <TabsContent value="real" className="mt-4">
          <RealityView actual={actual} matches={matches} chip={chip} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stepper({
  step,
  data,
  groupTeams,
  onJump,
}: {
  step: number;
  data: BracketData;
  groupTeams: Record<string, string[]>;
  onJump: (s: number) => void;
}) {
  const maxReach = (() => {
    let s = 0;
    while (s < STEP_TITLES.length - 1 && stepComplete(s, data, groupTeams)) s++;
    return s;
  })();
  return (
    <div className="flex flex-wrap gap-1.5">
      {STEP_TITLES.map((t, i) => {
        const done = stepComplete(i, data, groupTeams);
        const reachable = i <= maxReach;
        const active = i === step;
        return (
          <button
            key={t}
            disabled={!reachable}
            onClick={() => onJump(i)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "bg-primary text-primary-foreground"
                : reachable
                  ? "bg-secondary hover:bg-accent"
                  : "cursor-not-allowed bg-secondary/40 text-muted-foreground"
            }`}
          >
            <span className="grid size-4 place-items-center rounded-full bg-black/20 text-[10px]">
              {done ? <Check className="size-3" /> : i + 1}
            </span>
            <span className="hidden sm:inline">{t}</span>
          </button>
        );
      })}
    </div>
  );
}

function GroupsStep({
  groupTeams,
  data,
  chip,
  onTap,
  onReset,
}: {
  groupTeams: Record<string, string[]>;
  data: BracketData;
  chip: ChipFn;
  onTap: (g: string, t: string) => void;
  onReset: (g: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="mb-3 text-xs text-muted-foreground">
        Нажимайте команды в порядке мест: 1-е, 2-е, 3-е. Последнее место заполнится само.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {GROUP_LETTERS.map((g) => {
          const teams = groupTeams[g] ?? [];
          const order = data.groups[g] ?? [];
          return (
            <div key={g} className="rounded-lg border border-border bg-background/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">Группа {g}</span>
                {order.length > 0 && (
                  <button
                    onClick={() => onReset(g)}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <RotateCcw className="size-3" />
                    сброс
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {teams.map((t) => {
                  const rank = order.indexOf(t) + 1;
                  return (
                    <button
                      key={t}
                      onClick={() => onTap(g, t)}
                      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                        rank
                          ? "border border-primary/40 bg-primary/15"
                          : "border border-transparent bg-secondary/50 hover:bg-accent"
                      }`}
                    >
                      <span
                        className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${rank ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                      >
                        {rank || "·"}
                      </span>
                      {chip(t)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThirdsStep({
  data,
  chip,
  onToggle,
}: {
  data: BracketData;
  chip: ChipFn;
  onToggle: (g: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Выберите <b>8 из 12</b> третьих мест, которые пройдут в 1/16. Выбрано:{" "}
        <b>{data.thirds.length}/8</b>
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {GROUP_LETTERS.map((g) => {
          const team = thirdPlaceOf(data, g);
          const picked = data.thirds.includes(g);
          const disabled = !picked && data.thirds.length >= 8;
          return (
            <button
              key={g}
              disabled={disabled}
              onClick={() => onToggle(g)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                picked
                  ? "border border-primary/50 bg-primary/15"
                  : disabled
                    ? "cursor-not-allowed border border-transparent bg-secondary/30 text-muted-foreground"
                    : "border border-transparent bg-secondary/50 hover:bg-accent"
              }`}
            >
              <span className="w-12 shrink-0 text-[11px] font-bold text-muted-foreground">
                3-е {g}
              </span>
              {chip(team)}
              {picked && <Check className="ml-auto size-4 shrink-0 text-primary" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RoundStep({
  title,
  matchups,
  winners,
  chip,
  onPick,
}: {
  title: string;
  matchups: Array<[string, string]>;
  winners: string[];
  chip: ChipFn;
  onPick: (i: number, t: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {title}. Нажмите команду, которая проходит дальше.
      </p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {matchups.map((m, i) => (
          <div key={i} className="rounded-lg border border-border bg-background/40 p-2">
            <div className="mb-1.5 px-1 text-[10px] text-muted-foreground">Матч {i + 1}</div>
            <div className="grid grid-cols-2 gap-1.5">
              {[0, 1].map((side) => {
                const team = m[side];
                const picked = winners[i] === team && !!team;
                return (
                  <button
                    key={side}
                    disabled={!team}
                    onClick={() => team && onPick(i, team)}
                    className={`flex items-center gap-1.5 rounded-md px-2 py-2 text-sm transition-colors ${
                      picked
                        ? "bg-primary font-semibold text-primary-foreground"
                        : "bg-secondary/60 hover:bg-accent disabled:opacity-40"
                    }`}
                  >
                    {chip(team)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FinalStep({
  data,
  chip,
  onFinal,
  onThird,
}: {
  data: BracketData;
  chip: ChipFn;
  onFinal: (t: string) => void;
  onThird: (t: string) => void;
}) {
  const fm = finalMatchup(data);
  const tm = thirdMatchup(data);
  const PickRow = ({
    pair,
    value,
    onPick,
    accent,
  }: {
    pair: [string, string];
    value: string;
    onPick: (t: string) => void;
    accent: string;
  }) => (
    <div className="grid grid-cols-2 gap-2">
      {pair.map((team, i) => {
        const picked = value === team && !!team;
        return (
          <button
            key={i}
            disabled={!team}
            onClick={() => team && onPick(team)}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-3 text-sm transition-colors ${picked ? `${accent} font-bold` : "bg-secondary/60 hover:bg-accent disabled:opacity-40"}`}
          >
            {chip(team)}
          </button>
        );
      })}
    </div>
  );
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-center gap-2 font-semibold text-gold">
          <Trophy className="size-5" />
          Финал — выберите чемпиона
        </div>
        <PickRow
          pair={fm}
          value={data.final}
          onPick={onFinal}
          accent="bg-gold text-gold-foreground"
        />
      </div>
      <div>
        <div className="mb-2 flex items-center gap-2 font-semibold">
          <Medal className="size-5 text-amber-700" />
          Матч за 3-е место
        </div>
        <PickRow pair={tm} value={data.third} onPick={onThird} accent="bg-amber-700 text-white" />
      </div>
    </div>
  );
}

/** Иконка ✓/✗ для угадан/не угадан (показывается только когда факт известен). */
function Verdict({ ok }: { ok: boolean | null }) {
  if (ok === null) return null;
  return ok ? (
    <Check className="size-3.5 text-pitch" />
  ) : (
    <X className="size-3.5 text-destructive" />
  );
}

/** Разбор сохранённой сетки + наложение реальных результатов. */
function BracketReview({
  data,
  chip,
  actual,
}: {
  data: BracketData;
  chip: ChipFn;
  actual: Actual;
}) {
  const championOk = actual.champion ? actual.champion === data.final : null;
  const thirdOk = actual.third ? actual.third === data.third : null;
  const finalist = finalMatchup(data).filter((t) => t !== data.final)[0] ?? "";

  return (
    <div className="space-y-5">
      <section className="space-y-2 rounded-xl border border-gold/40 bg-gradient-to-br from-gold/10 to-transparent p-5 shadow-card">
        <div className="mb-1 flex items-center gap-2 font-semibold text-gold">
          <Trophy className="size-5" />
          Итог (прогноз)
        </div>
        <ResultRow label="🏆 Чемпион" chip={chip(data.final)} ok={championOk} />
        <ResultRow label="🥈 Финалист" chip={chip(finalist)} ok={null} />
        <ResultRow label="🥉 3-е место" chip={chip(data.third)} ok={thirdOk} />
      </section>

      <section className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
        <h3 className="mb-3 font-semibold">Места в группах</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {GROUP_LETTERS.map((g) => {
            const groupDone = actual.done[g];
            const real = actual.standings[g] ?? [];
            const realPos = (team: string) => {
              const i = real.findIndex((s) => s.team === team);
              return i < 0 ? 0 : i + 1;
            };
            return (
              <div key={g} className="rounded-lg border border-border bg-background/40 p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm font-semibold">Группа {g}</span>
                  {groupDone && <span className="text-[10px] text-muted-foreground">факт</span>}
                </div>
                <ol className="space-y-1">
                  {(data.groups[g] ?? []).map((t, i) => {
                    const rp = groupDone ? realPos(t) : 0;
                    const ok = groupDone ? rp === i + 1 : null;
                    return (
                      <li key={t} className="flex items-center gap-2 text-sm">
                        <span className="w-4 text-[11px] text-muted-foreground">{i + 1}.</span>
                        {chip(t)}
                        <span className="ml-auto flex items-center gap-1">
                          {i === 2 && data.thirds.includes(g) && (
                            <span className="text-[10px] text-primary">прошёл</span>
                          )}
                          {groupDone && (
                            <span
                              className={`text-[10px] ${ok ? "text-pitch" : "text-destructive"}`}
                            >
                              факт {rp}
                            </span>
                          )}
                          <Verdict ok={ok} />
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
        <h3 className="font-semibold">Плей-офф</h3>
        <ReviewRound
          title="1/16"
          matchups={r32Matchups(data)}
          winners={data.r32}
          chip={chip}
          advanced={actual.advanced.r32}
        />
        <ReviewRound
          title="1/8"
          matchups={r16Matchups(data)}
          winners={data.r16}
          chip={chip}
          advanced={actual.advanced.r16}
        />
        <ReviewRound
          title="1/4"
          matchups={qfMatchups(data)}
          winners={data.qf}
          chip={chip}
          advanced={actual.advanced.qf}
        />
        <ReviewRound
          title="1/2"
          matchups={sfMatchups(data)}
          winners={data.sf}
          chip={chip}
          advanced={actual.advanced.sf}
        />
      </section>
    </div>
  );
}

function ResultRow({
  label,
  chip,
  ok,
}: {
  label: string;
  chip: React.ReactNode;
  ok: boolean | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-secondary/50 px-3 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 text-sm font-semibold">
        {chip}
        <Verdict ok={ok} />
      </span>
    </div>
  );
}

function ReviewRound({
  title,
  matchups,
  winners,
  chip,
  advanced,
}: {
  title: string;
  matchups: Array<[string, string]>;
  winners: string[];
  chip: ChipFn;
  advanced: Set<string>;
}) {
  const known = advanced.size > 0;
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{title}</div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {matchups.map((m, i) => {
          const w = winners[i];
          const ok = known && w ? advanced.has(w) : null;
          return (
            <div
              key={i}
              className="flex items-center gap-2 rounded-md bg-secondary/40 px-2.5 py-1.5 text-sm"
            >
              <span className={w === m[0] ? "font-semibold text-primary" : "text-muted-foreground"}>
                {chip(m[0])}
              </span>
              <span className="text-[10px] text-muted-foreground">—</span>
              <span className={w === m[1] ? "font-semibold text-primary" : "text-muted-foreground"}>
                {chip(m[1])}
              </span>
              <span className="ml-auto">
                <Verdict ok={ok} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ParticipantsView({
  list,
  chip,
  actual,
}: {
  list: Participant[];
  chip: ChipFn;
  actual: Actual;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (list.length === 0)
    return (
      <div className="rounded-xl border border-dashed border-border py-12 text-center text-muted-foreground">
        Пока никто не сохранил сетку.
      </div>
    );
  return (
    <div className="space-y-3">
      {list.map((p) => {
        const championOk = actual.champion ? actual.champion === p.data.final : null;
        const isOpen = open === p.user_id;
        return (
          <div
            key={p.user_id}
            className="overflow-hidden rounded-xl border border-border bg-card shadow-card"
          >
            <button
              onClick={() => setOpen(isOpen ? null : p.user_id)}
              className="flex w-full items-center gap-3 p-4 text-left hover:bg-accent/40"
            >
              <div
                className={`grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold ${p.isMe ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
              >
                {p.username[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {p.username}
                  {p.isMe ? " (я)" : ""}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Trophy className="size-3 text-gold" />
                  чемпион: {chip(p.data.final)}
                  <Verdict ok={championOk} />
                </div>
              </div>
              <ChevronDown
                className={`size-5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
              />
            </button>
            {isOpen && (
              <div className="border-t border-border p-4">
                <BracketReview data={p.data} chip={chip} actual={actual} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RealityView({
  actual,
  matches,
  chip,
}: {
  actual: Actual;
  matches: ActualMatch[];
  chip: ChipFn;
}) {
  const anyGroup = GROUP_LETTERS.some((g) => (actual.standings[g] ?? []).length > 0);
  const koByStage = KO_STAGES.map((st) => ({
    stage: st,
    games: matches.filter(
      (m) =>
        m.stage === st && m.status === "finished" && m.home_score != null && m.away_score != null,
    ),
  })).filter((x) => x.games.length > 0);

  return (
    <div className="space-y-6">
      {actual.champion && (
        <section className="rounded-xl border border-gold/40 bg-gradient-to-br from-gold/10 to-transparent p-5 text-center shadow-card">
          <div className="text-xs uppercase tracking-widest text-gold">Чемпион мира</div>
          <div className="mt-1 flex items-center justify-center gap-2 text-2xl font-bold">
            {chip(actual.champion)}
          </div>
          {actual.third && (
            <div className="mt-2 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
              🥉 3-е место: {chip(actual.third)}
            </div>
          )}
        </section>
      )}

      <section className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
        <h3 className="mb-1 font-semibold">Группы — реальные таблицы</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Зелёным — 1–2 места (проходят напрямую), золотым — третьи места из лучшей восьмёрки.
          Подсчёт упрощён (без личных встреч).
        </p>
        {!anyGroup ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Групповой этап ещё не начался.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {GROUP_LETTERS.map((g) => (
              <StandingsTable
                key={g}
                group={g}
                rows={actual.standings[g] ?? []}
                done={actual.done[g]}
                bestThirds={actual.bestThirds}
                chip={chip}
              />
            ))}
          </div>
        )}
      </section>

      {koByStage.length > 0 && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
          <h3 className="font-semibold">Плей-офф — реальные результаты</h3>
          {koByStage.map(({ stage, games }) => (
            <div key={stage}>
              <div className="mb-1.5 text-xs font-semibold text-gold">{STAGE_LABELS[stage]}</div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {games.map((m, i) => {
                  const winner = knockoutWinner(m);
                  const homeWin = winner === m.home_team;
                  const awayWin = winner === m.away_team;
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-md bg-secondary/40 px-2.5 py-1.5 text-sm"
                    >
                      <span className={homeWin ? "font-semibold" : "text-muted-foreground"}>
                        {chip(m.home_team)}
                      </span>
                      <FinishedScore
                        m={m}
                        className="text-xs text-muted-foreground"
                        noteClassName="text-[9px]"
                      />
                      <span className={awayWin ? "font-semibold" : "text-muted-foreground"}>
                        {chip(m.away_team)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function StandingsTable({
  group,
  rows,
  done,
  bestThirds,
  chip,
}: {
  group: string;
  rows: Standing[];
  done: boolean;
  bestThirds: string[];
  chip: ChipFn;
}) {
  const thirdQualifies = bestThirds.includes(group);
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Группа {group}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] ${done ? "bg-pitch/20 text-pitch" : "bg-secondary text-muted-foreground"}`}
        >
          {done ? "завершена" : "идёт"}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">нет результатов</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="w-4" />
              <th className="text-left font-normal">Команда</th>
              <th className="w-6 text-center font-normal">И</th>
              <th className="w-8 text-center font-normal">РМ</th>
              <th className="w-6 text-center font-normal">О</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const advance = i < 2;
              const thirdAdv = i === 2 && thirdQualifies;
              return (
                <tr
                  key={s.team}
                  className={cn(
                    "border-t border-border/40",
                    advance && "bg-pitch/10",
                    thirdAdv && "bg-gold/10",
                  )}
                >
                  <td className="py-1 text-center text-[11px] text-muted-foreground">{i + 1}</td>
                  <td className="py-1">{chip(s.team)}</td>
                  <td className="py-1 text-center tabular-nums">{s.played}</td>
                  <td className="py-1 text-center tabular-nums">{s.gd > 0 ? `+${s.gd}` : s.gd}</td>
                  <td className="py-1 text-center font-bold tabular-nums">{s.pts}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
