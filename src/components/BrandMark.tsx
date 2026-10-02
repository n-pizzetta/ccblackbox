import { useId } from "react";

/** Black box with a session trace. Mirrors public/favicon.svg. */
export function BrandMark({ size = 28 }: { size?: number }) {
  const g = useId();
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--c-cyan)" />
          <stop offset="1" stopColor="var(--c-violet)" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="15" fill="var(--c-bg)" stroke={`url(#${g})`} strokeWidth="3.5" />
      <path
        className="brand-mark-trace"
        d="M13 35.5h8l4.5-14 6 21 4.5-13 3 6h12"
        stroke={`url(#${g})`}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
