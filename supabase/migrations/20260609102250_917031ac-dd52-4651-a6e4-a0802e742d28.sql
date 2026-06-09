
CREATE OR REPLACE FUNCTION public.calculate_points(
  p_pred_h INT, p_pred_a INT, p_res_h INT, p_res_a INT
) RETURNS TABLE(points INT, outcome_type TEXT) LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF p_pred_h = p_res_h AND p_pred_a = p_res_a THEN
    RETURN QUERY SELECT 3, 'bingo'::TEXT; RETURN;
  END IF;
  IF p_pred_h = p_pred_a AND p_res_h = p_res_a THEN
    RETURN QUERY SELECT 2, 'draw'::TEXT; RETURN;
  END IF;
  IF sign(p_pred_h - p_pred_a) = sign(p_res_h - p_res_a) AND p_pred_h <> p_pred_a AND p_res_h <> p_res_a THEN
    RETURN QUERY SELECT 1, 'outcome'::TEXT; RETURN;
  END IF;
  RETURN QUERY SELECT 0, 'miss'::TEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.calculate_points(int,int,int,int) FROM PUBLIC, anon;
