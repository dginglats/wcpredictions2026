/**
 * Настройка автоматической загрузки результатов матчей.
 *
 *  1. Применяет миграцию supabase/migrations/20260612120000_auto_results.sql
 *  2. Записывает токен football-data.org в таблицу app_settings
 *  3. Делает пробную синхронизацию и печатает результат + лог
 *
 * Перед запуском в .env должны быть:
 *   SUPABASE_PROJECT_ID   — ref проекта (как в migrate.mjs)
 *   SUPABASE_DB_PASSWORD  — пароль БД
 *   FOOTBALL_DATA_TOKEN   — бесплатный токен с https://www.football-data.org/client/register
 *
 * Запуск:  node scripts/setup-auto-results.mjs
 */
import pg from "pg";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const env = Object.fromEntries(
  readFileSync(resolve(__dirname, "../.env"), "utf-8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const [k, ...v] = l.split("=");
      return [k.trim(), v.join("=").trim().replace(/^["']|["']$/g, "")];
    })
);

const ref = env.SUPABASE_PROJECT_ID;
const password = env.SUPABASE_DB_PASSWORD;
const token = env.FOOTBALL_DATA_TOKEN;

if (!ref || !password) {
  console.error("❌ Задайте SUPABASE_PROJECT_ID и SUPABASE_DB_PASSWORD в .env");
  process.exit(1);
}
if (!token) {
  console.error("❌ Задайте FOOTBALL_DATA_TOKEN в .env");
  console.error("   Получить бесплатно: https://www.football-data.org/client/register");
  process.exit(1);
}

const encodedPw = encodeURIComponent(password);
const connectionStrings = [
  `postgresql://postgres.${ref}:${encodedPw}@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${ref}:${encodedPw}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${ref}:${encodedPw}@aws-1-eu-west-2.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres:${encodedPw}@db.${ref}.supabase.co:5432/postgres`,
];

let client;
let connected = false;
for (const cs of connectionStrings) {
  try {
    client = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
    await client.connect();
    console.log("✅ Подключено:", cs.split("@")[1]);
    connected = true;
    break;
  } catch (e) {
    console.log("⏭ Пробую следующий хост:", e.message.substring(0, 60));
    try { await client.end(); } catch {}
  }
}
if (!connected) { console.error("❌ Не удалось подключиться к БД. Проверьте пароль."); process.exit(1); }

try {
  // 1. Применяем миграцию
  const sql = readFileSync(resolve(__dirname, "../supabase/migrations/20260612120000_auto_results.sql"), "utf-8");
  console.log("⏳ Применяю миграцию auto_results...");
  await client.query(sql);
  console.log("✅ Миграция применена (расширения, словарь команд, функции, cron каждые 2 мин).");

  // 2. Записываем токен
  await client.query(
    `INSERT INTO public.app_settings(key, value) VALUES ('football_data_token', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [token]
  );
  console.log("✅ Токен football-data.org сохранён в app_settings.");

  // 3. Пробная синхронизация
  console.log("⏳ Пробная синхронизация...");
  const { rows } = await client.query("SELECT public.sync_match_results() AS result");
  console.log("📊 Результат:", JSON.stringify(rows[0].result));

  const log = await client.query(
    "SELECT level, message, created_at FROM public.sync_log ORDER BY id DESC LIMIT 15"
  );
  console.log("\n📝 Последние записи журнала:");
  for (const r of log.rows.reverse()) {
    console.log(`  [${r.level}] ${r.message}`);
  }

  console.log("\n🎉 Готово. Дальше результаты обновляются сами каждые 2 минуты.");
  console.log("   Очки, статистика и таблица лидеров пересчитываются автоматически триггерами БД.");
} catch (e) {
  console.error("❌ Ошибка:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
