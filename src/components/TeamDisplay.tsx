import { cn } from "@/lib/utils";

/**
 * Renders a country flag.
 * - If `flag` is a 2-letter ISO code (e.g. "MX", "ZA"), shows a real flag image (works on every platform).
 * - If `flag` is an http(s) URL (e.g. a logo from the sync API), shows that image.
 * - Otherwise falls back to rendering the raw value (e.g. an emoji flag) as text.
 */
function Flag({ flag, size }: { flag: string; size: "sm" | "md" }) {
  const code = flag.trim();
  const isIso = /^[A-Za-z]{2}$/.test(code) || /^gb-(eng|sct|wls|nir)$/i.test(code);
  const isUrl = /^https?:\/\//i.test(code);
  const box = size === "sm" ? "w-10 h-10" : "w-12 h-12 md:w-14 md:h-14";

  if (isIso || isUrl) {
    const lower = code.toLowerCase();
    const src = isUrl ? code : `https://flagcdn.com/w160/${lower}.png`;
    const srcSet = isUrl
      ? undefined
      : `https://flagcdn.com/w160/${lower}.png 1x, https://flagcdn.com/w320/${lower}.png 2x`;
    return (
      <div
        className={cn(
          "grid shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-secondary/40 shadow-card",
          box,
        )}
      >
        <img
          src={src}
          srcSet={srcSet}
          alt={code}
          loading="lazy"
          className={cn("h-full w-full", isUrl ? "object-contain p-1" : "object-cover")}
        />
      </div>
    );
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
  );
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
  flag?: string | null;
  name: string;
  size?: "sm" | "md";
  className?: string;
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
  );
}
