/** 頻道戰績走勢圖的十色 categorical palette。
 *
 *  兩種模式各自選色（dark 不是 light 的自動翻轉）。以 dataviz 的
 *  scripts/validate_palette.js 針對卡片底色驗證過（light #ffffff / dark #171717，
 *  即 --card: oklch(0.205 0 0)）：兩模式皆 ALL CHECKS PASS，最差相鄰 CVD ΔE 9.1
 *  light / 8.4 dark，最差一般視覺 ΔE 19.6 light / 19.1 dark。
 *
 *  ⚠️ 十條疊圖的線會互相穿越，屬 all-pairs 情境——該情境下沒有任何十色能過關，
 *  所以識別必須同時靠線末的 series title 與 hover 高亮，顏色不單獨表意。
 *
 *  寫成字面 hex 而非 CSS 變數：lightweight-charts 畫在 canvas 上讀不到 CSS 變數，
 *  與 lib/markers.ts 的 STANCE_COLORS 同理。 */
export const TICKER_PALETTE_LIGHT = [
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4",
  "#008300", "#4a3aa7", "#e34948", "#0aa5c9", "#7cb518",
];

export const TICKER_PALETTE_DARK = [
  "#3987e5", "#d95926", "#199e70", "#c98500", "#d55181",
  "#008300", "#9085e9", "#e66767", "#289fba", "#79a01d",
];

/** 顏色跟著 entity 走：slot = 該 ticker 的全時間排名，所以開關 series 時
 *  留下來的那幾條不會被重新上色。 */
export function tickerColor(rank: number, dark: boolean): string {
  const palette = dark ? TICKER_PALETTE_DARK : TICKER_PALETTE_LIGHT;
  return palette[rank % palette.length];
}

/** "#rrggbb" -> "rgba(r, g, b, a)"，給淡化的未表態線段與 hover 時的降階使用。 */
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
