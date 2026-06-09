import { cn } from "@/lib/utils"

/**
 * Team badge: flag centered on top, team name below (smaller).
 * Used in both Schedule (Расписание) and Predictions (Прогнозы).
 */
export function TeamDisplay({
  flag,
  name,
  size = "md",
  className,
}: {
  flag?: string | null
  name: string
  size?: "sm" | "md"
  className?: string
}) {
  return (
    <div className={cn("flex min-w-0 flex-col items-center gap-1.5 text-center", className)}>
      {flag && (
        <div
          className={cn(
            "grid shrink-0 place-items-center rounded-xl border border-border bg-secondary/40 leading-none shadow-card",
            size === "sm" ? "size-10 text-2xl" : "size-12 text-3xl md:size-14 md:text-4xl",
          )}
        >
          {flag}
        </div>
      )}
      <div
        className={cn(
          "w-full font-semibold leading-tight break-words",
          size === "sm" ? "text-xs" : "text-sm md:text-base",
        )}
      >
        {name}
      </div>
    </div>
  )
}
