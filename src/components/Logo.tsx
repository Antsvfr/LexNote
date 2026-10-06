/** Marque LexNote : carré rouge arrondi, « L » blanc. Même famille visuelle que REV-EM. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="LexNote" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="lx-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ff3b5c" /><stop offset="1" stopColor="#d4143a" /></linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#lx-g)" />
      <path d="M22 14v32a3 3 0 0 0 3 3h20" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
