-- =====================================================================
-- Плей-офф: считаем и показываем ТОЛЬКО основное время (90 минут).
--
-- Проблема: football-data.org в score.fullTime отдаёт ИТОГОВЫЙ счёт,
-- включающий голы доп. времени И серии пенальти. Матч, завершившийся
-- 1:1 в основное время и ушедший на пенальти 4:2, приходит как
-- fullTime = 5:3. Раньше мы писали этот fullTime в matches.home_score/
-- away_score — поэтому в таблице, прогнозах и при начислении очков
-- ничья 1:1 превращалась в «победу».
--
-- Решение: для матчей плей-офф, ушедших в доп. время / пенальти, в
-- основной счёт (home_score/away_score — по нему считаются очки и он
-- показывается везде) пишем score.regularTime (счёт за 90 минут).
-- Групповой этап НЕ затрагивается: там никогда не бывает доп. времени
-- и пенальти, duration всегда 'REGULAR', поэтому используется fullTime
-- ровно как раньше.
--
-- Дополнительно сохраняем детали матча (для отображения и для сетки
-- плей-офф, которой нужен победитель серии пенальти):
--   score_duration ∈ {REGULAR, EXTRA_TIME, PENALTY_SHOOTOUT}
--   home_et/away_et  — голы, забитые в доп. время (только доп. время)
--   home_pen/away_pen — голы в серии пенальти
--
-- Триггер пересчёта очков (recalc_match_predictions) НЕ меняется: он
-- сравнивает прогноз с home_score/away_score, а они теперь = основное
-- время. Когда эта функция в первый раз перепишет уже сыгранные
-- пенальти-матчи (5:3 → 1:1), триггер сам пересчитает очки.
-- =====================================================================

-- ── Новые колонки (идемпотентно) ──────────────────────────────────────
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS score_duration TEXT,
  ADD COLUMN IF NOT EXISTS home_et  INT,
  ADD COLUMN IF NOT EXISTS away_et  INT,
  ADD COLUMN IF NOT EXISTS home_pen INT,
  ADD COLUMN IF NOT EXISTS away_pen INT;

-- ── Обновлённая функция синхронизации (вызывается pg_cron каждые 2 мин) ─
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
  v_dur     TEXT;
  v_overtime BOOLEAN;
  v_hs      INT;
  v_as      INT;
  v_het     INT;
  v_aet     INT;
  v_hp      INT;
  v_ap      INT;
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

    IF v_scored THEN
      v_dur := rec->'score'->>'duration';
      -- Матч вышел за пределы основного времени → основной счёт берём из
      -- regularTime (счёт за 90 минут). Иначе (REGULAR / групповой этап) —
      -- fullTime, как раньше. regularTime появляется только у матчей плей-офф
      -- с доп. временем, поэтому защищаемся проверкой на NULL.
      v_overtime := v_dur IN ('EXTRA_TIME','PENALTY_SHOOTOUT')
                    AND (rec->'score'->'regularTime'->>'home') IS NOT NULL;
      IF v_overtime THEN
        v_hs := NULLIF(rec->'score'->'regularTime'->>'home','')::int;
        v_as := NULLIF(rec->'score'->'regularTime'->>'away','')::int;
      ELSE
        v_hs := NULLIF(rec->'score'->'fullTime'->>'home','')::int;
        v_as := NULLIF(rec->'score'->'fullTime'->>'away','')::int;
      END IF;
      -- Детали для отображения / определения победителя серии пенальти.
      v_het := NULLIF(rec->'score'->'extraTime'->>'home','')::int;
      v_aet := NULLIF(rec->'score'->'extraTime'->>'away','')::int;
      v_hp  := NULLIF(rec->'score'->'penalties'->>'home','')::int;
      v_ap  := NULLIF(rec->'score'->'penalties'->>'away','')::int;
    ELSE
      v_dur := NULL; v_hs := NULL; v_as := NULL;
      v_het := NULL; v_aet := NULL; v_hp := NULL; v_ap := NULL;
    END IF;

    -- 1) Счёт + статус + детали (только если реально изменилось — иначе не дёргаем пересчёт)
    UPDATE public.matches
       SET status = v_status, home_score = v_hs, away_score = v_as,
           score_duration = v_dur,
           home_et = v_het, away_et = v_aet,
           home_pen = v_hp, away_pen = v_ap
     WHERE external_id = v_ext
       AND (status IS DISTINCT FROM v_status
            OR home_score IS DISTINCT FROM v_hs
            OR away_score IS DISTINCT FROM v_as
            OR score_duration IS DISTINCT FROM v_dur
            OR home_et  IS DISTINCT FROM v_het
            OR away_et  IS DISTINCT FROM v_aet
            OR home_pen IS DISTINCT FROM v_hp
            OR away_pen IS DISTINCT FROM v_ap);
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

-- ── Немедленный пересинк уже сыгранных матчей ─────────────────────────
-- Не ждём ближайшего тика pg_cron: сразу тянем свежие результаты из API и
-- исправляем уже завершённые пенальти/доп.время матчи (Германия–Парагвай,
-- Нидерланды–Марокко и т.п.). Новый счёт (regularTime) отличается от
-- записанного ранее fullTime → UPDATE сработает, триггер пересчитает очки.
-- Обёрнуто в EXCEPTION: разовый сетевой сбой не должен откатывать миграцию
-- (тогда матчи всё равно починятся на ближайшем тике cron).
DO $$
BEGIN
  PERFORM public.sync_scores_cron();
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.sync_log(level, message)
    VALUES ('warn', format('Пересинк в миграции не удался (повторит cron): %s', left(SQLERRM, 200)));
END $$;
