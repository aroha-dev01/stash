// Small inline icons, drawn on a 16px grid and stroked with currentColor.

export function DrawerMark({ size = 22 }) {
  // The Stash mark: a drawer with its pull.
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='none' aria-hidden='true'>
      <rect x='3' y='5' width='18' height='14' rx='3' stroke='currentColor' strokeWidth='1.8' />
      <path d='M3 11.5h18' stroke='currentColor' strokeWidth='1.8' />
      <path d='M10 8.2h4M10 14.8h4' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' />
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
