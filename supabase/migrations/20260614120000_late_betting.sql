-- =====================================================================
-- Late-betting toggle.
--
-- Иногда участник банально забывает поставить прогноз до начала матча.
-- Этот переключатель в админке («late_betting_enabled») открывает приём
-- прогнозов на уже начавшиеся/завершённые матчи для тех, кто ещё не
-- ставил — и держит окно открытым, пока админ его не закроет.
--
-- Правила:
--   * Влияет только на НОВЫЙ прогноз (INSERT). Уже сохранённый прогноз
--     по-прежнему изменить нельзя — кто поставил, тот зафиксирован.
--   * Если матч уже завершён, поздний прогноз сразу получает очки
--     (триггер пересчёта на matches для него повторно не сработает).
-- =====================================================================

-- Глобальные настройки (key/value). Пока нужен один булев флаг, но таблица
-- key/value легко расширяется.
CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  bool_value BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Settings visible to authenticated" ON public.app_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage settings" ON public.app_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.app_settings (key, bool_value)
  VALUES ('late_betting_enabled', false)
  ON CONFLICT (key) DO NOTHING;

-- Чтобы все клиенты сразу видели смену флага.
ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;

CREATE OR REPLACE FUNCTION public.late_betting_enabled()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT bool_value FROM public.app_settings WHERE key = 'late_betting_enabled'),
    false
  )
$$;

-- Обновлённая валидация: разрешаем поздний INSERT при включённом окне и
-- сразу начисляем очки за прогноз на уже завершённый матч.
CREATE OR REPLACE FUNCTION public.validate_prediction()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m RECORD;
  c RECORD;
BEGIN
  SELECT kickoff, status, home_score, away_score
    INTO m FROM public.matches WHERE id = NEW.match_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match not found'; END IF;

  IF TG_OP = 'INSERT'
     OR NEW.home_score IS DISTINCT FROM OLD.home_score
     OR NEW.away_score IS DISTINCT FROM OLD.away_score THEN
    -- Блокируем после старта матча, КРОМЕ случаев: админ; либо это новый
    -- прогноз (INSERT) при открытом окне поздних ставок.
    IF NOT public.has_role(auth.uid(), 'admin')
       AND m.kickoff <= now()
       AND NOT (TG_OP = 'INSERT' AND public.late_betting_enabled()) THEN
      RAISE EXCEPTION 'Match already started, prediction locked';
    END IF;
    IF NEW.home_score < 0 OR NEW.away_score < 0 OR NEW.home_score > 30 OR NEW.away_score > 30 THEN
      RAISE EXCEPTION 'Invalid score';
    END IF;
  END IF;

  -- Поздний прогноз на завершённый матч — считаем очки прямо сейчас.
  IF TG_OP = 'INSERT' AND m.status = 'finished'
     AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL THEN
    SELECT * INTO c
      FROM public.calculate_points(NEW.home_score, NEW.away_score, m.home_score, m.away_score);
    NEW.points := c.points;
    NEW.outcome_type := c.outcome_type;
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.validate_prediction() FROM PUBLIC, anon, authenticated;
