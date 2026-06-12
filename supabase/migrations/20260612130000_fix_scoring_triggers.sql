-- =====================================================================
-- Починка двух скрытых багов в триггерах подсчёта очков.
--
-- Эти баги ронкали ЛЮБОЕ проставление результата матча (и ручной ввод в
-- админке, и автосинхронизацию через scripts/sync-scores.mjs), просто до
-- завершения первого матча их никто не замечал.
--
-- 1) recalc_match_predictions: вызывал calculate_points() в FROM со
--    ссылкой на обновляемую таблицу p — Postgres это запрещает
--    («invalid reference to FROM-clause entry for table p»). Логика
--    начисления встроена прямо в UPDATE.
-- 2) validate_prediction: блокировал ЛЮБОЕ изменение прогноза после
--    старта матча, включая системный пересчёт points/outcome_type (он
--    идёт без auth.uid(), поэтому не распознавался как админ). Теперь
--    блокировка срабатывает только когда меняется сам счёт-прогноз
--    пользователя (home_score/away_score).
--
-- Триггеры trg_recalc_predictions и trg_validate_prediction уже навешаны
-- исходной миграцией — здесь меняются только тела функций.
-- =====================================================================

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
