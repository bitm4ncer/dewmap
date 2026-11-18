import type { Maneuver } from "@/lib/routing";

interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
}

export function SpeakerIcon({ muted = false, size = 18, className }: IconProps & { muted?: boolean }) {
  return (
    <svg {...base(size, className)}>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      {muted ? (
        <path d="M16 9l5 6M21 9l-5 6" />
      ) : (
        <>
          <path d="M16.5 8.5a5 5 0 0 1 0 7" />
          <path d="M19 6a8.5 8.5 0 0 1 0 12" />
        </>
      )}
    </svg>
  );
}

export function RecenterIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

export function SwapIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M8 4v16M8 4 4 8M8 4l4 4" />
      <path d="M16 20V4M16 20l-4-4M16 20l4-4" />
    </svg>
  );
}

export function ChevronUpIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="m6 15 6-6 6 6" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function CloseIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M5 5l14 14M19 5 5 19" />
    </svg>
  );
}

export function MapPinIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function StarIcon({
  size = 18,
  className,
  filled = false,
}: IconProps & { filled?: boolean }) {
  return (
    <svg
      {...base(size, className)}
      fill={filled ? "currentColor" : "none"}
    >
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3Z" />
    </svg>
  );
}

export function FlagIcon({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M5 21V4" />
      <path d="M5 4h12l-2.5 4L17 12H5" />
    </svg>
  );
}

export function ManeuverIcon({
  maneuver,
  size = 24,
  className,
}: IconProps & { maneuver: Maneuver | null }) {
  if (!maneuver) {
    return (
      <svg {...base(size, className)}>
        <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (maneuver.type === "arrive") return <FlagIcon size={size} className={className} />;
  if (maneuver.type === "roundabout") {
    return (
      <svg {...base(size, className)}>
        <path d="M20 12a8 8 0 1 1-2.4-5.7" />
        <path d="M20 4v5h-5" />
      </svg>
    );
  }
  const modifier = maneuver.modifier;
  if (modifier === "uturn") {
    return (
      <svg {...base(size, className)}>
        <path d="M7 4v9a4 4 0 0 0 8 0V9" />
        <path d="M7 4 3 8M7 4l4 4" />
      </svg>
    );
  }
  if (modifier === "left" || modifier === "slight-left" || modifier === "sharp-left") {
    return (
      <svg {...base(size, className)}>
        <path d="M18 20V9a5 5 0 0 0-5-5H6" />
        <path d="M6 4 2 8M6 4l4 4" />
      </svg>
    );
  }
  if (modifier === "right" || modifier === "slight-right" || modifier === "sharp-right") {
    return (
      <svg {...base(size, className)}>
        <path d="M6 20V9a5 5 0 0 1 5-5h7" />
        <path d="M18 4l4 4M18 4l-4 4" />
      </svg>
    );
  }
  return (
    <svg {...base(size, className)}>
      <path d="M12 21V3" />
      <path d="m7 8 5-5 5 5" />
    </svg>
  );
}
