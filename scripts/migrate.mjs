/**
 * Run this after setting SUPABASE_DB_PASSWORD in .env
 * node scripts/migrate.mjs
 */
import pg from "pg";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse .env
const envPath = resolve(__dirname, "../.env");
const env = Object.fromEntries(
  readFileSync(envPath, "utf-8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const [k, ...v] = l.split("=");
      return [k.trim(), v.join("=").trim().replace(/^"|"$/g, "")];
    })
);

const ref = env.SUPABASE_PROJECT_ID;
const password = env.SUPABASE_DB_PASSWORD;

if (!ref || !password) {
  console.error("❌ Set SUPABASE_PROJECT_ID and SUPABASE_DB_PASSWORD in .env");
  process.exit(1);
}

// Try multiple Supabase pooler regions/formats
const encodedPw = encodeURIComponent(password);
const connectionStrings = [
  `postgresql://postgres.${ref}:${encodedPw}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${ref}:${encodedPw}@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres:${encodedPw}@db.${ref}.supabase.co:5432/postgres`,
];

let client;
let connected = false;
for (const cs of connectionStrings) {
  try {
    client = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
    await client.connect();
    console.log("✅ Connected via:", cs.split("@")[1]);
    connected = true;
    break;
  } catch (e) {
    console.log("⏭ Trying next:", e.message.substring(0, 60));
    try { await client.end(); } catch {}
  }
}
if (!connected) { console.error("❌ Could not connect to Supabase DB. Check password."); process.exit(1); }

// Combined migration SQL
const SQL = `
-- =============================================
-- Migration 1: Roles, Profiles, Matches, etc.
-- =============================================

-- Roles
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'player');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  avatar_url TEXT,
  car TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Profiles visible to authenticated" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins update any profile" ON public.profiles;
CREATE POLICY "Profiles visible to authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Admins update any profile" ON public.profiles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Auto-create profile + assign role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_username TEXT;
  v_car TEXT;
BEGIN
  v_username := COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1));
  v_car := NEW.raw_user_meta_data->>'car';
  INSERT INTO public.profiles (id, username, email, car)
  VALUES (NEW.id, v_username, NEW.email, v_car)
  ON CONFLICT (id) DO NOTHING;
  IF NEW.email = 'dginglats@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'player') ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Matches
DO $$ BEGIN
  CREATE TYPE public.match_status AS ENUM ('scheduled', 'live', 'finished');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.match_stage AS ENUM ('group','round_of_32','round_of_16','quarter_final','semi_final','third_place','final');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_flag TEXT,
  away_flag TEXT,
  kickoff TIMESTAMPTZ NOT NULL,
  stadium TEXT,
  city TEXT,
  stage match_stage NOT NULL DEFAULT 'group',
  group_name TEXT,
  status match_status NOT NULL DEFAULT 'scheduled',
  home_score INT,
  away_score INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.matches TO authenticated;
GRANT ALL ON public.matches TO service_role;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Matches visible to authenticated" ON public.matches;
DROP POLICY IF EXISTS "Admins manage matches" ON public.matches;
CREATE POLICY "Matches visible to authenticated" ON public.matches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage matches" ON public.matches FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Predictions
CREATE TABLE IF NOT EXISTS public.predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  home_score INT NOT NULL,
  away_score INT NOT NULL,
  points INT,
  outcome_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, match_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.predictions TO authenticated;
GRANT ALL ON public.predictions TO service_role;
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Predictions visible to all auth" ON public.predictions;
DROP POLICY IF EXISTS "Users insert own predictions" ON public.predictions;
DROP POLICY IF EXISTS "Users update own predictions before kickoff" ON public.predictions;
DROP POLICY IF EXISTS "Users delete own predictions before kickoff" ON public.predictions;
DROP POLICY IF EXISTS "Admins manage predictions" ON public.predictions;
CREATE POLICY "Predictions visible to all auth" ON public.predictions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert own predictions" ON public.predictions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own predictions before kickoff" ON public.predictions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.matches m WHERE m.id = match_id AND m.kickoff > now() AND m.status = 'scheduled'))
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own predictions before kickoff" ON public.predictions FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.matches m WHERE m.id = match_id AND m.kickoff > now() AND m.status = 'scheduled'));
CREATE POLICY "Admins manage predictions" ON public.predictions FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Validation trigger
CREATE OR REPLACE FUNCTION public.validate_prediction()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_kickoff TIMESTAMPTZ;
BEGIN
  SELECT kickoff INTO v_kickoff FROM public.matches WHERE id = NEW.match_id;
  IF v_kickoff IS NULL THEN RAISE EXCEPTION 'Match not found'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') AND v_kickoff <= now() THEN
    RAISE EXCEPTION 'Match already started, prediction locked';
  END IF;
  IF NEW.home_score < 0 OR NEW.away_score < 0 OR NEW.home_score > 30 OR NEW.away_score > 30 THEN
    RAISE EXCEPTION 'Invalid score';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_prediction ON public.predictions;
CREATE TRIGGER trg_validate_prediction BEFORE INSERT OR UPDATE ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.validate_prediction();

-- Scoring function
CREATE OR REPLACE FUNCTION public.calculate_points(
  p_pred_h INT, p_pred_a INT, p_res_h INT, p_res_a INT
) RETURNS TABLE(points INT, outcome_type TEXT) LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF p_pred_h = p_res_h AND p_pred_a = p_res_a THEN RETURN QUERY SELECT 3, 'bingo'::TEXT; RETURN; END IF;
  IF p_pred_h = p_pred_a AND p_res_h = p_res_a THEN RETURN QUERY SELECT 2, 'draw'::TEXT; RETURN; END IF;
  IF sign(p_pred_h - p_pred_a) = sign(p_res_h - p_res_a) AND p_pred_h <> p_pred_a AND p_res_h <> p_res_a THEN
    RETURN QUERY SELECT 1, 'outcome'::TEXT; RETURN;
  END IF;
  RETURN QUERY SELECT 0, 'miss'::TEXT;
END;
$$;

-- Recalc trigger
CREATE OR REPLACE FUNCTION public.recalc_match_predictions()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'finished' AND NEW.home_score IS NOT NULL AND NEW.away_score IS NOT NULL THEN
    UPDATE public.predictions p
    SET points = c.points, outcome_type = c.outcome_type, updated_at = now()
    FROM public.calculate_points(p.home_score, p.away_score, NEW.home_score, NEW.away_score) c
    WHERE p.match_id = NEW.id;
  ELSE
    UPDATE public.predictions SET points = NULL, outcome_type = NULL WHERE match_id = NEW.id;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_recalc_predictions ON public.matches;
CREATE TRIGGER trg_recalc_predictions AFTER UPDATE OF home_score, away_score, status ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.recalc_match_predictions();

-- Leaderboard view
CREATE OR REPLACE VIEW public.leaderboard AS
SELECT
  pr.id AS user_id,
  pr.username,
  pr.car,
  pr.avatar_url,
  COALESCE(SUM(p.points),0)::INT AS total_points,
  COUNT(*) FILTER (WHERE p.outcome_type = 'bingo')::INT AS bingo_count,
  COUNT(*) FILTER (WHERE p.outcome_type = 'draw')::INT AS draw_count,
  COUNT(*) FILTER (WHERE p.outcome_type = 'outcome')::INT AS outcome_count,
  COUNT(*) FILTER (WHERE p.outcome_type = 'miss')::INT AS miss_count,
  COUNT(*) FILTER (WHERE p.outcome_type IS NOT NULL)::INT AS finished_count,
  CASE WHEN COUNT(*) FILTER (WHERE p.outcome_type IS NOT NULL) > 0
       THEN ROUND(100.0 * COUNT(*) FILTER (WHERE p.outcome_type IN ('bingo','draw','outcome'))::NUMERIC
                  / COUNT(*) FILTER (WHERE p.outcome_type IS NOT NULL), 1)
       ELSE 0 END AS success_rate
FROM public.profiles pr
LEFT JOIN public.predictions p ON p.user_id = pr.id
GROUP BY pr.id, pr.username, pr.car, pr.avatar_url;

ALTER VIEW public.leaderboard SET (security_invoker = on);
GRANT SELECT ON public.leaderboard TO authenticated;

-- Revoke dangerous functions from public
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_prediction() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_match_predictions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calculate_points(int,int,int,int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
`;

async function run() {
  console.log("🔌 Connecting to Supabase PostgreSQL...");
  try {    console.log("📦 Running migrations...");
    await client.query(SQL);
    console.log("✅ All tables, functions and policies created");

    // Confirm demo user email and set admin
    console.log("👤 Setting up users...");
    await client.query(`
      UPDATE auth.users SET email_confirmed_at = now(), updated_at = now()
      WHERE email IN ('demo@mundial2026.local', 'dginglats@gmail.com')
      AND email_confirmed_at IS NULL;
    `);

    // Ensure dginglats@gmail.com has admin role if already registered
    await client.query(`
      INSERT INTO public.user_roles (user_id, role)
      SELECT id, 'admin' FROM auth.users WHERE email = 'dginglats@gmail.com'
      ON CONFLICT DO NOTHING;
    `);

    console.log("✅ Users configured");
    console.log("\n🎉 Done! Database is ready.");
  } catch (err) {
    console.error("❌ Error:", err.message);
  } finally {
    await client.end();
  }
}

run();
