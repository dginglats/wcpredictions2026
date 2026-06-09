import type { Database } from "@/integrations/supabase/types"

export type Profile = Database["public"]["Tables"]["profiles"]["Row"]
export type Match = Database["public"]["Tables"]["matches"]["Row"]
export type MatchInsert = Database["public"]["Tables"]["matches"]["Insert"]
export type Prediction = Database["public"]["Tables"]["predictions"]["Row"]
export type LeaderboardRow = Database["public"]["Views"]["leaderboard"]["Row"]
export type MatchStatus = Database["public"]["Enums"]["match_status"]
export type MatchStage = Database["public"]["Enums"]["match_stage"]
export type AppRole = Database["public"]["Enums"]["app_role"]
