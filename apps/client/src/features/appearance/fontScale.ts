export const FONT_SCALES = [80, 90, 100, 110, 125, 150, 175, 200];
export const FONT_SCALE_KEY = "agai.font-scale";
export function readFontScale(storage: Pick<Storage, "getItem">): number {
  try {
    const size = Number(storage.getItem(FONT_SCALE_KEY));
    return FONT_SCALES.includes(size) ? size : 100;
  } catch {
    return 100;
  }
}
export function fontScaleShortcut(
  event: KeyboardEvent,
  current: number,
): number | null {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey) return null;
  if (event.key === "0") return 100;
  const direction = ["+", "="].includes(event.key)
    ? 1
    : ["-", "_"].includes(event.key)
      ? -1
      : 0;
  if (!direction) return null;
  const index = FONT_SCALES.indexOf(current);
  return FONT_SCALES[
    Math.max(
      0,
      Math.min(FONT_SCALES.length - 1, (index < 0 ? 2 : index) + direction),
    )
  ];
}
