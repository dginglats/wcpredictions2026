-- =====================================================================
-- Надёжная автосинхронизация счёта матчей через Supabase pg_cron.
-- Не зависит от GitHub Actions: функция public.sync_scores_cron() каждые
-- 2 минуты тянет результаты ЧМ из football-data.org (расширение http) и
-- обновляет public.matches по external_id. Триггеры пересчитывают очки,
-- view leaderboard и статистика — на лету. Ручных действий не требуется.
--
-- Все 104 матча уже имеют external_id (= id матча в football-data), поэтому
-- сопоставление тривиально и не может ошибиться. Команды плей-офф (пока
-- "TBD") заполняются автоматически, когда определяются пары.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- ── Секрет: токен football-data.org (RLS без политик => только definer/service) ──
CREATE TABLE IF NOT EXISTS public.sync_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
ALTER TABLE public.sync_config ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.sync_config TO service_role;

-- ── Журнал синхронизаций (виден админам) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.sync_log (
  id BIGSERIAL PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.sync_log TO authenticated;
GRANT ALL ON public.sync_log TO service_role;
DROP POLICY IF EXISTS "Admins read sync log" ON public.sync_log;
CREATE POLICY "Admins read sync log" ON public.sync_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ── Словарь команд (англ. → рус. + ISO-код флага) для заполнения плей-офф ──
CREATE TABLE IF NOT EXISTS public.team_aliases (
  api_norm   TEXT PRIMARY KEY,
  local_name TEXT NOT NULL,
  flag       TEXT
);
GRANT SELECT ON public.team_aliases TO authenticated;
GRANT ALL ON public.team_aliases TO service_role;

INSERT INTO public.team_aliases (api_norm, local_name, flag) VALUES
  ('mexico','Мексика','mx'),('southafrica','ЮАР','za'),
  ('southkorea','Южная Корея','kr'),('korearepublic','Южная Корея','kr'),('korea','Южная Корея','kr'),
  ('czechrepublic','Чехия','cz'),('czechia','Чехия','cz'),
  ('canada','Канада','ca'),('bosniaandherzegovina','Босния и Герц.','ba'),
  ('bosniaherzegovina','Босния и Герц.','ba'),('bosnia','Босния и Герц.','ba'),
  ('qatar','Катар','qa'),('switzerland','Швейцария','ch'),('brazil','Бразилия','br'),
  ('morocco','Марокко','ma'),('haiti','Гаити','ht'),('scotland','Шотландия','gb-sct'),
  ('usa','США','us'),('unitedstates','США','us'),('paraguay','Парагвай','py'),
  ('australia','Австралия','au'),('turkey','Турция','tr'),('turkiye','Турция','tr'),
  ('germany','Германия','de'),('curacao','Кюрасао','cw'),('ivorycoast','Кот-д''Ивуар','ci'),
  ('cotedivoire','Кот-д''Ивуар','ci'),('ecuador','Эквадор','ec'),('netherlands','Нидерланды','nl'),
  ('japan','Япония','jp'),('sweden','Швеция','se'),('tunisia','Тунис','tn'),
  ('belgium','Бельгия','be'),('egypt','Египет','eg'),('iran','Иран','ir'),('iriran','Иран','ir'),
  ('newzealand','Новая Зеландия','nz'),('spain','Испания','es'),('capeverde','Кабо-Верде','cv'),
  ('capeverdeislands','Кабо-Верде','cv'),('saudiarabia','Саудовская Аравия','sa'),
  ('uruguay','Уругвай','uy'),('france','Франция','fr'),('senegal','Сенегал','sn'),
  ('iraq','Ирак','iq'),('norway','Норвегия','no'),('argentina','Аргентина','ar'),
  ('algeria','Алжир','dz'),('austria','Австрия','at'),('jordan','Иордания','jo'),
  ('portugal','Португалия','pt'),('drcongo','ДР Конго','cd'),('congodr','ДР Конго','cd'),
  ('democraticrepublicofcongo','ДР Конго','cd'),('uzbekistan','Узбекистан','uz'),
  ('colombia','Колумбия','co'),('england','Англия','gb-eng'),('croatia','Хорватия','hr'),
  ('ghana','Гана','gh'),('panama','Панама','pa')
ON CONFLICT (api_norm) DO UPDATE SET local_name = EXCLUDED.local_name, flag = EXCLUDED.flag;

-- Нормализация имени команды как в scripts/sync-scores.mjs: lower + без диакритики + только [a-z0-9].
CREATE OR REPLACE FUNCTION public.norm_team(p TEXT)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = public, extensions AS $$
  SELECT lower(regexp_replace(extensions.unaccent(coalesce(p, '')), '[^a-zA-Z0-9]', '', 'g'))
$$;

-- ── Основная функция синхронизации (вызывается pg_cron) ────────────────
CREATE OR REPLACE FUNCTION public.sync_scores_cron()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_token   TEXT;
  v_http_status INT;
  v_body    TEXT;
  v_json    JSONB;
  rec       JSONB;
  v_ext     TEXT;
  v_api_st  TEXT;
  v_status  public.match_status;
  v_scored  BOOLEAN;
  v_hs      INT;
  v_as      INT;
  v_home_api TEXT;
  v_away_api TEXT;
  v_changed INT := 0;
  v_filled  INT := 0;
BEGIN
  SELECT value INTO v_token FROM public.sync_config WHERE key = 'football_data_token';
  IF v_token IS NULL OR v_token = '' THEN
    INSERT INTO public.sync_log(level, message) VALUES ('error', 'Токен football_data_token не задан в sync_config');
    RETURN jsonb_build_object('ok', false, 'error', 'token_missing');
  END IF;

  -- football-data.org иногда отвечает медленно; дефолтный таймаут http (~1с) мал.
  PERFORM extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '8000');
  PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '25000');

  BEGIN
    SELECT r.status, r.content INTO v_http_status, v_body
    FROM extensions.http((
      'GET', 'https://api.football-data.org/v4/competitions/WC/matches',
      ARRAY[extensions.http_header('X-Auth-Token', v_token)], NULL, NULL
    )::extensions.http_request) AS r;
  EXCEPTION WHEN OTHERS THEN
    -- разовый сетевой сбой: логируем предупреждение, следующий тик повторит
    INSERT INTO public.sync_log(level, message)
      VALUES ('warn', format('Запрос к API не удался (повтор через 2 мин): %s', left(SQLERRM, 200)));
    RETURN jsonb_build_object('ok', false, 'error', 'http_failed');
  END;

  IF v_http_status <> 200 THEN
    INSERT INTO public.sync_log(level, message)
      VALUES ('error', format('football-data HTTP %s: %s', v_http_status, left(coalesce(v_body,''), 300)));
    RETURN jsonb_build_object('ok', false, 'http_status', v_http_status);
  END IF;

  v_json := v_body::jsonb;

  FOR rec IN SELECT jsonb_array_elements(v_json->'matches') LOOP
    v_ext    := rec->>'id';
    v_api_st := rec->>'status';
    v_status := CASE
      WHEN v_api_st = 'FINISHED' THEN 'finished'
      WHEN v_api_st IN ('IN_PLAY','PAUSED') THEN 'live'
      ELSE 'scheduled' END::public.match_status;
    v_scored := v_status <> 'scheduled';
    v_hs := CASE WHEN v_scored THEN NULLIF(rec->'score'->'fullTime'->>'home','')::int END;
    v_as := CASE WHEN v_scored THEN NULLIF(rec->'score'->'fullTime'->>'away','')::int END;

    -- 1) Счёт + статус (только если реально изменилось — иначе не дёргаем пересчёт)
    UPDATE public.matches
       SET status = v_status, home_score = v_hs, away_score = v_as
     WHERE external_id = v_ext
       AND (status IS DISTINCT FROM v_status
            OR home_score IS DISTINCT FROM v_hs
            OR away_score IS DISTINCT FROM v_as);
    IF FOUND THEN v_changed := v_changed + 1; END IF;

    -- 2) Заполнение команд плей-офф, когда определились (только если сейчас 'TBD')
    v_home_api := rec->'homeTeam'->>'name';
    v_away_api := rec->'awayTeam'->>'name';
    IF v_home_api IS NOT NULL AND v_home_api <> '' THEN
      UPDATE public.matches m
         SET home_team = COALESCE((SELECT local_name FROM public.team_aliases WHERE api_norm = public.norm_team(v_home_api)), v_home_api),
             home_flag = (SELECT flag FROM public.team_aliases WHERE api_norm = public.norm_team(v_home_api))
       WHERE m.external_id = v_ext AND m.home_team = 'TBD';
      IF FOUND THEN v_filled := v_filled + 1; END IF;
    END IF;
    IF v_away_api IS NOT NULL AND v_away_api <> '' THEN
      UPDATE public.matches m
         SET away_team = COALESCE((SELECT local_name FROM public.team_aliases WHERE api_norm = public.norm_team(v_away_api)), v_away_api),
             away_flag = (SELECT flag FROM public.team_aliases WHERE api_norm = public.norm_team(v_away_api))
       WHERE m.external_id = v_ext AND m.away_team = 'TBD';
    END IF;
  END LOOP;

  INSERT INTO public.sync_log(level, message)
    VALUES ('info', format('Синхронизация: изменено счётов %s, заполнено команд %s', v_changed, v_filled));

  RETURN jsonb_build_object('ok', true, 'changed', v_changed, 'filled', v_filled);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_scores_cron() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.norm_team(text) FROM PUBLIC, anon;

-- ── Ручной запуск из админки (RPC) — только админ ─────────────────────
CREATE OR REPLACE FUNCTION public.trigger_sync()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Только администратор может запускать синхронизацию';
  END IF;
  RETURN public.sync_scores_cron();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trigger_sync() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.trigger_sync() TO authenticated;

-- ── Расписание pg_cron: каждые 2 минуты ───────────────────────────────
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-wc-scores') THEN
    PERFORM cron.unschedule('sync-wc-scores');
  END IF;
  PERFORM cron.schedule('sync-wc-scores', '*/2 * * * *', 'SELECT public.sync_scores_cron();');
END
$cron$;
