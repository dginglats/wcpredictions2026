-- =====================================================================
-- Прогноз-сетка плей-офф («Сетка»).
--
-- Пользователь один раз расставляет весь турнир: места в группах,
-- 8 лучших третьих мест и победителей плей-офф вплоть до финала.
-- Прогноз сохраняется ОДИН раз и не редактируется — поэтому:
--   * первичный ключ по user_id (одна сетка на игрока);
--   * у authenticated есть только SELECT и INSERT, без UPDATE/DELETE.
-- Вся структура хранится в JSONB `data`.
-- =====================================================================

CREATE TABLE public.bracket_predictions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.bracket_predictions TO authenticated;
GRANT ALL ON public.bracket_predictions TO service_role;
ALTER TABLE public.bracket_predictions ENABLE ROW LEVEL SECURITY;

-- Сетки видны всем участникам (как и обычные прогнозы).
CREATE POLICY "Brackets visible to authenticated" ON public.bracket_predictions
  FOR SELECT TO authenticated USING (true);
-- Игрок может создать только свою сетку. UPDATE/DELETE не выдан — значит,
-- после первого INSERT изменить её нельзя (повторный INSERT упадёт на PK).
CREATE POLICY "Users insert own bracket" ON public.bracket_predictions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
-- Админ может всё (на случай исправлений).
CREATE POLICY "Admins manage brackets" ON public.bracket_predictions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
