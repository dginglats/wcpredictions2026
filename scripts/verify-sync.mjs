import pg from "pg";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, "../.env"), "utf-8").split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => { const [k, ...v] = l.split("="); return [k.trim(), v.join("=").trim().replace(/^["']|["']$/g, "")]; })
);
const cs = `postgresql://postgres.${env.SUPABASE_PROJECT_ID}:${encodeURIComponent(env.SUPABASE_DB_PASSWORD)}@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`;
const c = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
await c.connect();

const counts = await c.query(`
  SELECT status, count(*) FROM public.matches GROUP BY status ORDER BY status`);
console.log("Матчи по статусам:"); counts.rows.forEach(r => console.log(`  ${r.status}: ${r.count}`));

const matched = await c.query(`SELECT count(*) FILTER (WHERE external_id IS NOT NULL) AS m, count(*) AS total FROM public.matches`);
console.log(`Привязано к API: ${matched.rows[0].m} из ${matched.rows[0].total}`);

const unmatchedReal = await c.query(`
  SELECT message FROM public.sync_log
  WHERE level='warn' AND message NOT LIKE '%:  vs  %' ORDER BY id DESC LIMIT 20`);
console.log(`Не сопоставлено С НАЗВАНИЯМИ (требует внимания): ${unmatchedReal.rows.length}`);
unmatchedReal.rows.forEach(r => console.log("  " + r.message));

const finished = await c.query(`
  SELECT home_team, home_score, away_score, away_team, status FROM public.matches
  WHERE status IN ('finished','live') ORDER BY kickoff LIMIT 20`);
console.log(`\nЗавершённые/идущие матчи (${finished.rows.length}):`);
finished.rows.forEach(r => console.log(`  ${r.home_team} ${r.home_score ?? "-"}:${r.away_score ?? "-"} ${r.away_team} [${r.status}]`));

const lb = await c.query(`SELECT username, total_points, finished_count FROM public.leaderboard ORDER BY total_points DESC LIMIT 10`);
console.log(`\nТаблица лидеров (топ-10):`);
lb.rows.forEach((r,i) => console.log(`  ${i+1}. ${r.username}: ${r.total_points} очк. (матчей сыграно: ${r.finished_count})`));

const job = await c.query(`SELECT jobname, schedule, active FROM cron.job WHERE jobname='sync-wc-results'`);
console.log(`\nCron:`, job.rows[0] ? `${job.rows[0].jobname} "${job.rows[0].schedule}" active=${job.rows[0].active}` : "НЕ НАЙДЕН");

await c.end();
