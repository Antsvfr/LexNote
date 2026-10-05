export function SubjectDot({ color }: { color: string }) {
  return <span className="dot" style={{ ['--dot' as string]: `var(--c-${color}, var(--ink-3))` }} aria-hidden />;
}
