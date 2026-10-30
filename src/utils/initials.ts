/** "Aarav Mehta" → "AM". Used for avatar circles. */
export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

/** A stable pastel tone (0–5) per name, so a student keeps their colour everywhere. */
export function toneOf(name: string | null | undefined): number {
  let h = 0;
  for (const c of name ?? '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 6;
}
