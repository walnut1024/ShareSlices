import type { GalleryCapabilityReadiness } from "./configuration.js";
import type { Pool } from "pg";

export type GalleryMetricName =
  | "safety_pending"
  | "cover_pending"
  | "copy_pending"
  | "report_open"
  | "notification_pending"
  | "retention_pending"
  | "eligibility_failure";

export type GalleryMetricsSnapshot = Readonly<{
  observedAt: string;
  values: Readonly<Record<GalleryMetricName, number>>;
  readiness: GalleryCapabilityReadiness;
}>;

const metricNames: readonly GalleryMetricName[] = [
  "safety_pending",
  "cover_pending",
  "copy_pending",
  "report_open",
  "notification_pending",
  "retention_pending",
  "eligibility_failure",
];

/** A bounded operational snapshot. It intentionally contains no listing rank or Viewer identity. */
export function galleryMetricsSnapshot(
  values: Partial<Record<GalleryMetricName, number>>,
  readiness: GalleryCapabilityReadiness,
  now: Date = new Date(),
): GalleryMetricsSnapshot {
  return {
    observedAt: now.toISOString(),
    values: Object.fromEntries(
      metricNames.map((name) => [name, boundedCount(values[name])]),
    ) as Record<GalleryMetricName, number>,
    readiness: { ...readiness },
  };
}

function boundedCount(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value < 0) return 0;
  return Math.min(Math.trunc(value), Number.MAX_SAFE_INTEGER);
}

export class GalleryOperationalMonitor {
  constructor(private readonly pool: Pick<Pool, "query">, private readonly readiness: () => GalleryCapabilityReadiness) {}

  async snapshot(): Promise<GalleryMetricsSnapshot> {
    const {rows} = await this.pool.query(`select
      (select count(*) from gallery_safety_job where state in ('queued','running'))::int safety_pending,
      (select count(*) from gallery_cover_job where state in ('queued','running'))::int cover_pending,
      (select count(*) from gallery_copy_job where state in ('accepted','processing'))::int copy_pending,
      (select count(*) from gallery_report where state='open')::int report_open,
      (select count(*) from gallery_notification where read_at is null)::int notification_pending,
      ((select count(*) from gallery_privacy_retention_record where deleted_at is null and retained_until<=now()) +
       (select count(*) from gallery_avatar_upload where state='staged' and expires_at<=now()))::int retention_pending`);
    const readiness = this.readiness();
    return galleryMetricsSnapshot({...rows[0], eligibility_failure: Object.values(readiness).filter((value) => !value).length}, readiness);
  }
}
