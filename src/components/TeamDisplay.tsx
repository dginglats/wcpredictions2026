import { cn } from "@/lib/utils"

/**
 * Renders a country flag.
 * - If `flag` is a 2-letter ISO code (e.g. "MX", "ZA"), shows a real flag image (works on every platform).
 * - Otherwise falls back to rendering the raw value (e.g. an emoji flag) as text.
 */
function Flag({ flag, size }: { flag: string; size: "sm" | "md" }) {
  const code = flag.trim()
  const isIso = /^[A-Za-z]{2}$/.test(code)
  const box = size === "sm" ? "w-10 h-10" : "w-12 h-12 md:w-14 md:h-14"

  if (isIso) {
    const lower = code.toLowerCase()
    return (
      <div className={cn("grid shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-secondary/40 shadow-card", box)}>
        <img
          src={`https://flagcdn.com/w160/${lower}.png`}
          srcSet={`https://flagcdn.com/w160/${lower}.png 1x, https://flagcdn.com/w320/${lower}.png 2x`}
          alt={code}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center rounded-xl border border-border bg-secondary/40 leading-none shadow-card",
        box,
        size === "sm" ? "text-2xl" : "text-3xl md:text-4xl",
      )}
    >
      {code}
    </div>
  )
}

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
      {flag && <Flag flag={flag} size={size} />}
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
