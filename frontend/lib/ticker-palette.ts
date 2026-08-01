/** A 10-color categorical palette for the channel track record chart.
 *
 *  The two modes each select colors independently (dark is not an automatic inversion of light).
 *  Validated using dataviz's scripts/validate_palette.js against the card background
 *  (light #ffffff / dark #171717, i.e. --card: oklch(0.205 0 0)): both modes pass ALL CHECKS,
 *  worst-case adjacent CVD ΔE 9.1 light / 8.4 dark, worst-case general vision ΔE 19.6 light / 19.1 dark.
 *
 *  ⚠️ Ten overlapping lines will cross each other, an all-pairs scenario — no 10-color palette passes
 *  in this scenario, so identification must rely on both the series title at line end and hover
 *  highlights; color does not convey meaning on its own.
 *
 *  Written as literal hex, not CSS variables: lightweight-charts renders on canvas and cannot read
 *  CSS variables, same logic as STANCE_COLORS in lib/markers.ts. */
export const TICKER_PALETTE_LIGHT = [
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4",
  "#008300", "#4a3aa7", "#e34948", "#0aa5c9", "#7cb518",
];

export const TICKER_PALETTE_DARK = [
  "#3987e5", "#d95926", "#199e70", "#c98500", "#d55181",
  "#008300", "#9085e9", "#e66767", "#289fba", "#79a01d",
];

/** Color follows the entity: slot = the ticker's all-time rank, so when toggling
 *  series visibility, the remaining lines retain their color instead of being recolored. */
export function tickerColor(rank: number, dark: boolean): string {
  const palette = dark ? TICKER_PALETTE_DARK : TICKER_PALETTE_LIGHT;
  return palette[rank % palette.length];
}

/** Converts "#rrggbb" to "rgba(r, g, b, a)", used for faded neutral segments and hover dimming. */
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
