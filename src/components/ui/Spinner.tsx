interface Props {
  size?: number;
  className?: string;
}

/**
 * Minimal ring spinner for short async states. The SVG uses currentColor
 * so it inherits the surrounding text tone; no border declarations, which
 * keeps the flat surface system intact.
 */
export function Spinner({ size = 14, className }: Props) {
  return (
    <svg
      className={["ui-spinner", className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="2.6"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
