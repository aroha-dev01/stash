// Small inline icons, drawn on a 16px grid and stroked with currentColor.

// The Stash mark: a cabinet with two drawers pulled out to opposite sides,
// which leaves an S. public/icon.svg draws the same path on a dark tile.
export const STASH_PATH =
  'M6.67 2H17.33A4.67 4.67 0 0 1 22 6.67H8.17A1.5 1.5 0 0 0 8.17 9.67H22V17.33A4.67 4.67 0 0 1 17.33 22H6.67A4.67 4.67 0 0 1 2 17.33H15.83A1.5 1.5 0 0 0 15.83 14.33H2V6.67A4.67 4.67 0 0 1 6.67 2Z';

export function StashMark({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
      <path d={STASH_PATH} />
    </svg>
  );
}

export function LockIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' aria-hidden='true'>
      <rect x='3' y='7' width='10' height='7' rx='1.6' stroke='currentColor' strokeWidth='1.5' />
      <path d='M5.5 7V5a2.5 2.5 0 0 1 5 0v2' stroke='currentColor' strokeWidth='1.5' />
    </svg>
  );
}

export function CheckIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' aria-hidden='true'>
      <path d='M3 8.5l3.2 3L13 4.5' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  );
}

export function SearchIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='none' aria-hidden='true'>
      <circle cx='11' cy='11' r='6.5' stroke='currentColor' strokeWidth='1.8' />
      <path d='M20 20l-4.2-4.2' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' />
    </svg>
  );
}

export function BookmarkIcon({ filled, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill={filled ? 'currentColor' : 'none'} aria-hidden='true'>
      <path d='M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z' stroke='currentColor' strokeWidth='1.8' strokeLinejoin='round' />
    </svg>
  );
}

export function CloseIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' aria-hidden='true'>
      <path d='M4 4l8 8M12 4l-8 8' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' />
    </svg>
  );
}

export function GoogleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' aria-hidden='true'>
      <path fill='#4285F4' d='M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z' />
      <path fill='#34A853' d='M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z' />
      <path fill='#FBBC05' d='M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z' />
      <path fill='#EA4335' d='M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z' />
    </svg>
  );
}

export function PlugIcon({ size = 24 }) {
  // A generic connection, for "any MCP client". Not the MCP logo.
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='none' aria-hidden='true'>
      <path d='M9 3v4M15 3v4M7 7h10v3a5 5 0 0 1-10 0V7zM12 15v6' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  );
}

export function ArrowIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' aria-hidden='true'>
      <path d='M3 8h10M9 4l4 4-4 4' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  );
}

export function ExternalIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' aria-hidden='true'>
      <path d='M6 3H3.5A.5.5 0 0 0 3 3.5v9a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V10M9 3h4v4M13 3L7.5 8.5' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  );
}

export function PersonIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' aria-hidden='true'>
      <circle cx='8' cy='5.5' r='2.6' stroke='currentColor' strokeWidth='1.5' />
      <path d='M3 13.5c.8-2.4 2.7-3.6 5-3.6s4.2 1.2 5 3.6' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
    </svg>
  );
}

export function SparkIcon({ size = 12 }) {
  // Pro. A four-point spark, drawn, not an emoji.
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' aria-hidden='true'>
      <path d='M8 1.5l1.6 4.9 4.9 1.6-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6L8 1.5z' fill='currentColor' />
    </svg>
  );
}

export function GlobeIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' aria-hidden='true'>
      <circle cx='8' cy='8' r='6' stroke='currentColor' strokeWidth='1.5' />
      <path d='M2 8h12M8 2c1.8 1.7 2.6 3.7 2.6 6S9.8 12.3 8 14C6.2 12.3 5.4 10.3 5.4 8S6.2 3.7 8 2z' stroke='currentColor' strokeWidth='1.3' />
    </svg>
  );
}

export function PlusIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' aria-hidden='true'>
      <path d='M8 3v10M3 8h10' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' />
    </svg>
  );
}

export function PencilIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' aria-hidden='true'>
      <path d='M10.5 3.2l2.3 2.3L6 12.3l-3 .7.7-3 6.8-6.8z' stroke='currentColor' strokeWidth='1.4' strokeLinejoin='round' />
    </svg>
  );
}

export function TrashIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' aria-hidden='true'>
      <path d='M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  );
}

export function UpIcon({ size = 14, down = false }) {
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' aria-hidden='true' style={down ? { transform: 'rotate(180deg)' } : undefined}>
      <path d='M8 12.5v-9M4.5 7L8 3.5 11.5 7' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  );
}

export function GripIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='currentColor' aria-hidden='true'>
      <circle cx='6' cy='4' r='1.2' /><circle cx='10' cy='4' r='1.2' />
      <circle cx='6' cy='8' r='1.2' /><circle cx='10' cy='8' r='1.2' />
      <circle cx='6' cy='12' r='1.2' /><circle cx='10' cy='12' r='1.2' />
    </svg>
  );
}

export function NodesIcon({ size = 16 }) {
  // Projects: a hub with three branches.
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' aria-hidden='true'>
      <circle cx='8' cy='8' r='2.2' stroke='currentColor' strokeWidth='1.4' />
      <circle cx='3' cy='3.5' r='1.5' fill='currentColor' /><circle cx='13' cy='4' r='1.5' fill='currentColor' /><circle cx='8' cy='14' r='1.5' fill='currentColor' />
      <path d='M6.4 6.6L4.1 4.5M9.7 6.7l2.2-1.8M8 10.2v2.3' stroke='currentColor' strokeWidth='1.2' />
    </svg>
  );
}

export function ChevronIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' aria-hidden='true'>
      <path d='M4 6l4 4 4-4' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  );
}
