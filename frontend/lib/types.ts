export type StanceValue = "buy" | "neutral" | "sell";
export type VideoStatus = "pending" | "analyzed" | "no_transcript" | "failed";

export interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export interface ChannelItem {
  id: string;
  title: string;
  thumbnail_url: string;
  added_at: string;
  last_refreshed_at: string | null;
}

export interface AddChannelsResult {
  added: ChannelItem[];
  skipped: string[];
  failed: { id: string; reason: string }[];
  job_id: number | null;
}

export interface FeedStance {
  ticker: string;
  stance: StanceValue;
  summary: string;
}

export interface FeedItem {
  video_id: string;
  title: string;
  thumbnail_url: string;
  published_at: string;
  status: VideoStatus;
  error_message: string | null;
  channel: { id: string; title: string };
  stances: FeedStance[];
}

export interface FeedResponse {
  items: FeedItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface JobProgress {
  stage?: string;
  channels_done?: number;
  channels_total?: number;
  videos_done?: number;
  videos_total?: number;
}

export interface JobInfo {
  id: number;
  status: "running" | "done" | "failed";
  progress: JobProgress;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
}

export interface StockSummary {
  ticker: string;
  name: string;
  price: number | null;
  change: number | null;
  change_percent: number | null;
  market_cap: number | null;
  pe_ratio: number | null;
  eps: number | null;
  week52_high: number | null;
  week52_low: number | null;
  volume: number | null;
  dividend_yield: number | null;
}

export interface CandleDto {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StanceRow {
  video_id: string;
  video_title: string;
  channel_id: string;
  channel_title: string;
  published_at: string;
  stance: StanceValue;
  summary: string;
}

export interface MentionRow {
  video_id: string;
  video_title: string;
  channel_id: string;
  channel_title: string;
  published_at: string;
  start_seconds: number;
  quote: string;
  stance: StanceValue;
  reasoning: string;
  youtube_url: string;
}

export interface StockListItem {
  ticker: string;
  mention_count: number;
}
