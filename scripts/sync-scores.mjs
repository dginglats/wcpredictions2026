/**
 * Syncs 2026 FIFA World Cup fixtures & live scores from API-Football into Supabase.
 *
 * Modes:
 *   node scripts/sync-scores.mjs            → "live" mode: only calls the API when a match
 *                                             is in progress or about to start (saves quota),
 *                                             then updates score/status of changed matches.
 *   node scripts/sync-scores.mjs --import   → "import" mode: always fetches the full fixture
 *                                             list and upserts everything (teams, flags, dates,
 *                                             stage, scores). Run once to populate, or daily.
 *
 * Writing score/status into `matches` makes the DB trigger recalc prediction points, and
 * Supabase Realtime pushes the change to every open browser. No app deploy needed.
 *
 * Env (from .env / .env.local / process.env):
 *   FOOTBALL_DATA_TOKEN           — football-data.org API token (required)
 *   SUPABASE_URL | VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY     — service role (bypasses RLS)
 *   FOOTBALL_DATA_COMPETITION     — optional, default WC (FIFA World Cup)
 *   FOOTBALL_DATA_SEASON          — optional, e.g. 2026 (default: current season)
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(name) {
  const p = resolve(__dirname, `../${name}`);
  if (!existsSync(p)) return {};
  return Object.fromEntries(
    readFileSync(p, "utf-8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
      .map((l) => {
        const [k, ...v] = l.split("=");
        return [
          k.trim(),
          v
            .join("=")
            .trim()
            .replace(/^["']|["']$/g, ""),
        ];
      }),
  );
}

const env = {
  ...loadEnvFile(".env.example"),
  ...loadEnvFile(".env.local"),
  ...loadEnvFile(".env"),
  ...process.env,
};

const FD_TOKEN = env.FOOTBALL_DATA_TOKEN;
const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const COMPETITION = env.FOOTBALL_DATA_COMPETITION || "WC"; // FIFA World Cup
const SEASON = env.FOOTBALL_DATA_SEASON || ""; // optional; default = current season

const IMPORT = process.argv.includes("--import");

if (!FD_TOKEN || !SUPABASE_URL || !SERVICE_KEY) {
  const missing = [
    ...(!FD_TOKEN ? ["FOOTBALL_DATA_TOKEN"] : []),
    ...(!SUPABASE_URL ? ["SUPABASE_URL (or VITE_SUPABASE_URL)"] : []),
    ...(!SERVICE_KEY ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
  ];
  console.error(`❌ Missing env: ${missing.join(", ")}`);
  process.exit(1);
}

const BASE = SUPABASE_URL.replace(/\/$/, "");
const SB_WRITE = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};
const SB_READ = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

// Set to false if the matches.external_id column hasn't been migrated yet.
let HAS_EXT = true;

/**
 * Safe, secret-free diagnostics: validates that the service key matches the project
 * in SUPABASE_URL and is actually a server-side key. Prints nothing sensitive.
 */
function preflight() {
  const urlRef = (() => {
    try {
      return new URL(BASE).host.split(".")[0];
    } catch {
      return "?";
    }
  })();
  let keyDesc;
  if (SERVICE_KEY.startsWith("eyJ")) {
    try {
      const payload = JSON.parse(Buffer.from(SERVICE_KEY.split(".")[1], "base64").toString());
      keyDesc = `legacy JWT (role=${payload.role}, ref=${payload.ref})`;
      if (payload.role !== "service_role") {
        console.error(
          `⚠️  Key role is "${payload.role}", expected "service_role". Use the service_role key, not anon.`,
        );
      }
      if (payload.ref && payload.ref !== urlRef) {
        console.error(
          `⚠️  PROJECT MISMATCH: key belongs to project "${payload.ref}" but SUPABASE_URL points to "${urlRef}". Use a key + URL from the SAME project.`,
        );
      }
    } catch {
      keyDesc = "legacy JWT (unparseable — likely truncated/corrupted)";
    }
  } else if (SERVICE_KEY.startsWith("sb_secret_")) {
    keyDesc = "new secret key (sb_secret_…)";
  } else if (SERVICE_KEY.startsWith("sb_publishable_")) {
    keyDesc = "publishable key";
    console.error(
      `⚠️  This is a PUBLISHABLE key — it can't bypass RLS. Use the SECRET key (sb_secret_…) from Project Settings → API Keys.`,
    );
  } else {
    keyDesc = `unknown format (head="${SERVICE_KEY.slice(0, 6)}…")`;
  }
  console.log(
    `🔑 service key: ${keyDesc}, length=${SERVICE_KEY.length} · url project ref: ${urlRef}`,
  );
}

/**
 * Maps API-Football national-team names → { ru: display name, flag: ISO code for flagcdn }.
 * Keys are normalized (lowercased, alnum-only); aliases cover API naming quirks.
 * Unmapped teams fall back to the English name + the API logo URL.
 */
const COUNTRY = {
  mexico: { ru: "Мексика", flag: "mx" },
  southafrica: { ru: "ЮАР", flag: "za" },
  southkorea: { ru: "Южная Корея", flag: "kr" },
  korearepublic: { ru: "Южная Корея", flag: "kr" },
  korea: { ru: "Южная Корея", flag: "kr" },
  czechrepublic: { ru: "Чехия", flag: "cz" },
  czechia: { ru: "Чехия", flag: "cz" },
  canada: { ru: "Канада", flag: "ca" },
  bosniaandherzegovina: { ru: "Босния и Герц.", flag: "ba" },
  bosniaherzegovina: { ru: "Босния и Герц.", flag: "ba" },
  bosnia: { ru: "Босния и Герц.", flag: "ba" },
  qatar: { ru: "Катар", flag: "qa" },
  switzerland: { ru: "Швейцария", flag: "ch" },
  brazil: { ru: "Бразилия", flag: "br" },
  morocco: { ru: "Марокко", flag: "ma" },
  haiti: { ru: "Гаити", flag: "ht" },
  scotland: { ru: "Шотландия", flag: "gb-sct" },
  usa: { ru: "США", flag: "us" },
  unitedstates: { ru: "США", flag: "us" },
  paraguay: { ru: "Парагвай", flag: "py" },
  australia: { ru: "Австралия", flag: "au" },
  turkey: { ru: "Турция", flag: "tr" },
  turkiye: { ru: "Турция", flag: "tr" },
  germany: { ru: "Германия", flag: "de" },
  curacao: { ru: "Кюрасао", flag: "cw" },
  ivorycoast: { ru: "Кот-д'Ивуар", flag: "ci" },
  cotedivoire: { ru: "Кот-д'Ивуар", flag: "ci" },
  ecuador: { ru: "Эквадор", flag: "ec" },
  netherlands: { ru: "Нидерланды", flag: "nl" },
  japan: { ru: "Япония", flag: "jp" },
  sweden: { ru: "Швеция", flag: "se" },
  tunisia: { ru: "Тунис", flag: "tn" },
  belgium: { ru: "Бельгия", flag: "be" },
  egypt: { ru: "Египет", flag: "eg" },
  iran: { ru: "Иран", flag: "ir" },
  iriran: { ru: "Иран", flag: "ir" },
  newzealand: { ru: "Новая Зеландия", flag: "nz" },
  spain: { ru: "Испания", flag: "es" },
  capeverde: { ru: "Кабо-Верде", flag: "cv" },
  capeverdeislands: { ru: "Кабо-Верде", flag: "cv" },
  saudiarabia: { ru: "Саудовская Аравия", flag: "sa" },
  uruguay: { ru: "Уругвай", flag: "uy" },
  france: { ru: "Франция", flag: "fr" },
  senegal: { ru: "Сенегал", flag: "sn" },
  iraq: { ru: "Ирак", flag: "iq" },
  norway: { ru: "Норвегия", flag: "no" },
  argentina: { ru: "Аргентина", flag: "ar" },
  algeria: { ru: "Алжир", flag: "dz" },
  austria: { ru: "Австрия", flag: "at" },
  jordan: { ru: "Иордания", flag: "jo" },
  portugal: { ru: "Португалия", flag: "pt" },
  drcongo: { ru: "ДР Конго", flag: "cd" },
  congodr: { ru: "ДР Конго", flag: "cd" },
  democraticrepublicofcongo: { ru: "ДР Конго", flag: "cd" },
  uzbekistan: { ru: "Узбекистан", flag: "uz" },
  colombia: { ru: "Колумбия", flag: "co" },
  england: { ru: "Англия", flag: "gb-eng" },
  croatia: { ru: "Хорватия", flag: "hr" },
  ghana: { ru: "Гана", flag: "gh" },
  panama: { ru: "Панама", flag: "pa" },
};

const norm = (s) => (s || "").toLowerCase().replace(/[^a-zа-яё0-9]/gi, "");

function team(t) {
  const name = t?.name;
  if (!name) return { name: "TBD", flag: null }; // undecided knockout slot
  const hit = COUNTRY[norm(name)];
  return hit ? { name: hit.ru, flag: hit.flag } : { name, flag: t.crest || null };
}

// football-data.org stage enum → our match_stage; group letter from `group` field.
function mapStage(stage = "", group) {
  const s = (stage || "").toUpperCase();
  if (s.includes("THIRD") || s.includes("3RD")) return { stage: "third_place", group_name: null };
  if (s.includes("SEMI")) return { stage: "semi_final", group_name: null };
  if (s.includes("QUARTER")) return { stage: "quarter_final", group_name: null };
  if (s.includes("LAST_16") || s.includes("ROUND_OF_16") || s.includes("EIGHTH"))
    return { stage: "round_of_16", group_name: null };
  if (s.includes("LAST_32") || s.includes("ROUND_OF_32"))
    return { stage: "round_of_32", group_name: null };
  if (s.includes("FINAL")) return { stage: "final", group_name: null };
  const g = (group || "").match(/([A-L])\s*$/i);
  return { stage: "group", group_name: g ? g[1].toUpperCase() : null };
}

function mapStatus(s) {
  if (["IN_PLAY", "PAUSED"].includes(s)) return "live";
  if (s === "FINISHED") return "finished";
  return "scheduled"; // SCHEDULED, TIMED, POSTPONED, SUSPENDED, CANCELLED
}

function mapFixture(m) {
  const home = team(m.homeTeam);
  const away = team(m.awayTeam);
  const { stage, group_name } = mapStage(m.stage, m.group);
  const status = mapStatus(m.status);
  const score = m.score ?? {};
  const ft = score.fullTime ?? {};
  const reg = score.regularTime ?? {};
  const et = score.extraTime ?? {};
  const pen = score.penalties ?? {};
  const scored = status !== "scheduled";
  const duration = scored ? (score.duration ?? null) : null;

  // Плей-офф, ушедший в доп. время / пенальти: football-data отдаёт в fullTime
  // ИТОГОВЫЙ счёт (с голами доп. времени и серии пенальти). Основной счёт —
  // тот, по которому считаются очки и который показывается — берём за 90 минут
  // (regularTime). Группа и матчи, решённые в основное время, → fullTime.
  const overtime =
    (duration === "EXTRA_TIME" || duration === "PENALTY_SHOOTOUT") && reg.home != null;
  const main = overtime ? reg : ft;
  const num = (v) => (v == null ? null : v);

  return {
    external_id: String(m.id),
    home_team: home.name,
    away_team: away.name,
    home_flag: home.flag,
    away_flag: away.flag,
    kickoff: m.utcDate,
    stage,
    group_name,
    status,
    home_score: scored ? num(main.home) : null,
    away_score: scored ? num(main.away) : null,
    score_duration: duration,
    home_et: scored ? num(et.home) : null,
    away_et: scored ? num(et.away) : null,
    home_pen: scored ? num(pen.home) : null,
    away_pen: scored ? num(pen.away) : null,
  };
}

async function fetchFixtures() {
  const qs = SEASON ? `?season=${SEASON}` : "";
  const url = `https://api.football-data.org/v4/competitions/${COMPETITION}/matches${qs}`;
  const res = await fetch(url, { headers: { "X-Auth-Token": FD_TOKEN } });
  if (!res.ok) {
    throw new Error(`football-data.org ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  return (json.matches ?? []).map(mapFixture);
}

async function getDbMatches() {
  const base =
    "id,home_team,away_team,kickoff,stadium,city,stage,group_name,status,home_score,away_score,score_duration,home_et,away_et,home_pen,away_pen";
  let res = await fetch(`${BASE}/rest/v1/matches?select=external_id,${base}`, { headers: SB_READ });
  if (!res.ok) {
    const text = await res.text();
    // Gracefully run without the migration: retry without the external_id column.
    if (/external_id/.test(text) && /column|does not exist|schema cache/i.test(text)) {
      HAS_EXT = false;
      console.log(
        "ℹ️  matches.external_id column not found — running without it (apply the migration for more robust linking).",
      );
      res = await fetch(`${BASE}/rest/v1/matches?select=${base}`, { headers: SB_READ });
      if (!res.ok) throw new Error(`Supabase read failed: ${await res.text()}`);
    } else {
      throw new Error(`Supabase read failed: ${text}`);
    }
  }
  return res.json();
}

async function patchMatch(id, patch) {
  const res = await fetch(`${BASE}/rest/v1/matches?id=eq.${id}`, {
    method: "PATCH",
    headers: SB_WRITE,
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`PATCH ${id} failed: ${await res.text()}`);
}

async function insertMatch(row) {
  const res = await fetch(`${BASE}/rest/v1/matches`, {
    method: "POST",
    headers: SB_WRITE,
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`INSERT failed: ${await res.text()}`);
}

const sameDay = (a, b) =>
  new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);

function findUnlinked(row, unlinked) {
  return unlinked.find(
    (m) =>
      !m.external_id &&
      sameDay(m.kickoff, row.kickoff) &&
      norm(m.home_team) === norm(row.home_team) &&
      norm(m.away_team) === norm(row.away_team),
  );
}

async function main() {
  console.log(
    `🔌 Supabase: ${BASE} · competition=${COMPETITION} season=${SEASON || "current"} · mode=${IMPORT ? "import" : "live"}`,
  );
  preflight();

  const db = await getDbMatches();

  // Live mode: skip the API call entirely unless a match is in progress / imminent.
  if (!IMPORT) {
    if (db.length === 0) {
      console.log("ℹ️  DB empty — nothing to refresh. Run with --import first.");
      return;
    }
    const now = Date.now();
    const active = db.some((m) => {
      if (m.status === "live") return true;
      if (m.status !== "scheduled") return false;
      const k = new Date(m.kickoff).getTime();
      // Self-heals a missed kickoff: poll from 25 min before kickoff until 24 h after,
      // so if a cron run is skipped/delayed (common with GitHub Actions schedules) and a
      // match never flips to "live", the next run still finalizes it once it's FINISHED.
      // Quota cost is negligible (≤1 API call per run), and a scheduled match older than
      // 24 h is treated as postponed/cancelled and no longer polled.
      return k <= now + 25 * 60 * 1000 && k >= now - 24 * 60 * 60 * 1000; // [-24h, +25min]
    });
    if (!active) {
      console.log("✓ No live or imminent matches — skipping API call (quota saved).");
      return;
    }
  }

  const fixtures = await fetchFixtures();
  console.log(`📥 Fetched ${fixtures.length} fixtures from API-Football`);
  if (fixtures.length === 0) {
    console.log(
      "⚠️  No fixtures returned (check league/season or that the tournament has fixtures yet).",
    );
    return;
  }

  const byExt = new Map(db.filter((m) => m.external_id).map((m) => [m.external_id, m]));
  const unlinked = db.filter((m) => !m.external_id);

  // In live mode only touch score/status to avoid clobbering schedule and firing extra recalcs.
  const LIVE_FIELDS = [
    "status",
    "home_score",
    "away_score",
    "score_duration",
    "home_et",
    "away_et",
    "home_pen",
    "away_pen",
  ];
  // No stadium/city: football-data.org free tier omits venue, so we never overwrite
  // any manually-seeded stadium/city with null.
  const ALL_FIELDS = [
    "external_id",
    "home_team",
    "away_team",
    "home_flag",
    "away_flag",
    "kickoff",
    "stage",
    "group_name",
    "status",
    "home_score",
    "away_score",
    "score_duration",
    "home_et",
    "away_et",
    "home_pen",
    "away_pen",
  ];

  let inserted = 0,
    updated = 0,
    skipped = 0;
  for (const row of fixtures) {
    let existing = byExt.get(row.external_id);
    if (!existing) existing = findUnlinked(row, unlinked);

    if (existing) {
      let fields = IMPORT
        ? ALL_FIELDS
        : [...LIVE_FIELDS, ...(existing.external_id ? [] : ["external_id"])];
      if (!HAS_EXT) fields = fields.filter((f) => f !== "external_id");
      const patch = {};
      for (const f of fields) {
        if (existing[f] !== row[f]) patch[f] = row[f];
      }
      if (Object.keys(patch).length === 0) {
        skipped++;
        continue;
      }
      await patchMatch(existing.id, patch);
      updated++;
      const score = row.home_score != null ? ` ${row.home_score}:${row.away_score}` : "";
      console.log(`  ✏️  ${row.home_team} — ${row.away_team} [${row.status}${score}]`);
    } else if (IMPORT) {
      const insertRow = { ...row };
      if (!HAS_EXT) delete insertRow.external_id;
      await insertMatch(insertRow);
      inserted++;
      console.log(`  ➕ ${row.home_team} — ${row.away_team} (${row.stage})`);
    } else {
      skipped++; // live mode doesn't create new matches
    }
  }

  console.log(`✅ Done — inserted ${inserted}, updated ${updated}, unchanged ${skipped}`);
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
