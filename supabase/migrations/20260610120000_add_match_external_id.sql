-- Link our matches to API-Football fixtures so the sync job can upsert by a stable key.
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS external_id TEXT;

-- One row per external fixture; enables upsert-by-external_id.
CREATE UNIQUE INDEX IF NOT EXISTS matches_external_id_key
  ON public.matches (external_id)
  WHERE external_id IS NOT NULL;
