import { Compass } from "lucide-react";

type BrandMarkProps = {
  /** "dark" = for placement on the brand gradient; "light" = for white surfaces. */
  tone?: "dark" | "light";
  /** Show the "Platform Architecture" descriptor under the wordmark. */
  withTagline?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
};

/**
 * Shared product identity used across every page (landing, wizard, recommendation)
 * so the experience reads as one cohesive product: "Agentic AI Pathfinder".
 */
export function BrandMark({ tone = "dark", withTagline = false, size = "md", className = "" }: BrandMarkProps) {
  const onDark = tone === "dark";
  const tile = size === "lg" ? "h-12 w-12" : size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const icon = size === "lg" ? "h-6 w-6" : size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const name = size === "lg" ? "text-xl lg:text-2xl" : size === "sm" ? "text-sm" : "text-base";
  const tagline = size === "lg" ? "text-xs" : "text-[11px]";

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <span
        className={`relative flex ${tile} shrink-0 items-center justify-center rounded-lg ${
          onDark
            ? "bg-white/15 text-white ring-1 ring-white/25"
            : "bg-[#EAF4FF] text-ms-blue ring-1 ring-[#CFE4FA]"
        }`}
      >
        <Compass className={icon} />
      </span>
      <span className="leading-tight">
        <span className={`block font-bold tracking-tight ${name} ${onDark ? "text-white" : "text-ms-text"}`}>
          Agentic AI <span className={onDark ? "text-[#9FD4FF]" : "text-ms-blue"}>Pathfinder</span>
        </span>
        {withTagline ? (
          <span className={`block ${tagline} font-medium ${onDark ? "text-white/70" : "text-ms-muted"}`}>
            Platform Architecture Tool
          </span>
        ) : null}
      </span>
    </div>
  );
}
