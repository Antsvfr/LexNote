/** Marque LexNote : carré encre, un "L" tracé comme une marge de cahier, et un trait de laiton. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="LexNote" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="15" fill="#1f2a4a" />
      <path d="M22 15v28a3 3 0 0 0 3 3h19" fill="none" stroke="#f6f3ec" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M30 24h14M30 33h9" stroke="#c9a24a" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
