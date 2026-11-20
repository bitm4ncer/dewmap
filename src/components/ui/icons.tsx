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

export function HomeIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v10h4.5v-5h3v5H18V10" />
    </svg>
  );
}

export function WorkIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="3" y="7.5" width="18" height="12.5" rx="2" />
      <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" />
      <path d="M3 12.5h18" />
    </svg>
  );
}

export function RecenterIcon({ size = 18, className }: IconProps) {  return (
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
        {/* Up, arc over to the right, back down — head sits at the path
         * end pointing in the new direction of travel. */}
        <path d="M7 20V9a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v6" />
        <path d="M13.5 11.5l3.5 3.5-3.5 3.5" />
      </svg>
    );
  }
  if (modifier === "sharp-left") {
    return (
      <svg {...base(size, className)}>
        <path d="M18 20V7a2.5 2.5 0 0 0-2.5-2.5H8" />
        <path d="M11 1.5 7.5 4.5l3.5 3" />
      </svg>
    );
  }
  if (modifier === "sharp-right") {
    return (
      <svg {...base(size, className)}>
        <path d="M6 20V7a2.5 2.5 0 0 1 2.5-2.5H16" />
        <path d="M13 1.5l3.5 3-3.5 3" />
      </svg>
    );
  }
  if (modifier === "left" || modifier === "slight-left") {
    return (
      <svg {...base(size, className)}>
        {modifier === "left" ? (
          <path d="M18 20V9a5 5 0 0 0-5-5H7" />
        ) : (
          <path d="M16 20v-6c0-3.5-2.5-6-6-6H7.5" />
        )}
        {/* Chevron points LEFT, at the end of the stem. */}
        {modifier === "left" ? (
          <path d="M10 1 7 4l3 3" />
        ) : (
          <path d="M11 4.5 7.5 8l3 3" />
        )}
      </svg>
    );
  }
  if (modifier === "right" || modifier === "slight-right") {
    return (
      <svg {...base(size, className)}>
        {modifier === "right" ? (
          <path d="M6 20V9a5 5 0 0 1 5-5h6" />
        ) : (
          <path d="M8 20v-6c0-3.5 2.5-6 6-6h2.5" />
        )}
        {/* Chevron points RIGHT, at the end of the stem. */}
        {modifier === "right" ? (
          <path d="M14 1l3 3-3 3" />
        ) : (
          <path d="M13 4.5l3.5 3.5-3.5 3.5" />
        )}
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

export function ExternalLinkIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M14 4h6v6" />
      <path d="m20 4-9 9" />
      <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

export function ClockIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function PhoneIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 5 5L15.5 11l4 1.5v3A2.5 2.5 0 0 1 17 18C10.4 18 4 11.6 4 5.5A2.5 2.5 0 0 1 6.5 3Z" />
    </svg>
  );
}

export function MailIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

export function TransitIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="5" y="3" width="14" height="13.5" rx="3" />
      <path d="M8 7.5h8M8 11h8" />
      <path d="M8 17l-2 4M16 17l2 4M7.5 21h9" />
    </svg>
  );
}

export function WalkIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="13.5" cy="4.2" r="1.7" />
      <path d="M13 7.2 11 13l3 2.6 1 5.2" />
      <path d="m11 13-3 2.4M11 9.6 7.5 11.4M13 8.6l3.4 2.2" />
    </svg>
  );
}

export function BikeIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="5.8" cy="16.2" r="3.8" />
      <circle cx="18.2" cy="16.2" r="3.8" />
      <path d="M5.8 16.2 9.5 7h5.2l-4.2 9.2M12 7l1.8 4.6M8.4 7h3.4M14.4 11.6h5.2" />
    </svg>
  );
}

export function CarIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M4 15.5 5.4 9.6A2 2 0 0 1 7.4 8h9.2a2 2 0 0 1 2 1.6L20 15.5" />
      <path d="M3.5 15.5h17v3.2h-2.2M5.7 18.7H3.5v-3.2" />
      <circle cx="7.5" cy="18.4" r="1.5" />
      <circle cx="16.5" cy="18.4" r="1.5" />
      <path d="M7 12h10" />
    </svg>
  );
}

export function ImageIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <circle cx="8.5" cy="10" r="1.4" />
      <path d="M3 17 L9 12 L13 16 L17 12 L21 17" />
    </svg>
  );
}

export function HybridIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 3 L21 8 L12 13 L3 8 Z" />
      <path d="M3 14 L12 19 L21 14" />
    </svg>
  );
}

export function VectorIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M9 4 L3 6 V20 L9 18 L15 20 L21 18 V4 L15 6 Z" />
      <line x1="9" y1="4" x2="9" y2="18" />
      <line x1="15" y1="6" x2="15" y2="20" />
    </svg>
  );
}

export function FlatIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 12h18M12 4v16" />
    </svg>
  );
}

export function GlobeIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18M4.5 7h15M4.5 17h15" />
    </svg>
  );
}

export function CompassIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6.5 15 12l-3 5.5L9 12Z" />
      <path d="M12 4v1.5" />
    </svg>
  );
}

export function RouteIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="18" cy="18" r="2.2" />
      <path d="M8.2 6H14a4 4 0 0 1 0 8H9a3 3 0 0 0 0 6h6.8" />
    </svg>
  );
}

export function HeadingIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5 V6M12 18v2.5M3.5 12H6M18 12h2.5" />
      <path d="M12 7.5 15 15l-3-2-3 2Z" />
    </svg>
  );
}

export function LandCoverIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <path d="M14 20.5h6M17 17.5v6" />
    </svg>
  );
}

export function NdviIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M4.5 19.5C4.5 11 10.5 4.5 20 4.5c0 9.5-6.5 15-14.5 15Z" />
      <path d="M5 19c3.5-4 7-7.5 11.5-10" />
    </svg>
  );
}

export function SpeciesIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <ellipse cx="7" cy="8" rx="2" ry="2.6" />
      <ellipse cx="12" cy="6" rx="2" ry="2.6" />
      <ellipse cx="17" cy="8" rx="2" ry="2.6" />
      <ellipse cx="19" cy="13" rx="1.8" ry="2.3" />
      <path d="M6 17.5c0-2.8 2.7-5 6-5s6 2.2 6 5c0 1.5-1.2 2.5-2.8 2.5-1 0-2-.6-3.2-.6s-2.2.6-3.2.6C7.2 20 6 19 6 17.5Z" />
    </svg>
  );
}

export function ForestLossIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 3 7 10h3l-3 4.5h10L14 10h3Z" />
      <path d="M12 14.5V21" />
      <path d="M8.5 20.5h7" />
      <path d="M3 6.5h2.5M4.25 5.25v2.5" />
    </svg>
  );
}

export function AirQualityIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M3 8h11a3 3 0 1 0-3-3" />
      <path d="M3 12h15a3 3 0 1 1-3 3" />
      <path d="M3 16h7a2.5 2.5 0 1 1-2.5 2.5" />
    </svg>
  );
}

export function NaturaIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 3 5 6v5.5c0 4.5 3 8 7 9.5 4-1.5 7-5 7-9.5V6Z" />
      <path d="m8.8 12 2.1 2.1 4.4-4.4" />
    </svg>
  );
}

export function CopyIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

export function CheckIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="m4 12.5 5 5L20 6.5" />
    </svg>
  );
}

export function AllPlacesIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
    </svg>
  );
}

export function FoodIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M7 4v6.5a2 2 0 0 0 4 0V4" />
      <path d="M9 10.5V20" />
      <path d="M16.5 4c-1.6 1.2-2.5 3-2.5 5.2 0 1.3.7 2.2 2 2.4V20" />
    </svg>
  );
}

export function ShoppingIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M5.5 8h13l-1 12h-11l-1-12Z" />
      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
    </svg>
  );
}

export function CultureIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M3.5 9 12 4l8.5 5" />
      <path d="M5 9v8M9.5 9v8M14.5 9v8M19 9v8" />
      <path d="M3.5 20h17" />
    </svg>
  );
}

export function SportIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4c3.4 2.4 3.4 13.6 0 16" />
      <path d="M4.6 8.8c4.6 1.7 10.2 1.7 14.8 0M4.6 15.2c4.6-1.7 10.2-1.7 14.8 0" />
    </svg>
  );
}

export function ParkIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 3.5 6.5 10h3L5 16h14l-4.5-6h3L12 3.5Z" />
      <path d="M12 16v4.5" />
    </svg>
  );
}
