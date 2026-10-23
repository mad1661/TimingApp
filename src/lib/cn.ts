/**
 * Joins class names, skipping falsy ones. There is no conflict resolution (no
 * tailwind-merge), so a caller's extra classes must not fight a utility the
 * component already sets.
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
