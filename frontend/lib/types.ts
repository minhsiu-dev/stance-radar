export type StanceValue = "buy" | "neutral" | "sell";
export type ConfidenceValue = "high" | "medium" | "low";
export type TimeHorizonValue = "short" | "long" | "unspecified";
export type VideoStatus =
  | "discovered"
  | "pending"
  | "analyzed"
  | "no_transcript"
  | "failed"
  | "skipped";
export type JobKind = "discover" | "analyze" | "load_older";

export interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export interface ChannelItem {
  id: string;
  title: string;
  thumbnail_url: string;
  auto_analyze: boolean;
  added_at: string;
  last_refreshed_at: string | null;
  video_counts?: Partial<Record<VideoStatus, number>>;
}

export interface WeeklyActivity {
  week_start: string;
  total: number;
  analyzed: number;
}

export interface ChannelOverviewItem extends ChannelItem {
  weekly_activity: WeeklyActivity[];
}

export interface ChannelOverviewResponse {
  items: ChannelOverviewItem[];
  total: number;
  page: number;
  page_size: number;
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
  confidence: ConfidenceValue | null;
}

export interface FeedItem {
  video_id: string;
  title: string;
  thumbnail_url: string;
  published_at: string;
  status: VideoStatus;
  error_message: string | null;
  dropped_tickers: string[];
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
  discovered?: number;
}

export interface JobInfo {
  id: number;
  kind: JobKind;
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
  forward_pe: number | null;
  eps: number | null;
  week52_high: number | null;
  week52_low: number | null;
  volume: number | null;
  dividend_yield: number | null;
}

export interface CandleDto {
  time: string | number; // "YYYY-MM-DD" daily, Unix seconds (UTC) intraday
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
  confidence: ConfidenceValue | null;
}

export interface MentionDetail {
  start_seconds: number;
  quote: string;
  stance: StanceValue;
  confidence: ConfidenceValue | null;
  time_horizon: TimeHorizonValue | null;
  is_conditional: boolean | null;
  condition: string | null;
  context_before: string | null;
  context_after: string | null;
  excerpt: string | null;
  youtube_url: string;
}

export interface MentionRow {
  video_id: string;
  video_title: string;
  channel_id: string;
  channel_title: string;
  channel_thumbnail: string;
  published_at: string;
  stance: StanceValue;
  summary: string | null;
  confidence: ConfidenceValue | null;
  youtube_url: string;
  mentions: MentionDetail[];
}

export interface StockListItem {
  ticker: string;
  mention_count: number;
}

export interface StanceZone {
  count: number;
  avatars: { title: string; thumbnail_url: string }[];
}

export interface TrendingStock {
  ticker: string;
  channel_count: number;
  mention_count: number;
  score: number;
  last_mentioned_at: string;
  stances: {
    buy: StanceZone;
    neutral: StanceZone;
    sell: StanceZone;
  };
}

export interface SearchHit {
  ticker: string;
  name: string;
  exchange: string | null;
}

export interface FinancialReport {
  period_end: string;
  total_revenue: number | null;
  gross_profit: number | null;
  operating_income: number | null;
  pretax_income: number | null;
  net_income: number | null;
}

export interface StanceSummary {
  buy: number;
  neutral: number;
  sell: number;
  window_days: number;
  channels: { id: string; title: string; thumbnail_url: string | null }[];
}

export type FinancialsPeriod = "quarterly" | "annual";

export interface DiscoveredVideo {
  id: string;
  title: string;
  thumbnail_url: string;
  published_at: string;
  duration_seconds: number | null;
  status: VideoStatus;
}

export interface DiscoveredGroup {
  channel: { id: string; title: string; thumbnail_url: string };
  videos: DiscoveredVideo[];
}

export interface DiscoveredResponse {
  groups: DiscoveredGroup[];
  total: number;
}

export interface ChannelTickerStat {
  ticker: string;
  videos: number;
  buy: number;
  neutral: number;
  sell: number;
  latest_stance: StanceValue | null;
  latest_date: string | null;
}

export interface ChannelDetailDto extends ChannelItem {
  status_counts: Partial<Record<VideoStatus, number>>;
  top_tickers: ChannelTickerStat[];
}

export interface ChannelVideoItem extends DiscoveredVideo {
  error_message: string | null;
  analyzed_at: string | null;
  dropped_tickers: string[];
  stances: FeedStance[];
}

export interface ChannelVideosResponse {
  items: ChannelVideoItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface AppSettings {
  auto_refresh_minutes: number;
}

export interface FlipPoint {
  video_id: string;
  video_title: string;
  stance: StanceValue;
  summary: string;
  published_at: string;
}

export interface FlipItem {
  channel_id: string;
  channel_title: string;
  channel_thumbnail: string;
  ticker: string;
  direction: "bullish" | "bearish";
  is_reversal: boolean;
  prev: FlipPoint;
  curr: FlipPoint;
}

export interface FlipsResponse {
  window_days: number;
  items: FlipItem[];
}

export interface ScorecardHorizonStats {
  count: number;
  avg_return: number | null;
  avg_alpha: number | null;
  win_rate: number | null;
}

export interface ScorecardCall {
  video_id: string;
  video_title: string;
  ticker: string;
  stance: "buy" | "sell";
  confidence: ConfidenceValue | null;
  summary: string;
  published_at: string;
  entry_date: string | null;
  entry_price: number | null;
  returns: Record<string, number | null>;
  alpha: Record<string, number | null>;
  now_return: number | null;
  now_alpha: number | null;
  has_data: boolean;
}

export interface Scorecard {
  horizons: number[];
  benchmark: string;
  calls: ScorecardCall[];
  total: number;
  page: number;
  page_size: number;
  tickers?: string[];
}

export interface LeaderboardItem {
  channel_id: string;
  channel_title: string;
  channel_thumbnail: string;
  calls_total: number;
  realized_30d: number;
  avg_call_alpha_30d: number | null;
  buy: ScorecardHorizonStats;
  sell: ScorecardHorizonStats;
}

export interface LeaderboardResponse {
  horizon_days: number;
  benchmark: string;
  items: LeaderboardItem[];
}

export type TransactionSide = "buy" | "sell";

export interface PortfolioTransaction {
  id: string;
  ticker: string;
  side: TransactionSide;
  shares: number;
  price: number;
  executed_on: string;
  note: string | null;
  created_at: string;
}

export interface HoldingItem {
  ticker: string;
  shares: number;
  avg_cost: number;
  price: number | null;
  change_percent: number | null;
  market_value: number | null;
  unrealized_pl: number | null;
  unrealized_pl_percent: number | null;
  weight: number | null;
}

export interface HoldingsResponse {
  holdings: HoldingItem[];
  totals: {
    market_value: number | null;
    cost_basis: number;
    unrealized_pl: number | null;
    unrealized_pl_percent: number | null;
    cash: number;
    total_value: number | null;
    cash_weight: number | null;
  };
}

export interface CashResponse {
  amount: number;
}

export type PerfChanges = Record<string, number | null>;

export interface PerformanceSummary {
  ranges: string[];
  portfolio: { total_value: number | null; changes: PerfChanges } | null;
  voo: { price: number | null; changes: PerfChanges };
  qqq: { price: number | null; changes: PerfChanges };
}

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface PerformanceSeries {
  change_percent: number | null;
  series: SeriesPoint[] | null;
}

export interface PerformanceRangeResponse {
  range: string;
  effective_start: string | null;
  portfolio: PerformanceSeries | null;
  voo: PerformanceSeries;
  qqq: PerformanceSeries;
}

export interface AnalystData {
  target_low: number | null;
  target_mean: number | null;
  target_high: number | null;
  analyst_count: number | null;
  recommendations: Record<string, number>;
}

export interface VideoDetailMention {
  start_seconds: number;
  quote: string;
  excerpt: string | null;
  stance: StanceValue;
  confidence: ConfidenceValue | null;
  time_horizon: TimeHorizonValue | null;
  is_conditional: boolean | null;
  condition: string | null;
}

export interface VideoDetailGroup {
  ticker: string;
  stance: StanceValue;
  summary: string | null;
  confidence: ConfidenceValue | null;
  mentions: VideoDetailMention[];
}

export interface VideoDetailResponse {
  video: {
    id: string;
    title: string;
    channel: { id: string; title: string; thumbnail_url: string };
    published_at: string;
    duration_seconds: number | null;
    status: VideoStatus;
  };
  groups: VideoDetailGroup[];
}

export interface PerfCell {
  win_rate: number | null;
  avg: number | null;
  median: number | null;
  n: number;
}

export interface PerfGroup {
  now: PerfCell;
  "30": PerfCell;
  "90": PerfCell;
}

export type PerfFilter = "all" | "buy" | "sell";

export interface ChannelPerformanceDto {
  benchmark: string;
  window_days: number;
  horizons: (string | number)[];
  summary: Record<PerfFilter, PerfGroup>;
  counts: Record<PerfFilter, number>;
}
