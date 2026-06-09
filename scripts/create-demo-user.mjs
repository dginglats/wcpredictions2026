import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");

// Parse .env manually
const env = Object.fromEntries(
  readFileSync(envPath, "utf-8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const [k, ...v] = l.split("=");
      return [k.trim(), v.join("=").trim().replace(/^"|"$/g, "")];
    })
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY);

const DEMO_EMAIL = "demo@mundial2026.local";
const DEMO_PASS  = "Mundial2026!";

const { data, error } = await supabase.auth.signUp({
  email: DEMO_EMAIL,
  password: DEMO_PASS,
  options: { data: { username: "demo_player" } },
});

if (error) {
  if (error.message.includes("already registered")) {
    console.log("✅ Демо-аккаунт уже существует, можно логиниться:");
  } else {
    console.error("❌ Ошибка:", error.message);
    process.exit(1);
  }
} else {
  console.log("✅ Демо-аккаунт создан:");
}

console.log(`   Email:    ${DEMO_EMAIL}`);
console.log(`   Пароль:   ${DEMO_PASS}`);
console.log("\nЗайди на http://localhost:5173/auth и войди.");
