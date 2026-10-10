import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { LaneStatus } from "@/components/pipeline/lane-status";
import type { PipelineLane } from "@/lib/types";
import { NOW, iso, lane, messages } from "./pipeline-fixtures";

const handleAuthError = vi.fn();
vi.mock("@/components/admin-provider", () => ({ useAdmin: () => ({ handleAuthError }) }));

const apiFetchMock = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

/** ISO for local hh:mm, `days` after NOW's local date. */
function localAt(days: number, hours: number, minutes: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

function renderStatus(value: PipelineLane) {
  const onChanged = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LaneStatus name="analysis" lane={value} now={NOW} onChanged={onChanged} />
    </NextIntlClientProvider>,
  );
  return onChanged;
}

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue({ lane: "analysis", paused: true });
  handleAuthError.mockReset();
});

describe("LaneStatus", () => {
  it("shows a running lane with its slots and pauses it", async () => {
    const onChanged = renderStatus(lane());
    expect(screen.getByText("Running · 5 slots")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(apiFetchMock).toHaveBeenCalledWith("/api/pipeline/lanes/analysis/pause", {
      method: "POST",
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows a manual pause without an error box and resumes it", async () => {
    renderStatus(lane({ paused: true, pause_reason: "manual", last_error: "old news" }));
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(apiFetchMock).toHaveBeenCalledWith("/api/pipeline/lanes/analysis/resume", {
      method: "POST",
    });
  });

  it("explains an automatic pause with the error that caused it", () => {
    renderStatus(
      lane({
        paused: true,
        pause_reason: "auto",
        last_error: "usage limit reached",
        last_error_at: iso(192_000),
      }),
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Paused after an error");
    expect(alert).toHaveTextContent("3m12s ago");
    expect(alert).toHaveTextContent("usage limit reached");
  });

  it("shows the usage line when usage is known", () => {
    renderStatus(
      lane({
        usage: {
          five_hour: { utilization: 0.153, resets_at: "2026-10-04T15:00:00Z" },
          seven_day: null,
          at: iso(60_000),
        },
      }),
    );
    expect(screen.getByText("Claude usage: 5h 15% · 7d –%")).toBeInTheDocument();
  });

  it("shows the limit box with the resume time", () => {
    renderStatus(
      lane({
        paused: true,
        pause_reason: "limit",
        resume_at: localAt(0, 15, 0),
        last_error: "5-hour usage 72% >= 70%",
      }),
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Usage limit reached — resumes automatically at 15:00");
    expect(alert).toHaveTextContent("5-hour usage 72% >= 70%");
    expect(screen.queryByText(/Paused after an error/)).toBeNull();
  });

  it("shows the date when resume is not today", () => {
    renderStatus(
      lane({ paused: true, pause_reason: "limit", resume_at: localAt(3, 9, 5) }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/\d{1,2}\/\d{1,2} 09:05/);
  });

  it("shows how long an offline worker has been silent, with no controls", () => {
    renderStatus(
      lane({
        online: false,
        last_heartbeat_at: iso(3 * 60_000),
        last_error: "claude was killed by signal 11",
      }),
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("hasn't responded for 3 minutes");
    expect(alert).toHaveTextContent("Last error: claude was killed by signal 11");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offline with no heartbeat ever says so instead of counting minutes", () => {
    renderStatus(lane({ online: false, last_heartbeat_at: null }));
    expect(screen.getByRole("alert")).toHaveTextContent("hasn't reported in yet");
  });

  it("reports a failed request and routes a 401 through handleAuthError", async () => {
    apiFetchMock.mockRejectedValue(new Error("Admin locked"));
    renderStatus(lane());

    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(await screen.findByText("Action failed: Admin locked")).toBeInTheDocument();
    expect(handleAuthError).toHaveBeenCalled();
  });
});
