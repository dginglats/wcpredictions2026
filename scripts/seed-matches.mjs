/**
 * Seeds all 72 group stage matches of the 2026 FIFA World Cup.
 * Run: node scripts/seed-matches.mjs
 * Reads env from .env, .env.local, or process.env
 * Needs: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
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
        return [k.trim(), v.join("=").trim().replace(/^["']|["']$/g, "")];
      })
  );
}

const env = { ...loadEnvFile(".env.example"), ...loadEnvFile(".env.local"), ...loadEnvFile(".env"), ...process.env };

const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY");
  console.error("   Add them to .env or .env.local");
  process.exit(1);
}

const BASE = SUPABASE_URL.replace(/\/$/, "");
const HEADERS = {
  "apikey": SERVICE_KEY,
  "Authorization": `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  "Prefer": "return=minimal",
};

async function supabaseInsert(table, rows) {
  const res = await fetch(`${BASE}/rest/v1/${table}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Insert into ${table} failed (${res.status}): ${text.substring(0, 300)}`);
  }
}

async function supabaseSelect(table, params = "") {
  const res = await fetch(`${BASE}/rest/v1/${table}?${params}`, {
    headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Select from ${table} failed: ${await res.text()}`);
  return res.json();
}

async function supabaseDelete(table, params = "") {
  const res = await fetch(`${BASE}/rest/v1/${table}?${params}`, {
    method: "DELETE",
    headers: HEADERS,
  });
  if (!res.ok) throw new Error(`Delete from ${table} failed: ${await res.text()}`);
}

console.log(`🔌 Supabase URL: ${BASE}`);

// All 72 group stage matches of the 2026 FIFA World Cup
// Kickoff times are in UTC
const matches = [
  // ── GROUP A: Mexico, South Africa, South Korea, Czech Republic ──
  { home_team: "Мексика",        away_team: "ЮАР",          home_flag: "🇲🇽", away_flag: "🇿🇦", kickoff: "2026-06-11T19:00:00Z", stadium: "Estadio Azteca",    city: "Мехико",        stage: "group", group_name: "A" },
  { home_team: "Южная Корея",    away_team: "Чехия",        home_flag: "🇰🇷", away_flag: "🇨🇿", kickoff: "2026-06-12T02:00:00Z", stadium: "Estadio Akron",     city: "Гвадалахара",   stage: "group", group_name: "A" },
  { home_team: "Чехия",          away_team: "ЮАР",          home_flag: "🇨🇿", away_flag: "🇿🇦", kickoff: "2026-06-18T16:00:00Z", stadium: "Mercedes-Benz Stadium", city: "Атланта",  stage: "group", group_name: "A" },
  { home_team: "Мексика",        away_team: "Южная Корея",  home_flag: "🇲🇽", away_flag: "🇰🇷", kickoff: "2026-06-19T01:00:00Z", stadium: "Estadio Akron",     city: "Гвадалахара",   stage: "group", group_name: "A" },
  { home_team: "Чехия",          away_team: "Мексика",      home_flag: "🇨🇿", away_flag: "🇲🇽", kickoff: "2026-06-25T01:00:00Z", stadium: "Estadio Azteca",    city: "Мехико",        stage: "group", group_name: "A" },
  { home_team: "ЮАР",            away_team: "Южная Корея",  home_flag: "🇿🇦", away_flag: "🇰🇷", kickoff: "2026-06-25T01:00:00Z", stadium: "Estadio BBVA",      city: "Монтеррей",     stage: "group", group_name: "A" },

  // ── GROUP B: Canada, Bosnia and Herzegovina, Qatar, Switzerland ──
  { home_team: "Канада",         away_team: "Босния и Герц.", home_flag: "🇨🇦", away_flag: "🇧🇦", kickoff: "2026-06-12T19:00:00Z", stadium: "BMO Field",        city: "Торонто",       stage: "group", group_name: "B" },
  { home_team: "Катар",          away_team: "Швейцария",    home_flag: "🇶🇦", away_flag: "🇨🇭", kickoff: "2026-06-13T19:00:00Z", stadium: "Levi's Stadium",   city: "Санта-Клара",   stage: "group", group_name: "B" },
  { home_team: "Швейцария",      away_team: "Босния и Герц.", home_flag: "🇨🇭", away_flag: "🇧🇦", kickoff: "2026-06-18T19:00:00Z", stadium: "SoFi Stadium",    city: "Лос-Анджелес",  stage: "group", group_name: "B" },
  { home_team: "Канада",         away_team: "Катар",        home_flag: "🇨🇦", away_flag: "🇶🇦", kickoff: "2026-06-18T22:00:00Z", stadium: "BC Place",         city: "Ванкувер",      stage: "group", group_name: "B" },
  { home_team: "Швейцария",      away_team: "Канада",       home_flag: "🇨🇭", away_flag: "🇨🇦", kickoff: "2026-06-24T19:00:00Z", stadium: "BC Place",         city: "Ванкувер",      stage: "group", group_name: "B" },
  { home_team: "Босния и Герц.", away_team: "Катар",        home_flag: "🇧🇦", away_flag: "🇶🇦", kickoff: "2026-06-24T19:00:00Z", stadium: "Lumen Field",      city: "Сиэтл",         stage: "group", group_name: "B" },

  // ── GROUP C: Brazil, Morocco, Haiti, Scotland ──
  { home_team: "Бразилия",       away_team: "Марокко",      home_flag: "🇧🇷", away_flag: "🇲🇦", kickoff: "2026-06-13T22:00:00Z", stadium: "MetLife Stadium",  city: "Нью-Йорк/Нью-Джерси", stage: "group", group_name: "C" },
  { home_team: "Гаити",          away_team: "Шотландия",    home_flag: "🇭🇹", away_flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", kickoff: "2026-06-14T01:00:00Z", stadium: "Gillette Stadium", city: "Фоксборо",      stage: "group", group_name: "C" },
  { home_team: "Шотландия",      away_team: "Марокко",      home_flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", away_flag: "🇲🇦", kickoff: "2026-06-19T22:00:00Z", stadium: "Gillette Stadium", city: "Фоксборо",      stage: "group", group_name: "C" },
  { home_team: "Бразилия",       away_team: "Гаити",        home_flag: "🇧🇷", away_flag: "🇭🇹", kickoff: "2026-06-20T00:30:00Z", stadium: "Lincoln Financial Field", city: "Филадельфия", stage: "group", group_name: "C" },
  { home_team: "Шотландия",      away_team: "Бразилия",     home_flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", away_flag: "🇧🇷", kickoff: "2026-06-24T22:00:00Z", stadium: "Hard Rock Stadium", city: "Майами",       stage: "group", group_name: "C" },
  { home_team: "Марокко",        away_team: "Гаити",        home_flag: "🇲🇦", away_flag: "🇭🇹", kickoff: "2026-06-24T22:00:00Z", stadium: "Mercedes-Benz Stadium", city: "Атланта",  stage: "group", group_name: "C" },

  // ── GROUP D: United States, Paraguay, Australia, Turkey ──
  { home_team: "США",            away_team: "Парагвай",     home_flag: "🇺🇸", away_flag: "🇵🇾", kickoff: "2026-06-13T01:00:00Z", stadium: "SoFi Stadium",     city: "Лос-Анджелес",  stage: "group", group_name: "D" },
  { home_team: "Австралия",      away_team: "Турция",       home_flag: "🇦🇺", away_flag: "🇹🇷", kickoff: "2026-06-14T04:00:00Z", stadium: "BC Place",         city: "Ванкувер",      stage: "group", group_name: "D" },
  { home_team: "США",            away_team: "Австралия",    home_flag: "🇺🇸", away_flag: "🇦🇺", kickoff: "2026-06-19T19:00:00Z", stadium: "Lumen Field",      city: "Сиэтл",         stage: "group", group_name: "D" },
  { home_team: "Турция",         away_team: "Парагвай",     home_flag: "🇹🇷", away_flag: "🇵🇾", kickoff: "2026-06-20T03:00:00Z", stadium: "Levi's Stadium",   city: "Санта-Клара",   stage: "group", group_name: "D" },
  { home_team: "Турция",         away_team: "США",          home_flag: "🇹🇷", away_flag: "🇺🇸", kickoff: "2026-06-26T02:00:00Z", stadium: "Levi's Stadium",   city: "Санта-Клара",   stage: "group", group_name: "D" },
  { home_team: "Парагвай",       away_team: "Австралия",    home_flag: "🇵🇾", away_flag: "🇦🇺", kickoff: "2026-06-26T02:00:00Z", stadium: "SoFi Stadium",     city: "Лос-Анджелес",  stage: "group", group_name: "D" },

  // ── GROUP E: Germany, Curaçao, Ivory Coast, Ecuador ──
  { home_team: "Германия",       away_team: "Кюрасао",      home_flag: "🇩🇪", away_flag: "🇨🇼", kickoff: "2026-06-14T17:00:00Z", stadium: "NRG Stadium",      city: "Хьюстон",       stage: "group", group_name: "E" },
  { home_team: "Кот-д'Ивуар",   away_team: "Эквадор",      home_flag: "🇨🇮", away_flag: "🇪🇨", kickoff: "2026-06-14T23:00:00Z", stadium: "Lincoln Financial Field", city: "Филадельфия", stage: "group", group_name: "E" },
  { home_team: "Германия",       away_team: "Кот-д'Ивуар", home_flag: "🇩🇪", away_flag: "🇨🇮", kickoff: "2026-06-20T20:00:00Z", stadium: "BMO Field",        city: "Торонто",       stage: "group", group_name: "E" },
  { home_team: "Эквадор",        away_team: "Кюрасао",      home_flag: "🇪🇨", away_flag: "🇨🇼", kickoff: "2026-06-21T00:00:00Z", stadium: "Arrowhead Stadium", city: "Канзас-Сити",  stage: "group", group_name: "E" },
  { home_team: "Кюрасао",        away_team: "Кот-д'Ивуар", home_flag: "🇨🇼", away_flag: "🇨🇮", kickoff: "2026-06-25T20:00:00Z", stadium: "Lincoln Financial Field", city: "Филадельфия", stage: "group", group_name: "E" },
  { home_team: "Эквадор",        away_team: "Германия",     home_flag: "🇪🇨", away_flag: "🇩🇪", kickoff: "2026-06-25T20:00:00Z", stadium: "MetLife Stadium",  city: "Нью-Йорк/Нью-Джерси", stage: "group", group_name: "E" },

  // ── GROUP F: Netherlands, Japan, Sweden, Tunisia ──
  { home_team: "Нидерланды",     away_team: "Япония",       home_flag: "🇳🇱", away_flag: "🇯🇵", kickoff: "2026-06-14T20:00:00Z", stadium: "AT&T Stadium",     city: "Даллас",        stage: "group", group_name: "F" },
  { home_team: "Швеция",         away_team: "Тунис",        home_flag: "🇸🇪", away_flag: "🇹🇳", kickoff: "2026-06-15T02:00:00Z", stadium: "Estadio BBVA",     city: "Монтеррей",     stage: "group", group_name: "F" },
  { home_team: "Нидерланды",     away_team: "Швеция",       home_flag: "🇳🇱", away_flag: "🇸🇪", kickoff: "2026-06-20T17:00:00Z", stadium: "Estadio BBVA",     city: "Монтеррей",     stage: "group", group_name: "F" },
  { home_team: "Тунис",          away_team: "Япония",       home_flag: "🇹🇳", away_flag: "🇯🇵", kickoff: "2026-06-21T04:00:00Z", stadium: "NRG Stadium",      city: "Хьюстон",       stage: "group", group_name: "F" },
  { home_team: "Япония",         away_team: "Швеция",       home_flag: "🇯🇵", away_flag: "🇸🇪", kickoff: "2026-06-25T23:00:00Z", stadium: "Estadio BBVA",     city: "Монтеррей",     stage: "group", group_name: "F" },
  { home_team: "Тунис",          away_team: "Нидерланды",   home_flag: "🇹🇳", away_flag: "🇳🇱", kickoff: "2026-06-25T23:00:00Z", stadium: "AT&T Stadium",     city: "Даллас",        stage: "group", group_name: "F" },

  // ── GROUP G: Belgium, Egypt, Iran, New Zealand ──
  { home_team: "Бельгия",        away_team: "Египет",       home_flag: "🇧🇪", away_flag: "🇪🇬", kickoff: "2026-06-15T19:00:00Z", stadium: "Lumen Field",      city: "Сиэтл",         stage: "group", group_name: "G" },
  { home_team: "Иран",           away_team: "Новая Зеландия", home_flag: "🇮🇷", away_flag: "🇳🇿", kickoff: "2026-06-16T01:00:00Z", stadium: "SoFi Stadium",   city: "Лос-Анджелес",  stage: "group", group_name: "G" },
  { home_team: "Бельгия",        away_team: "Иран",         home_flag: "🇧🇪", away_flag: "🇮🇷", kickoff: "2026-06-21T19:00:00Z", stadium: "SoFi Stadium",     city: "Лос-Анджелес",  stage: "group", group_name: "G" },
  { home_team: "Новая Зеландия", away_team: "Египет",       home_flag: "🇳🇿", away_flag: "🇪🇬", kickoff: "2026-06-22T01:00:00Z", stadium: "SoFi Stadium",     city: "Лос-Анджелес",  stage: "group", group_name: "G" },
  { home_team: "Египет",         away_team: "Иран",         home_flag: "🇪🇬", away_flag: "🇮🇷", kickoff: "2026-06-27T03:00:00Z", stadium: "BC Place",         city: "Ванкувер",      stage: "group", group_name: "G" },
  { home_team: "Новая Зеландия", away_team: "Бельгия",      home_flag: "🇳🇿", away_flag: "🇧🇪", kickoff: "2026-06-27T03:00:00Z", stadium: "Lumen Field",      city: "Сиэтл",         stage: "group", group_name: "G" },

  // ── GROUP H: Spain, Cape Verde, Saudi Arabia, Uruguay ──
  { home_team: "Испания",        away_team: "Кабо-Верде",   home_flag: "🇪🇸", away_flag: "🇨🇻", kickoff: "2026-06-15T16:00:00Z", stadium: "Mercedes-Benz Stadium", city: "Атланта",  stage: "group", group_name: "H" },
  { home_team: "Саудовская Аравия", away_team: "Уругвай",  home_flag: "🇸🇦", away_flag: "🇺🇾", kickoff: "2026-06-15T22:00:00Z", stadium: "Hard Rock Stadium", city: "Майами",       stage: "group", group_name: "H" },
  { home_team: "Испания",        away_team: "Саудовская Аравия", home_flag: "🇪🇸", away_flag: "🇸🇦", kickoff: "2026-06-21T16:00:00Z", stadium: "Mercedes-Benz Stadium", city: "Атланта", stage: "group", group_name: "H" },
  { home_team: "Уругвай",        away_team: "Кабо-Верде",  home_flag: "🇺🇾", away_flag: "🇨🇻", kickoff: "2026-06-21T22:00:00Z", stadium: "Hard Rock Stadium", city: "Майами",       stage: "group", group_name: "H" },
  { home_team: "Кабо-Верде",     away_team: "Саудовская Аравия", home_flag: "🇨🇻", away_flag: "🇸🇦", kickoff: "2026-06-27T00:00:00Z", stadium: "NRG Stadium",    city: "Хьюстон",     stage: "group", group_name: "H" },
  { home_team: "Уругвай",        away_team: "Испания",      home_flag: "🇺🇾", away_flag: "🇪🇸", kickoff: "2026-06-27T00:00:00Z", stadium: "Estadio Akron",    city: "Гвадалахара",   stage: "group", group_name: "H" },

  // ── GROUP I: France, Senegal, Iraq, Norway ──
  { home_team: "Франция",        away_team: "Сенегал",      home_flag: "🇫🇷", away_flag: "🇸🇳", kickoff: "2026-06-16T19:00:00Z", stadium: "MetLife Stadium",  city: "Нью-Йорк/Нью-Джерси", stage: "group", group_name: "I" },
  { home_team: "Ирак",           away_team: "Норвегия",     home_flag: "🇮🇶", away_flag: "🇳🇴", kickoff: "2026-06-16T22:00:00Z", stadium: "Gillette Stadium", city: "Фоксборо",      stage: "group", group_name: "I" },
  { home_team: "Франция",        away_team: "Ирак",         home_flag: "🇫🇷", away_flag: "🇮🇶", kickoff: "2026-06-22T21:00:00Z", stadium: "Gillette Stadium", city: "Фоксборо",      stage: "group", group_name: "I" },
  { home_team: "Норвегия",       away_team: "Сенегал",      home_flag: "🇳🇴", away_flag: "🇸🇳", kickoff: "2026-06-23T00:00:00Z", stadium: "Lincoln Financial Field", city: "Филадельфия", stage: "group", group_name: "I" },
  { home_team: "Норвегия",       away_team: "Франция",      home_flag: "🇳🇴", away_flag: "🇫🇷", kickoff: "2026-06-26T19:00:00Z", stadium: "MetLife Stadium",  city: "Нью-Йорк/Нью-Джерси", stage: "group", group_name: "I" },
  { home_team: "Сенегал",        away_team: "Ирак",         home_flag: "🇸🇳", away_flag: "🇮🇶", kickoff: "2026-06-26T19:00:00Z", stadium: "BMO Field",        city: "Торонто",       stage: "group", group_name: "I" },

  // ── GROUP J: Argentina, Algeria, Austria, Jordan ──
  { home_team: "Аргентина",      away_team: "Алжир",        home_flag: "🇦🇷", away_flag: "🇩🇿", kickoff: "2026-06-17T01:00:00Z", stadium: "Arrowhead Stadium", city: "Канзас-Сити",  stage: "group", group_name: "J" },
  { home_team: "Австрия",        away_team: "Иордания",     home_flag: "🇦🇹", away_flag: "🇯🇴", kickoff: "2026-06-17T04:00:00Z", stadium: "Levi's Stadium",   city: "Санта-Клара",   stage: "group", group_name: "J" },
  { home_team: "Аргентина",      away_team: "Австрия",      home_flag: "🇦🇷", away_flag: "🇦🇹", kickoff: "2026-06-22T17:00:00Z", stadium: "Levi's Stadium",   city: "Санта-Клара",   stage: "group", group_name: "J" },
  { home_team: "Иордания",       away_team: "Алжир",        home_flag: "🇯🇴", away_flag: "🇩🇿", kickoff: "2026-06-23T03:00:00Z", stadium: "AT&T Stadium",     city: "Даллас",        stage: "group", group_name: "J" },
  { home_team: "Алжир",          away_team: "Австрия",      home_flag: "🇩🇿", away_flag: "🇦🇹", kickoff: "2026-06-28T02:00:00Z", stadium: "Levi's Stadium",   city: "Санта-Клара",   stage: "group", group_name: "J" },
  { home_team: "Иордания",       away_team: "Аргентина",    home_flag: "🇯🇴", away_flag: "🇦🇷", kickoff: "2026-06-28T02:00:00Z", stadium: "Arrowhead Stadium", city: "Канзас-Сити",  stage: "group", group_name: "J" },

  // ── GROUP K: Portugal, DR Congo, Uzbekistan, Colombia ──
  { home_team: "Португалия",     away_team: "ДР Конго",     home_flag: "🇵🇹", away_flag: "🇨🇩", kickoff: "2026-06-17T17:00:00Z", stadium: "NRG Stadium",      city: "Хьюстон",       stage: "group", group_name: "K" },
  { home_team: "Узбекистан",     away_team: "Колумбия",     home_flag: "🇺🇿", away_flag: "🇨🇴", kickoff: "2026-06-18T02:00:00Z", stadium: "Estadio Azteca",   city: "Мехико",        stage: "group", group_name: "K" },
  { home_team: "Португалия",     away_team: "Узбекистан",   home_flag: "🇵🇹", away_flag: "🇺🇿", kickoff: "2026-06-23T17:00:00Z", stadium: "Estadio Azteca",   city: "Мехико",        stage: "group", group_name: "K" },
  { home_team: "Колумбия",       away_team: "ДР Конго",     home_flag: "🇨🇴", away_flag: "🇨🇩", kickoff: "2026-06-24T02:00:00Z", stadium: "NRG Stadium",      city: "Хьюстон",       stage: "group", group_name: "K" },
  { home_team: "Колумбия",       away_team: "Португалия",   home_flag: "🇨🇴", away_flag: "🇵🇹", kickoff: "2026-06-27T23:30:00Z", stadium: "Hard Rock Stadium", city: "Майами",       stage: "group", group_name: "K" },
  { home_team: "ДР Конго",       away_team: "Узбекистан",   home_flag: "🇨🇩", away_flag: "🇺🇿", kickoff: "2026-06-27T23:30:00Z", stadium: "Mercedes-Benz Stadium", city: "Атланта",  stage: "group", group_name: "K" },

  // ── GROUP L: England, Croatia, Ghana, Panama ──
  { home_team: "Англия",         away_team: "Хорватия",     home_flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", away_flag: "🇭🇷", kickoff: "2026-06-17T20:00:00Z", stadium: "AT&T Stadium",     city: "Даллас",        stage: "group", group_name: "L" },
  { home_team: "Гана",           away_team: "Панама",       home_flag: "🇬🇭", away_flag: "🇵🇦", kickoff: "2026-06-17T23:00:00Z", stadium: "BMO Field",        city: "Торонто",       stage: "group", group_name: "L" },
  { home_team: "Англия",         away_team: "Гана",         home_flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", away_flag: "🇬🇭", kickoff: "2026-06-23T20:00:00Z", stadium: "BMO Field",        city: "Торонто",       stage: "group", group_name: "L" },
  { home_team: "Панама",         away_team: "Хорватия",     home_flag: "🇵🇦", away_flag: "🇭🇷", kickoff: "2026-06-23T23:00:00Z", stadium: "Gillette Stadium", city: "Фоксборо",      stage: "group", group_name: "L" },
  { home_team: "Панама",         away_team: "Англия",       home_flag: "🇵🇦", away_flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", kickoff: "2026-06-27T21:00:00Z", stadium: "MetLife Stadium",  city: "Нью-Йорк/Нью-Джерси", stage: "group", group_name: "L" },
  { home_team: "Хорватия",       away_team: "Гана",         home_flag: "🇭🇷", away_flag: "🇬🇭", kickoff: "2026-06-27T21:00:00Z", stadium: "Lincoln Financial Field", city: "Филадельфия", stage: "group", group_name: "L" },
];

try {
  // Check if matches already exist
  const existing = await supabaseSelect("matches", "stage=eq.group&select=id");
  const count = existing.length;
  if (count >= 72) {
    console.log(`ℹ️  ${count} group stage matches already exist. Skipping seed.`);
    process.exit(0);
  }
  if (count > 0) {
    console.log(`⚠️  ${count} matches exist. Deleting and re-seeding all group stage matches...`);
    await supabaseDelete("matches", "stage=eq.group");
  }

  console.log(`📋 Inserting ${matches.length} group stage matches...`);

  // Insert in batches of 20 to avoid request size limits
  const BATCH = 20;
  for (let i = 0; i < matches.length; i += BATCH) {
    const batch = matches.slice(i, i + BATCH).map((m) => ({ ...m, status: "scheduled" }));
    await supabaseInsert("matches", batch);
    console.log(`  ✓ Inserted matches ${i + 1}–${Math.min(i + BATCH, matches.length)}`);
  }

  console.log(`✅ Successfully inserted ${matches.length} matches!`);
} catch (err) {
  console.error("❌ Error:", err.message);
  process.exit(1);
}
