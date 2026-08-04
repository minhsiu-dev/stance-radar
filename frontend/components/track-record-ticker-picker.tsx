"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import type { TrackRecordAvailable } from "@/lib/types";

export function TrackRecordTickerPicker({
  available,
  selected,
  max,
  colorOf,
  onToggle,
}: {
  /** 已依發言數 desc 排好（伺服器順序），直接照這個順序渲染。 */
  available: TrackRecordAvailable[];
  selected: readonly string[];
  max: number;
  /** 已選 -> 該股票 slot 的顏色；未選 -> null。 */
  colorOf: (ticker: string) => string | null;
  onToggle: (ticker: string) => void;
}) {
  const t = useTranslations("ChannelDetail.trackRecordChart");
  const anchor = useComboboxAnchor();
  const full = selected.length >= max;
  const tickers = available.map((item) => item.ticker);
  const countOf = new Map(available.map((item) => [item.ticker, item.calls]));

  return (
    // items 交給 base-ui 做內建的字串過濾（比對 ticker 本身；右側的次數是
    // children，不參與比對）。
    //
    // ⚠️ value 必須是**受控**的：勾勾（ItemIndicator）畫的是 base-ui 自己的選取
    // 狀態，若放它非受控，父層拒絕某次變更時（例如「至少留一支」）勾勾會跟真正
    // 的選取脫鉤。受控之下父層不改 selected，勾勾就不會動。上限與「至少留一支」
    // 這兩條規則仍然住在父層，這裡只把「哪一支被動到」還原成 onToggle。
    <Combobox
      items={tickers}
      multiple
      value={selected as string[]}
      onValueChange={(next: string[]) => {
        const changed =
          next.find((ticker) => !selected.includes(ticker)) ??
          selected.find((ticker) => !next.includes(ticker));
        if (changed) onToggle(changed);
      }}
    >
      {/* ComboboxContent's default anchor (with no `anchor` prop) is the
          Input — but our Input lives *inside* the popup, so anchoring to it
          made the popup anchor to itself (unstable position, collapsed
          width). Anchor explicitly to this wrapper around the trigger
          instead. */}
      <div ref={anchor} className="inline-block">
        <ComboboxTrigger
          data-testid="track-picker-trigger"
          render={<Button type="button" size="sm" variant="outline" />}
        >
          {t("picker.trigger", { n: selected.length, max })}
        </ComboboxTrigger>
      </div>
      {/* The popup's default width tracks the trigger's own (locale- and
          content-dependent) width, which crowds long tickers ("GOOGL") against
          the checkmark. Give it a comfortable fixed floor instead. */}
      <ComboboxContent anchor={anchor} className="w-56">
        <ComboboxInput
          data-testid="track-picker-search"
          placeholder={t("picker.placeholder")}
          // ComboboxInput defaults showTrigger to true, which renders its own
          // chevron-only trigger button meant for the "input doubles as the
          // trigger" composition. We already have a separate trigger button
          // above, so that default renders a second, empty trigger inside the
          // popup. Turn it off.
          showTrigger={false}
        />
        <ComboboxEmpty data-testid="track-picker-empty">
          {t("picker.empty")}
        </ComboboxEmpty>
        <ComboboxList className="max-h-72">
          {(ticker: string) => {
            const on = selected.includes(ticker);
            const color = colorOf(ticker);
            return (
              <ComboboxItem
                key={ticker}
                value={ticker}
                data-testid={`track-picker-option-${ticker}`}
                // 選滿之後只鎖「還沒選的」——已選的還要能點來取消。
                disabled={!on && full}
              >
                <span
                  aria-hidden
                  className="inline-block size-2 shrink-0 rounded-sm"
                  style={{
                    backgroundColor: color ?? "transparent",
                    boxShadow: color ? undefined : "inset 0 0 0 1px currentColor",
                  }}
                />
                <span className="flex-1">{ticker}</span>
                <span
                  data-testid={`track-picker-count-${ticker}`}
                  className="tabular-nums text-xs text-muted-foreground"
                >
                  {countOf.get(ticker)}
                </span>
              </ComboboxItem>
            );
          }}
        </ComboboxList>
        {/* A disabled ComboboxItem gets pointer-events-none from the vendored
            combobox (see combobox.tsx's data-disabled styling), so a native
            `title` attribute on it can never be hovered — that tooltip would
            be unreachable in any browser. Render the hint as visible text in
            the popup body instead, where it can actually paint. Full and
            "exactly one left" are mutually exclusive in practice (max > 1),
            so only one line ever shows. */}
        {(full || selected.length === 1) && (
          <p
            data-testid="track-picker-hint"
            className="border-t px-2 py-1.5 text-xs text-muted-foreground"
          >
            {full ? t("picker.maxReached", { max }) : t("picker.minOne")}
          </p>
        )}
      </ComboboxContent>
    </Combobox>
  );
}
