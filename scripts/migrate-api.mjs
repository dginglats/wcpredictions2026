/**
 * Apply migrations via Supabase Management API (no direct DB connection needed)
 * node scripts/migrate-api.mjs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");
const env = Object.fromEntries(
  readFileSync(envPath, "utf-8").split("\n").filter(l => l.includes("=")).map(l => {
    const [k, ...v] = l.split("=");
    return [k.trim(), v.join("=").trim().replace(/^"|"$/g, "")];
  })
);

const ref = env.SUPABASE_PROJECT_ID;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!ref || !serviceKey) { console.error("❌ Missing SUPABASE_PROJECT_ID or SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

async function sql(query) {
  const res = await fetch(`https://${ref}.supabase.co/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

// Use the pg-based approach via Supabase's SQL endpoint
async function execSQL(query) {
  const res = await fetch(`https://${ref}.supabase.co/pg/query`, {
    method: "POST",
    headers: {
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.substring(0, 200)}`);
  return text;
}

// Use Management API
async function execManagement(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${text.substring(0, 300)}`);
  return JSON.parse(text);
}

const MIGRATION_SQL = readFileSync(resolve(__dirname, "../supabase/migrations/20260609102220_ff508a06-4f2a-4dd8-9025-37a99b2c2850.sql"), "utf-8")
  + "\n" + readFileSync(resolve(__dirname, "../supabase/migrations/20260609102236_85347d7a-bf5e-41bf-b52f-66d2bb3a2eb5.sql"), "utf-8")
  + "\n" + readFileSync(resolve(__dirname, "../supabase/migrations/20260609102250_917031ac-dd52-4651-a6e4-a0802e742d28.sql"), "utf-8");

async function run() {
  console.log(`🔌 Project: ${ref}`);

  // Try Management API first (requires service_role or PAT)
  console.log("📦 Running migrations via Management API...");
  try {
    await execManagement(MIGRATION_SQL);
    console.log("✅ Migrations applied!");
  } catch (e) {
    console.log("ℹ️  Management API:", e.message.substring(0, 100));
    console.log("⚠️  Falling back to direct SQL file output...");
    
    // Fallback: write SQL to clipboard hint
    console.log("\n" + "=".repeat(60));
    console.log("MANUAL FALLBACK:");
    console.log("Go to: https://supabase.com/dashboard/project/" + ref + "/sql/new");
    console.log("Paste and run the migration SQL files from supabase/migrations/");
    console.log("=".repeat(60) + "\n");
    return;
  }

  // Confirm demo user email
  console.log("👤 Confirming user emails...");
  try {
    // Use Admin Auth API to confirm emails
    for (const email of ["demo@mundial2026.local", "dginglats@gmail.com"]) {
      const listRes = await fetch(`https://${ref}.supabase.co/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
        headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` }
      });
      const data = await listRes.json();
      const users = data.users || [];
      for (const u of users) {
        if (!u.email_confirmed_at) {
          await fetch(`https://${ref}.supabase.co/auth/v1/admin/users/${u.id}`, {
            method: "PUT",
            headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ email_confirm: true })
          });
          console.log(`✅ Confirmed: ${email}`);
        } else {
          console.log(`ℹ️  Already confirmed: ${email}`);
        }
      }
    }
  } catch(e) {
    console.log("ℹ️  User confirmation:", e.message);
  }

  console.log("\n🎉 Done! Supabase is ready.");
  console.log(`\nDashboard: https://supabase.com/dashboard/project/${ref}/editor`);
}

run().catch(e => console.error("❌", e.message));
