import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Trophy, Medal, Lock, Check, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import {
  GROUP_LETTERS,
  STEP_TITLES,
  emptyBracket,
  thirdPlaceOf,
  stepComplete,
  bracketComplete,
  r32Matchups,
  r16Matchups,
  qfMatchups,
  sfMatchups,
  finalMatchup,
  thirdMatchup,
  type BracketData,
} from "@/lib/bracket";

export const Route = createFileRoute("/_authenticated/bracket")({ component: BracketPage });

type GroupMatch = {
  home_team: string;
  away_team: string;
  home_flag: string | null;
  away_flag: string | null;
  group_name: string | null;
};

/** Раунды плей-офф, чьи победители хранятся массивом. */
const KNOCKOUT_AFTER: Record<string, Array<"r16" | "qf" | "sf">> = {
  r32: ["r16", "qf", "sf"],
  r16: ["qf", "sf"],
  qf: ["sf"],
  sf: [],
};

function BracketPage() {
  const { user } = useAuth();
  const [groupTeams, setGroupTeams] = useState<Record<string, string[]>>({});
  const [flagOf, setFlagOf] = useState<Record<string, string>>({});
  const [data, setData] = useState<BracketData>(emptyBracket);
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState<BracketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: ms }, { data: existing }] = await Promise.all([
        supabase
          .from("matches")
          .select("home_team, away_team, home_flag, away_flag, group_name")
          .eq("stage", "group"),
        supabase.from("bracket_predictions").select("data").eq("user_id", user.id).maybeSingle(),
      ]);
      const teams: Record<string, string[]> = {};
      const flags: Record<string, string> = {};
      for (const m of (ms ?? []) as GroupMatch[]) {
        const g = m.group_name ?? "";
        if (!g) continue;
        teams[g] ??= [];
        for (const [name, flag] of [
          [m.home_team, m.home_flag],
          [m.away_team, m.away_flag],
        ] as const) {
          if (!teams[g].includes(name)) teams[g].push(name);
          if (flag) flags[name] = flag;
        }
      }
      setGroupTeams(teams);
      setFlagOf(flags);
      if (existing?.data) setSaved(existing.data as unknown as BracketData);
      setLoading(false);
    })();
  }, [user]);

  const chip = (name: string) =>
    name ? (
      <span className="inline-flex items-center gap-1.5 min-w-0">
        <span className="text-base leading-none">{flagOf[name] ?? "🏳️"}</span>
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
      if (idx >= 0)
        order.splice(idx); // снять это место и все последующие
      else {
        order.push(team);
        const all = groupTeams[letter] ?? [];
        if (order.length === all.length - 1) {
          const last = all.find((t) => !order.includes(t));
          if (last) order.push(last); // последнее место заполняется автоматически
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
      if (thirds.length > 8) return d; // не больше 8
      // храним по порядку групп для стабильного посева
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
    setSaved(data);
  }

  if (loading) return <div className="text-muted-foreground">Загрузка…</div>;
  if (Object.keys(groupTeams).length === 0)
    return (
      <div className="text-center text-muted-foreground py-20 border border-dashed border-border rounded-xl">
        Группы ещё не заданы — сетка появится, когда добавят матчи группового этапа.
      </div>
    );
  if (saved) return <SavedBracket data={saved} chip={chip} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Сетка</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Расставьте весь турнир: места в группах, 8 лучших третьих мест и победителей плей-офф до
          финала. Сохранить можно один раз — изменить потом нельзя.
        </p>
      </div>

      <Stepper step={step} data={data} groupTeams={groupTeams} onJump={setStep} />

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-card">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <span className="grid place-items-center size-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
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
          <ChevronLeft className="size-4 mr-1" />
          Назад
        </Button>
        {step < STEP_TITLES.length - 1 ? (
          <Button disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
            Далее
            <ChevronRight className="size-4 ml-1" />
          </Button>
        ) : (
          <Button disabled={!allDone || busy} onClick={save}>
            <Lock className="size-4 mr-1" />
            Сохранить сетку
          </Button>
        )}
      </div>
      {!canNext && (
        <p className="text-xs text-gold text-center">
          Заполните этот этап полностью, чтобы продолжить.
        </p>
      )}
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
  // Можно открыть пройденный/текущий шаг или следующий, если текущий завершён.
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
                  : "bg-secondary/40 text-muted-foreground cursor-not-allowed"
            }`}
          >
            <span className="grid place-items-center size-4 rounded-full bg-black/20 text-[10px]">
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
  chip: (n: string) => React.ReactNode;
  onTap: (g: string, t: string) => void;
  onReset: (g: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground mb-3">
        Нажимайте команды в порядке мест: 1-е, 2-е, 3-е. Последнее место заполнится само.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {GROUP_LETTERS.map((g) => {
          const teams = groupTeams[g] ?? [];
          const order = data.groups[g] ?? [];
          return (
            <div key={g} className="rounded-lg border border-border bg-background/40 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm">Группа {g}</span>
                {order.length > 0 && (
                  <button
                    onClick={() => onReset(g)}
                    className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
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
                      className={`w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-left transition-colors ${
                        rank
                          ? "bg-primary/15 border border-primary/40"
                          : "bg-secondary/50 hover:bg-accent border border-transparent"
                      }`}
                    >
                      <span
                        className={`grid place-items-center size-5 shrink-0 rounded-full text-[11px] font-bold ${rank ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
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
  chip: (n: string) => React.ReactNode;
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
              className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-left transition-colors ${
                picked
                  ? "bg-primary/15 border border-primary/50"
                  : disabled
                    ? "bg-secondary/30 border border-transparent text-muted-foreground cursor-not-allowed"
                    : "bg-secondary/50 hover:bg-accent border border-transparent"
              }`}
            >
              <span className="text-[11px] font-bold text-muted-foreground w-12 shrink-0">
                3-е {g}
              </span>
              {chip(team)}
              {picked && <Check className="size-4 text-primary ml-auto shrink-0" />}
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
  chip: (n: string) => React.ReactNode;
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
            <div className="text-[10px] text-muted-foreground mb-1.5 px-1">Матч {i + 1}</div>
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
                        ? "bg-primary text-primary-foreground font-semibold"
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
  chip: (n: string) => React.ReactNode;
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
        <div className="flex items-center gap-2 mb-2 font-semibold text-gold">
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
        <div className="flex items-center gap-2 mb-2 font-semibold">
          <Medal className="size-5 text-amber-700" />
          Матч за 3-е место
        </div>
        <PickRow pair={tm} value={data.third} onPick={onThird} accent="bg-amber-700 text-white" />
      </div>
    </div>
  );
}

function SavedBracket({ data, chip }: { data: BracketData; chip: (n: string) => React.ReactNode }) {
  const Row = ({ label, name, cls }: { label: string; name: string; cls?: string }) => (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-secondary/50 px-3 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold ${cls ?? ""}`}>{chip(name)}</span>
    </div>
  );
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Сетка</h1>
        <p className="text-muted-foreground text-sm mt-1 flex items-center gap-1.5">
          <Lock className="size-3.5" />
          Ваша сетка сохранена и не изменяется.
        </p>
      </div>

      <section className="rounded-xl border border-gold/40 bg-gradient-to-br from-gold/10 to-transparent p-5 shadow-card space-y-2">
        <div className="flex items-center gap-2 font-semibold text-gold mb-1">
          <Trophy className="size-5" />
          Итог
        </div>
        <Row label="🏆 Чемпион" name={data.final} cls="text-gold" />
        <Row
          label="🥈 Финалисты"
          name={finalMatchup(data).filter((t) => t !== data.final)[0] ?? ""}
        />
        <Row label="🥉 3-е место" name={data.third} />
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-card">
        <h2 className="font-semibold mb-3">Места в группах</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {GROUP_LETTERS.map((g) => (
            <div key={g} className="rounded-lg border border-border bg-background/40 p-3">
              <div className="font-semibold text-sm mb-1.5">Группа {g}</div>
              <ol className="space-y-1">
                {(data.groups[g] ?? []).map((t, i) => (
                  <li
                    key={t}
                    className={`flex items-center gap-2 text-sm ${i === 2 && data.thirds.includes(g) ? "text-primary font-medium" : ""}`}
                  >
                    <span className="text-[11px] text-muted-foreground w-4">{i + 1}.</span>
                    {chip(t)}
                    {i === 2 && data.thirds.includes(g) && (
                      <span className="text-[10px] text-primary ml-auto">прошёл</span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-card space-y-4">
        <h2 className="font-semibold">Плей-офф</h2>
        <SavedRound title="1/16" matchups={r32Matchups(data)} winners={data.r32} chip={chip} />
        <SavedRound title="1/8" matchups={r16Matchups(data)} winners={data.r16} chip={chip} />
        <SavedRound title="1/4" matchups={qfMatchups(data)} winners={data.qf} chip={chip} />
        <SavedRound title="1/2" matchups={sfMatchups(data)} winners={data.sf} chip={chip} />
      </section>
    </div>
  );
}

function SavedRound({
  title,
  matchups,
  winners,
  chip,
}: {
  title: string;
  matchups: Array<[string, string]>;
  winners: string[];
  chip: (n: string) => React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground mb-1.5">{title}</div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {matchups.map((m, i) => (
          <div
            key={i}
            className="flex items-center gap-2 text-sm rounded-md bg-secondary/40 px-2.5 py-1.5"
          >
            <span
              className={
                winners[i] === m[0] ? "font-semibold text-primary" : "text-muted-foreground"
              }
            >
              {chip(m[0])}
            </span>
            <span className="text-[10px] text-muted-foreground">—</span>
            <span
              className={
                winners[i] === m[1] ? "font-semibold text-primary" : "text-muted-foreground"
              }
            >
              {chip(m[1])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
