-- =====================================================================
-- Автоматическая загрузка результатов матчей ЧМ-2026
-- Источник: football-data.org (бесплатный тариф), соревнование "WC".
--
-- Как это работает:
--   1. pg_cron каждые 2 минуты вызывает public.sync_match_results()
--   2. Функция через расширение http тянет матчи ЧМ из API
--   3. Сопоставляет команды (англ. -> рус.) и находит матч в public.matches
--   4. Проставляет home_score / away_score / status
--   5. Существующий триггер trg_recalc_predictions автоматически
--      пересчитывает очки всем игрокам, а view leaderboard и статистика
--      собираются на лету. Ручной ввод результатов больше не нужен.
--
-- ВАЖНО: токен football-data.org НЕ хранится в этом файле. Его кладёт
-- скрипт scripts/setup-auto-results.mjs в таблицу public.app_settings.
-- =====================================================================

-- ── Расширения ────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- ── Колонки для связи с внешним API ───────────────────────────────────
-- external_id мог существовать ранее как text — приводим к bigint.
DO $col$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='matches' AND column_name='external_id'
  ) THEN
    ALTER TABLE public.matches ADD COLUMN external_id BIGINT;
  ELSIF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='matches' AND column_name='external_id'
  ) <> 'bigint' THEN
    ALTER TABLE public.matches
      ALTER COLUMN external_id TYPE BIGINT
      USING NULLIF(btrim(external_id::text), '')::bigint;
  END IF;
END
$col$;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS last_synced TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS matches_external_id_key
  ON public.matches(external_id) WHERE external_id IS NOT NULL;

-- ── Секреты приложения (токен API). RLS без политик => недоступно
--     обычным пользователям; читает только SECURITY DEFINER-функция. ──
CREATE TABLE IF NOT EXISTS public.app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.app_settings TO service_role;

-- ── Журнал синхронизаций (виден админам) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.sync_log (
  id         BIGSERIAL PRIMARY KEY,
  level      TEXT NOT NULL DEFAULT 'info',
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.sync_log TO authenticated;
GRANT ALL ON public.sync_log TO service_role;
DROP POLICY IF EXISTS "Admins read sync log" ON public.sync_log;
CREATE POLICY "Admins read sync log" ON public.sync_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ── Словарь названий команд: API (англ.) -> локальное (рус.) ───────────
CREATE TABLE IF NOT EXISTS public.team_aliases (
  api_norm   TEXT PRIMARY KEY,   -- нормализованное имя из API (lower, без диакритики)
  local_name TEXT NOT NULL       -- точное имя как в public.matches
);
GRANT SELECT ON public.team_aliases TO authenticated;
GRANT ALL ON public.team_aliases TO service_role;

-- Заполняем словарь. Несколько вариантов написания на команду —
-- на случай, если API использует альтернативное название.
INSERT INTO public.team_aliases (api_norm, local_name)
SELECT DISTINCT ON (norm) norm, local_name
FROM (
  SELECT lower(extensions.unaccent(btrim(a))) AS norm, l AS local_name
  FROM (VALUES
  ('Australia','Австралия'),
  ('Austria','Австрия'),
  ('Algeria','Алжир'),
  ('England','Англия'),
  ('Argentina','Аргентина'),
  ('Belgium','Бельгия'),
  ('Bosnia and Herzegovina','Босния и Герц.'),
  ('Bosnia-Herzegovina','Босния и Герц.'),
  ('Bosnia & Herzegovina','Босния и Герц.'),
  ('Brazil','Бразилия'),
  ('Haiti','Гаити'),
  ('Ghana','Гана'),
  ('Germany','Германия'),
  ('DR Congo','ДР Конго'),
  ('Congo DR','ДР Конго'),
  ('Democratic Republic of the Congo','ДР Конго'),
  ('Democratic Republic of Congo','ДР Конго'),
  ('Egypt','Египет'),
  ('Jordan','Иордания'),
  ('Iraq','Ирак'),
  ('Iran','Иран'),
  ('IR Iran','Иран'),
  ('Spain','Испания'),
  ('Cape Verde','Кабо-Верде'),
  ('Cape Verde Islands','Кабо-Верде'),
  ('Cabo Verde','Кабо-Верде'),
  ('Canada','Канада'),
  ('Qatar','Катар'),
  ('Colombia','Колумбия'),
  ('Ivory Coast','Кот-д''Ивуар'),
  ('Cote d''Ivoire','Кот-д''Ивуар'),
  ('Côte d''Ivoire','Кот-д''Ивуар'),
  ('Curacao','Кюрасао'),
  ('Curaçao','Кюрасао'),
  ('Morocco','Марокко'),
  ('Mexico','Мексика'),
  ('Netherlands','Нидерланды'),
  ('New Zealand','Новая Зеландия'),
  ('Norway','Норвегия'),
  ('Panama','Панама'),
  ('Paraguay','Парагвай'),
  ('Portugal','Португалия'),
  ('United States','США'),
  ('USA','США'),
  ('United States of America','США'),
  ('Saudi Arabia','Саудовская Аравия'),
  ('Senegal','Сенегал'),
  ('Tunisia','Тунис'),
  ('Turkey','Турция'),
  ('Turkiye','Турция'),
  ('Türkiye','Турция'),
  ('Uzbekistan','Узбекистан'),
  ('Uruguay','Уругвай'),
  ('France','Франция'),
  ('Croatia','Хорватия'),
  ('Czechia','Чехия'),
  ('Czech Republic','Чехия'),
  ('Switzerland','Швейцария'),
  ('Sweden','Швеция'),
  ('Scotland','Шотландия'),
  ('Ecuador','Эквадор'),
  ('South Africa','ЮАР'),
  ('South Korea','Южная Корея'),
  ('Korea Republic','Южная Корея'),
  ('Korea','Южная Корея'),
  ('Japan','Япония')
  ) AS v(a, l)
) s
ORDER BY norm
ON CONFLICT (api_norm) DO UPDATE SET local_name = EXCLUDED.local_name;

-- ── Резолвер: имя из API -> локальное имя команды ─────────────────────
CREATE OR REPLACE FUNCTION public.resolve_local_team(p_api TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT local_name FROM public.team_aliases
   WHERE api_norm = lower(extensions.unaccent(btrim(coalesce(p_api, ''))))
   LIMIT 1;
$$;

-- ── Основная функция синхронизации результатов ────────────────────────
CREATE OR REPLACE FUNCTION public.sync_match_results()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_token        TEXT;
  v_status       INT;
  v_body         TEXT;
  v_json         JSONB;
  rec            JSONB;
  v_api_id       BIGINT;
  v_api_status   TEXT;
  v_home_api     TEXT;
  v_away_api     TEXT;
  v_home_loc     TEXT;
  v_away_loc     TEXT;
  v_hs           INT;
  v_as           INT;
  v_utc          TIMESTAMPTZ;
  v_local_status public.match_status;
  v_match_id     UUID;
  v_swapped      BOOLEAN;
  v_updated      INT := 0;
  v_unmatched    INT := 0;
BEGIN
  SELECT value INTO v_token FROM public.app_settings WHERE key = 'football_data_token';
  IF v_token IS NULL OR v_token = '' THEN
    INSERT INTO public.sync_log(level, message)
      VALUES ('error', 'Токен football_data_token не задан в app_settings');
    RETURN jsonb_build_object('ok', false, 'error', 'token_missing');
  END IF;

  -- Запрос к API (синхронный, расширение http)
  SELECT r.status, r.content INTO v_status, v_body
  FROM extensions.http((
    'GET',
    'https://api.football-data.org/v4/competitions/WC/matches',
    ARRAY[extensions.http_header('X-Auth-Token', v_token)],
    NULL,
    NULL
  )::extensions.http_request) AS r;

  IF v_status <> 200 THEN
    INSERT INTO public.sync_log(level, message)
      VALUES ('error', format('API вернул HTTP %s: %s', v_status, left(coalesce(v_body, ''), 400)));
    RETURN jsonb_build_object('ok', false, 'http_status', v_status);
  END IF;

  v_json := v_body::jsonb;

  FOR rec IN SELECT jsonb_array_elements(v_json->'matches') LOOP
    v_api_id     := (rec->>'id')::bigint;
    v_api_status := rec->>'status';
    v_home_api   := rec->'homeTeam'->>'name';
    v_away_api   := rec->'awayTeam'->>'name';
    v_utc        := (rec->>'utcDate')::timestamptz;
    v_hs         := NULLIF(rec->'score'->'fullTime'->>'home', '')::int;
    v_as         := NULLIF(rec->'score'->'fullTime'->>'away', '')::int;

    v_local_status := CASE
      WHEN v_api_status = 'FINISHED'                          THEN 'finished'
      WHEN v_api_status IN ('IN_PLAY','PAUSED','SUSPENDED')   THEN 'live'
      ELSE 'scheduled'
    END::public.match_status;

    v_home_loc := public.resolve_local_team(v_home_api);
    v_away_loc := public.resolve_local_team(v_away_api);

    -- 1) уже привязанный матч по external_id
    v_match_id := NULL;
    v_swapped  := false;
    SELECT id INTO v_match_id FROM public.matches WHERE external_id = v_api_id;

    -- 2) иначе ищем по паре команд (в пределах ±3 дней от kickoff)
    IF v_match_id IS NULL AND v_home_loc IS NOT NULL AND v_away_loc IS NOT NULL THEN
      SELECT id INTO v_match_id FROM public.matches
       WHERE home_team = v_home_loc AND away_team = v_away_loc
         AND abs(extract(epoch FROM (kickoff - v_utc))) < 259200
       ORDER BY abs(extract(epoch FROM (kickoff - v_utc))) LIMIT 1;

      IF v_match_id IS NULL THEN
        -- хозяева/гости могли быть записаны в обратном порядке
        SELECT id INTO v_match_id FROM public.matches
         WHERE home_team = v_away_loc AND away_team = v_home_loc
           AND abs(extract(epoch FROM (kickoff - v_utc))) < 259200
         ORDER BY abs(extract(epoch FROM (kickoff - v_utc))) LIMIT 1;
        IF v_match_id IS NOT NULL THEN v_swapped := true; END IF;
      END IF;
    END IF;

    IF v_match_id IS NULL THEN
      v_unmatched := v_unmatched + 1;
      INSERT INTO public.sync_log(level, message)
        VALUES ('warn', format('Нет матча в базе: %s vs %s (api id %s, %s)',
                               v_home_api, v_away_api, v_api_id, v_api_status));
      CONTINUE;
    END IF;

    UPDATE public.matches
       SET external_id = v_api_id,
           status      = v_local_status,
           home_score  = CASE WHEN v_local_status = 'scheduled' THEN NULL
                              WHEN v_swapped THEN v_as ELSE v_hs END,
           away_score  = CASE WHEN v_local_status = 'scheduled' THEN NULL
                              WHEN v_swapped THEN v_hs ELSE v_as END,
           last_synced = now()
     WHERE id = v_match_id;

    v_updated := v_updated + 1;
  END LOOP;

  INSERT INTO public.sync_log(level, message)
    VALUES ('info', format('Синхронизация завершена: обновлено %s, не сопоставлено %s', v_updated, v_unmatched));

  RETURN jsonb_build_object('ok', true, 'updated', v_updated, 'unmatched', v_unmatched);
END;
$$;

-- Функцию синхронизации может вызывать только владелец / cron / service_role.
REVOKE EXECUTE ON FUNCTION public.sync_match_results()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_local_team(text)  FROM PUBLIC, anon;

-- ── Починка блокировки прогнозов ──────────────────────────────────────
-- Прежняя версия запрещала ЛЮБОЕ изменение прогноза после старта матча,
-- включая системный пересчёт очков (он выполняется без auth.uid(), поэтому
-- не распознаётся как админ). Теперь блокировка срабатывает только когда
-- меняется сам счёт-прогноз пользователя (home_score/away_score), а не
-- когда система проставляет points/outcome_type.
CREATE OR REPLACE FUNCTION public.validate_prediction()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kickoff TIMESTAMPTZ;
BEGIN
  SELECT kickoff INTO v_kickoff FROM public.matches WHERE id = NEW.match_id;
  IF v_kickoff IS NULL THEN RAISE EXCEPTION 'Match not found'; END IF;

  IF TG_OP = 'INSERT'
     OR NEW.home_score IS DISTINCT FROM OLD.home_score
     OR NEW.away_score IS DISTINCT FROM OLD.away_score THEN
    IF NOT public.has_role(auth.uid(), 'admin') AND v_kickoff <= now() THEN
      RAISE EXCEPTION 'Match already started, prediction locked';
    END IF;
    IF NEW.home_score < 0 OR NEW.away_score < 0 OR NEW.home_score > 30 OR NEW.away_score > 30 THEN
      RAISE EXCEPTION 'Invalid score';
    END IF;
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.validate_prediction() FROM PUBLIC, anon, authenticated;

-- ── Починка пересчёта очков ───────────────────────────────────────────
-- Прежняя версия триггера вызывала calculate_points() в FROM со ссылкой
-- на обновляемую таблицу p, что Postgres запрещает. Встраиваем логику
-- начисления очков прямо в UPDATE. Триггер trg_recalc_predictions
-- (AFTER UPDATE OF home_score, away_score, status) уже навешан — меняем
-- только тело функции.
CREATE OR REPLACE FUNCTION public.recalc_match_predictions()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'finished' AND NEW.home_score IS NOT NULL AND NEW.away_score IS NOT NULL THEN
    UPDATE public.predictions p
       SET points = CASE
             WHEN p.home_score = NEW.home_score AND p.away_score = NEW.away_score THEN 3
             WHEN p.home_score = p.away_score AND NEW.home_score = NEW.away_score THEN 2
             WHEN sign(p.home_score - p.away_score) = sign(NEW.home_score - NEW.away_score)
                  AND p.home_score <> p.away_score AND NEW.home_score <> NEW.away_score THEN 1
             ELSE 0 END,
           outcome_type = CASE
             WHEN p.home_score = NEW.home_score AND p.away_score = NEW.away_score THEN 'bingo'
             WHEN p.home_score = p.away_score AND NEW.home_score = NEW.away_score THEN 'draw'
             WHEN sign(p.home_score - p.away_score) = sign(NEW.home_score - NEW.away_score)
                  AND p.home_score <> p.away_score AND NEW.home_score <> NEW.away_score THEN 'outcome'
             ELSE 'miss' END,
           updated_at = now()
     WHERE p.match_id = NEW.id;
  ELSE
    UPDATE public.predictions SET points = NULL, outcome_type = NULL WHERE match_id = NEW.id;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.recalc_match_predictions() FROM PUBLIC, anon, authenticated;

-- ── Ручной запуск из админки (RPC): только для админов ────────────────
CREATE OR REPLACE FUNCTION public.trigger_sync()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Только администратор может запускать синхронизацию';
  END IF;
  RETURN public.sync_match_results();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trigger_sync() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.trigger_sync() TO authenticated;

-- ── Расписание pg_cron: каждые 2 минуты ───────────────────────────────
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-wc-results') THEN
    PERFORM cron.unschedule('sync-wc-results');
  END IF;
  PERFORM cron.schedule('sync-wc-results', '*/2 * * * *', 'SELECT public.sync_match_results();');
END
$cron$;
