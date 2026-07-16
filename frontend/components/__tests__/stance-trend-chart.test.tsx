import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { StanceTrendChart, overlayPoints } from "@/components/stance-trend-chart";
import type { SparklinePoint, StanceBucket } from "@/lib/types";

const messages = {
  Stock: {
    stance: { buy: "Buy", neutral: "Neutral", sell: "Sell", new: "New", repeat: "Repeat" },
  },
};

function wrap(buckets: StanceBucket[], props: { yMax?: number; closes?: SparklinePoint[] } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <StanceTrendChart buckets={buckets} {...props} />
    </NextIntlClientProvider>,
  );
}

const B = (over: Partial<StanceBucket>): StanceBucket => ({
  start: "2026-06-01T00:00:00+00:00", end: "2026-06-08T00:00:00+00:00",
  granularity: "week",
  buy_new: 0, buy_repeat: 0,
  neutral_new: 0, neutral_repeat: 0,
  sell_new: 0, sell_repeat: 0,
  ...over,
});

describe("StanceTrendChart", () => {
  it("renders a recharts stacked bar chart container when there is data", () => {
    const { container } = wrap([B({ buy_new: 2 }), B({ sell_repeat: 1 })]);
    // shadcn ChartContainer renders a div with data-slot="chart"
    expect(container.querySelector('[data-slot="chart"]')).toBeInTheDocument();
    // recharts renders a responsive container div (SVG is not rendered in jsdom due to zero dimensions)
    expect(container.querySelector(".recharts-responsive-container, svg")).toBeTruthy();
  });

  it("renders nothing when all buckets are empty", () => {
    const { container } = wrap([B({}), B({})]);
    expect(container.firstChild).toBeNull();
  });
});

const SPARK_BUCKETS = [
  B({ buy_new: 2, start: "2026-06-01T00:00:00+00:00", end: "2026-06-08T00:00:00+00:00" }),
  B({ sell_new: 1, start: "2026-06-08T00:00:00+00:00", end: "2026-06-15T00:00:00+00:00" }),
];

describe("price overlay", () => {
  const closes = [
    { date: "2026-05-25", close: 90 },  // before the bucket window -> dropped
    { date: "2026-06-03", close: 100 },
    { date: "2026-06-10", close: 110 },
    { date: "2026-06-20", close: 120 }, // after the window -> clamped to right edge
  ];

  it("renders a polyline clipped to the bucket window", () => {
    const { container } = wrap(SPARK_BUCKETS, { closes });
    const line = container.querySelector('[data-testid="price-overlay-line"]');
    expect(line).toBeInTheDocument();
    const xs = (line!.getAttribute("points") ?? "")
      .split(" ")
      .map((p) => Number(p.split(",")[0]));
    expect(xs).toHaveLength(3); // 05-25 dropped
    // 06-03's close sits at its end-of-day (06-04T00Z) = 3 of 14 window days
    expect(xs[0]).toBeCloseTo(21.43, 1);
    expect(xs[2]).toBe(100); // clamped to the right edge
    expect(line!.getAttribute("stroke")).toBe("#10b981"); // rising window
  });

  it("renders red when the window is falling", () => {
    const { container } = wrap(SPARK_BUCKETS, {
      closes: [
        { date: "2026-06-03", close: 120 },
        { date: "2026-06-10", close: 100 },
      ],
    });
    expect(
      container.querySelector('[data-testid="price-overlay-line"]')!.getAttribute("stroke"),
    ).toBe("#ef4444");
  });

  it("renders no line with fewer than 2 in-window closes", () => {
    const { container } = wrap(SPARK_BUCKETS, {
      closes: [{ date: "2026-05-25", close: 90 }, { date: "2026-06-03", close: 100 }],
    });
    expect(container.querySelector('[data-testid="price-overlay-line"]')).toBeNull();
  });

  it("renders no line without closes and keeps the bars", () => {
    const { container } = wrap(SPARK_BUCKETS);
    expect(container.querySelector('[data-testid="price-overlay-line"]')).toBeNull();
    expect(container.querySelector('[data-slot="chart"]')).toBeInTheDocument();
  });
});

describe("overlayPoints", () => {
  const buckets = SPARK_BUCKETS;

  it("maps closes onto the bucket window by end-of-day fraction", () => {
    const r = overlayPoints(buckets, [
      { date: "2026-06-03", close: 100 },
      { date: "2026-06-10", close: 110 },
    ]);
    expect(r).not.toBeNull();
    const xs = r!.points.split(" ").map((p) => Number(p.split(",")[0]));
    expect(xs[0]).toBeCloseTo(21.43, 1); // 06-03 end-of-day = 06-04T00Z = 3/14 of the window
    expect(xs[1]).toBeCloseTo(71.43, 1); // 06-10 end-of-day = 06-11T00Z = 10/14
    expect(r!.up).toBe(true);
  });

  it("returns null for empty buckets or <2 visible closes", () => {
    expect(overlayPoints([], [{ date: "2026-06-03", close: 1 }, { date: "2026-06-04", close: 2 }])).toBeNull();
    expect(overlayPoints(buckets, [{ date: "2026-06-03", close: 1 }])).toBeNull();
  });
});
