type IconProps = { filled?: boolean; className?: string }

const shared = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function ReplyIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}

export function RepostIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  )
}

export function HeartIcon({ filled, className }: IconProps) {
  return (
    <svg
      {...shared}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      className={className}
    >
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  )
}

export function ZapIcon({ filled, className }: IconProps) {
  return (
    <svg
      {...shared}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      className={className}
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

export function BookmarkIcon({ filled, className }: IconProps) {
  return (
    <svg
      {...shared}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      className={className}
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}

export function ServerIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  )
}

export function GlobeIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

export function UploadIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

export function CheckCircleIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}

export function ZapCircleIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <circle cx="12" cy="12" r="10" />
      <polygon points="13 7 8 13 11.5 13 11 17 16 11 12.5 11 13 7" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function MoreIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="currentColor" stroke="none" className={className}>
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  )
}

// Generic AI-sparkle-cluster glyph — not a reproduction of any
// trademarked logo. A large four-point star plus a smaller companion
// star, the same visual shorthand most AI product icons use (distinct
// at nav-rail size from a plain single starburst, which read too much
// like a generic decoration rather than a feature affordance).
export function SparklesIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M9 8 10.8 13.2 16 15 10.8 16.8 9 22 7.2 16.8 2 15 7.2 13.2Z" />
      <path d="M18 2.5 19.1 5.9 22.5 7 19.1 8.1 18 11.5 16.9 8.1 13.5 7 16.9 5.9Z" />
    </svg>
  )
}

export function HomeIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

export function BellIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

export function MessageSquareIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

export function UserIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

export function PencilIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  )
}

export function ArrowLeftIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}

export function ImageIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  )
}

export function XIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

export function FileTextIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </svg>
  )
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

export function InfoIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16.5" />
      <circle cx="12" cy="7.8" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function UsersIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

export function LinkIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

export function LockIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

export function WarningIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

// NIP-F4 podcast episode card fallback — a generic microphone glyph,
// standard icon-library shape (Feather's own "mic" outline), not a
// reproduction of any specific product's logo.
export function MicIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )
}

// NIP-58 badges settings — a generic medal/ribbon glyph, standard
// icon-library shape (Feather's own "award" outline), not a
// reproduction of any specific product's logo.
export function AwardIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <circle cx="12" cy="8" r="6" />
      <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
    </svg>
  )
}

// NIP-99 Marketplace nav icon — a generic storefront/tag glyph, standard
// icon-library shape, not a reproduction of any specific product's logo.
export function StoreIcon({ className }: IconProps) {
  return (
    <svg {...shared} fill="none" stroke="currentColor" className={className}>
      <path d="M3 9 5 3h14l2 6" />
      <path d="M3 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0" />
      <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
      <path d="M9 21v-6h6v6" />
    </svg>
  )
}
