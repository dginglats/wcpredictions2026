/**
 * Логика прогноза-сетки плей-офф ЧМ-2026 (упрощённая модель).
 *
 * Формат турнира: 12 групп (A–L) по 4 команды. В плей-офф выходят 12
 * победителей групп, 12 вторых мест и 8 лучших третьих мест → 32 команды →
 * 1/16 (16 матчей) → 1/8 (8) → 1/4 (4) → 1/2 (2) → финал + матч за 3-е место.
 *
 * Пары формируются по фиксированному «посеву» (SEEDING): это не официальная
 * комбинаторная таблица ФИФА, а понятный детерминированный шаблон, в котором
 * каждый слот (1A, 2B, T3 …) встречается ровно один раз.
 */

export const GROUP_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as const;

/**
 * 32 слота 1/16 в порядке посева. Соседние пары (0,1), (2,3), … — это матчи.
 * Коды: "1X" — победитель группы X, "2X" — второе место группы X,
 * "T1".."T8" — выбранные третьи места по порядку (1-й…8-й слот третьих).
 */
export const SEEDING = [
  "1A",
  "T1",
  "1B",
  "T2",
  "1C",
  "T3",
  "1D",
  "T4",
  "1E",
  "T5",
  "1F",
  "T6",
  "1G",
  "T7",
  "1H",
  "T8",
  "1I",
  "2A",
  "1J",
  "2B",
  "1K",
  "2C",
  "1L",
  "2D",
  "2E",
  "2F",
  "2G",
  "2H",
  "2I",
  "2J",
  "2K",
  "2L",
] as const;

export const STEP_TITLES = [
  "Групповой этап",
  "Лучшие третьи места",
  "1/16 финала",
  "1/8 финала",
  "1/4 финала",
  "1/2 финала",
  "Финал и матч за 3-е место",
] as const;

export interface BracketData {
  /** Буква группы → команды по местам [1-е, 2-е, 3-е, 4-е]. */
  groups: Record<string, string[]>;
  /** 8 букв групп, чьи третьи места проходят дальше (по порядку слотов). */
  thirds: string[];
  /** Победители 1/16 (16 имён, по индексу матча). */
  r32: string[];
  /** Победители 1/8 (8). */
  r16: string[];
  /** Победители 1/4 (4). */
  qf: string[];
  /** Победители 1/2 (2). */
  sf: string[];
  /** Чемпион. */
  final: string;
  /** Победитель матча за 3-е место. */
  third: string;
}

export function emptyBracket(): BracketData {
  return { groups: {}, thirds: [], r32: [], r16: [], qf: [], sf: [], final: "", third: "" };
}

/** Третье место группы (или "" если группа ещё не расставлена). */
export function thirdPlaceOf(data: BracketData, letter: string): string {
  return data.groups[letter]?.[2] ?? "";
}

/** Все 12 групп полностью расставлены (по 4 команды в каждой). */
export function groupsComplete(data: BracketData, groupTeams: Record<string, string[]>): boolean {
  return GROUP_LETTERS.every((g) => (data.groups[g]?.length ?? 0) === (groupTeams[g]?.length ?? 4));
}

/**
 * Разворачивает 32 слота посева в имена команд на основе мест в группах
 * и выбранных третьих мест. Неизвестные слоты → "".
 */
export function resolveR32Teams(data: BracketData): string[] {
  return SEEDING.map((slot) => {
    if (slot[0] === "T") {
      const idx = Number(slot.slice(1)) - 1;
      const letter = data.thirds[idx];
      return letter ? thirdPlaceOf(data, letter) : "";
    }
    const pos = Number(slot[0]) - 1; // "1"->0, "2"->1
    const letter = slot[1];
    return data.groups[letter]?.[pos] ?? "";
  });
}

/** Пары соседних команд из плоского списка: [a,b,c,d] → [[a,b],[c,d]]. */
export function pairs(teams: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < teams.length; i += 2) out.push([teams[i] ?? "", teams[i + 1] ?? ""]);
  return out;
}

/** Матчи раунда по именам слотов/победителей предыдущего раунда. */
export function r32Matchups(data: BracketData): Array<[string, string]> {
  return pairs(resolveR32Teams(data));
}
export function r16Matchups(data: BracketData): Array<[string, string]> {
  return pairs(data.r32);
}
export function qfMatchups(data: BracketData): Array<[string, string]> {
  return pairs(data.r16);
}
export function sfMatchups(data: BracketData): Array<[string, string]> {
  return pairs(data.qf);
}
/** Пара финала (2 победителя 1/2). */
export function finalMatchup(data: BracketData): [string, string] {
  return [data.sf[0] ?? "", data.sf[1] ?? ""];
}
/** Пара матча за 3-е место: проигравшие в 1/2. */
export function thirdMatchup(data: BracketData): [string, string] {
  const loser = (pair: [string, string], winner: string) =>
    pair[0] === winner ? pair[1] : pair[0];
  const sfPairs = sfMatchups(data);
  return [
    sfPairs[0] ? loser(sfPairs[0], data.sf[0] ?? "") : "",
    sfPairs[1] ? loser(sfPairs[1], data.sf[1] ?? "") : "",
  ];
}

/** Все матчи раунда заполнены победителями. */
function roundDone(matchups: Array<[string, string]>, winners: string[]): boolean {
  return (
    matchups.length > 0 &&
    matchups.every((m, i) => Boolean(winners[i]) && (winners[i] === m[0] || winners[i] === m[1]))
  );
}

/** Готов ли шаг (0..6) к переходу дальше. */
export function stepComplete(
  step: number,
  data: BracketData,
  groupTeams: Record<string, string[]>,
): boolean {
  switch (step) {
    case 0:
      return groupsComplete(data, groupTeams);
    case 1:
      return data.thirds.length === 8;
    case 2:
      return roundDone(r32Matchups(data), data.r32);
    case 3:
      return roundDone(r16Matchups(data), data.r16);
    case 4:
      return roundDone(qfMatchups(data), data.qf);
    case 5:
      return roundDone(sfMatchups(data), data.sf);
    case 6: {
      const fm = finalMatchup(data);
      const tm = thirdMatchup(data);
      const finalOk = Boolean(data.final) && (data.final === fm[0] || data.final === fm[1]);
      const thirdOk = Boolean(data.third) && (data.third === tm[0] || data.third === tm[1]);
      return finalOk && thirdOk;
    }
    default:
      return false;
  }
}

/** Вся сетка заполнена — можно сохранять. */
export function bracketComplete(data: BracketData, groupTeams: Record<string, string[]>): boolean {
  return [0, 1, 2, 3, 4, 5, 6].every((s) => stepComplete(s, data, groupTeams));
}

// ─────────────────────────────────────────────────────────────────────────
// Флаги: данные хранят emoji (🇲🇽), которые на Windows не рисуются. Переводим
// emoji → ISO-код страны, чтобы показать картинку флага (как в TeamDisplay).
// ─────────────────────────────────────────────────────────────────────────

/** Эмодзи-флаг / ISO-код / URL → код для flagcdn ("mx", "gb-eng") или URL. null если не распознан. */
export function flagCode(flag?: string | null): string | null {
  if (!flag) return null;
  const f = flag.trim();
  if (!f) return null;
  if (/^https?:\/\//i.test(f)) return f; // уже URL
  if (/^[a-z]{2}$/i.test(f)) return f.toLowerCase(); // уже ISO-код
  if (/^gb-(eng|sct|wls|nir)$/i.test(f)) return f.toLowerCase();

  const cps = [...f].map((c) => c.codePointAt(0) ?? 0);
  // Пара regional indicator symbols (🇲🇽 → MX)
  const ri = cps.filter((cp) => cp >= 0x1f1e6 && cp <= 0x1f1ff);
  if (ri.length >= 2) {
    const a = String.fromCharCode(ri[0] - 0x1f1e6 + 65);
    const b = String.fromCharCode(ri[1] - 0x1f1e6 + 65);
    return (a + b).toLowerCase();
  }
  // Tag-последовательности (🏴 + теги): Англия/Шотландия/Уэльс
  const tags = cps
    .filter((cp) => cp >= 0xe0061 && cp <= 0xe007a)
    .map((cp) => String.fromCharCode(cp - 0xe0000))
    .join("");
  if (tags.startsWith("gb") && tags.length >= 5) return `gb-${tags.slice(2, 5)}`;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Реальные результаты: считаются из таблицы matches по мере завершения этапов.
// ─────────────────────────────────────────────────────────────────────────

export interface ActualMatch {
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  status: string;
  stage: string;
  group_name: string | null;
}

export interface Standing {
  team: string;
  played: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
}

/**
 * Сортировка таблицы группы: очки → разница мячей → забитые → имя.
 * (Упрощённо: без личных встреч — официальный тай-брейк ФИФА сложнее.)
 */
function cmpStanding(a: Standing, b: Standing): number {
  return b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team);
}

/** Фактические таблицы групп из сыгранных матчей + флаг «группа доиграна». */
export function computeActualGroups(matches: ActualMatch[]): {
  standings: Record<string, Standing[]>;
  done: Record<string, boolean>;
} {
  const byGroup: Record<string, ActualMatch[]> = {};
  for (const m of matches) {
    if (m.stage !== "group" || !m.group_name) continue;
    (byGroup[m.group_name] ??= []).push(m);
  }
  const standings: Record<string, Standing[]> = {};
  const done: Record<string, boolean> = {};
  for (const g of GROUP_LETTERS) {
    const ms = byGroup[g] ?? [];
    const tbl: Record<string, Standing> = {};
    const ensure = (t: string) =>
      (tbl[t] ??= { team: t, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 });
    let finished = 0;
    for (const m of ms) {
      if (m.status !== "finished" || m.home_score == null || m.away_score == null) continue;
      finished++;
      const h = ensure(m.home_team);
      const a = ensure(m.away_team);
      const hs = m.home_score;
      const as = m.away_score;
      h.played++;
      a.played++;
      h.gf += hs;
      h.ga += as;
      a.gf += as;
      a.ga += hs;
      if (hs > as) {
        h.w++;
        a.l++;
        h.pts += 3;
      } else if (hs < as) {
        a.w++;
        h.l++;
        a.pts += 3;
      } else {
        h.d++;
        a.d++;
        h.pts++;
        a.pts++;
      }
    }
    for (const s of Object.values(tbl)) s.gd = s.gf - s.ga;
    standings[g] = Object.values(tbl).sort(cmpStanding);
    done[g] = ms.length > 0 && finished === ms.length;
  }
  return { standings, done };
}

/** Буквы групп, чьи третьи места реально прошли (8 лучших). Пусто, пока не доиграны все группы. */
export function actualBestThirds(
  standings: Record<string, Standing[]>,
  done: Record<string, boolean>,
): string[] {
  if (!GROUP_LETTERS.every((g) => done[g])) return [];
  return GROUP_LETTERS.map((g) => ({ g: g as string, s: standings[g]?.[2] }))
    .filter((x) => Boolean(x.s))
    .sort((x, y) => cmpStanding(x.s as Standing, y.s as Standing))
    .slice(0, 8)
    .map((x) => x.g);
}

const STAGE_KEY: Record<string, "r32" | "r16" | "qf" | "sf"> = {
  round_of_32: "r32",
  round_of_16: "r16",
  quarter_final: "qf",
  semi_final: "sf",
};

/** Фактические победители раундов плей-офф (по сыгранным матчам). */
export function actualKnockout(matches: ActualMatch[]): {
  advanced: Record<"r32" | "r16" | "qf" | "sf", Set<string>>;
  champion: string;
  third: string;
} {
  const advanced = {
    r32: new Set<string>(),
    r16: new Set<string>(),
    qf: new Set<string>(),
    sf: new Set<string>(),
  };
  let champion = "";
  let third = "";
  for (const m of matches) {
    if (m.status !== "finished" || m.home_score == null || m.away_score == null) continue;
    if (m.home_score === m.away_score) continue; // победитель не определён по основному счёту
    const w = m.home_score > m.away_score ? m.home_team : m.away_team;
    const key = STAGE_KEY[m.stage];
    if (key) advanced[key].add(w);
    if (m.stage === "final") champion = w;
    if (m.stage === "third_place") third = w;
  }
  return { advanced, champion, third };
}
