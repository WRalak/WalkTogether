-- Convert activity_gps_points into a RANGE-partitioned table (monthly on recorded_at).
-- Partitions live in the gps_partitions schema so ORM introspection only sees the parent table.
-- Safe for existing data: rows are copied inside this migration's transaction.
CREATE SCHEMA IF NOT EXISTS gps_partitions;

CREATE TABLE "activity_gps_points_new" (
    "activity_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "segment" INTEGER NOT NULL DEFAULT 0,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy_m" DOUBLE PRECISION,
    "altitude_m" DOUBLE PRECISION,
    "altitude_accuracy_m" DOUBLE PRECISION,
    "speed_mps" DOUBLE PRECISION
) PARTITION BY RANGE ("recorded_at");

-- Creates monthly partitions from `from_month` for `months` months (idempotent).
CREATE OR REPLACE FUNCTION gps_partitions.ensure_partitions(from_month date, months integer) RETURNS integer AS $$
DECLARE
  m date := date_trunc('month', from_month)::date;
  created integer := 0;
  name text;
BEGIN
  FOR i IN 0..months - 1 LOOP
    name := 'activity_gps_points_' || to_char(m, 'YYYY_MM');
    IF to_regclass('gps_partitions.' || name) IS NULL THEN
      EXECUTE format('CREATE TABLE gps_partitions.%I PARTITION OF public.activity_gps_points FOR VALUES FROM (%L) TO (%L)', name, m, (m + interval '1 month')::date);
      created := created + 1;
    END IF;
    m := (m + interval '1 month')::date;
  END LOOP;
  RETURN created;
END;
$$ LANGUAGE plpgsql;

INSERT INTO "activity_gps_points_new" SELECT "activity_id", "seq", "segment", "recorded_at", "lat", "lng", "accuracy_m", "altitude_m", "altitude_accuracy_m", "speed_mps" FROM "activity_gps_points";
DROP TABLE "activity_gps_points";
ALTER TABLE "activity_gps_points_new" RENAME TO "activity_gps_points";

-- Catch-all for out-of-range timestamps (e.g. old imports); monthly partitions are created ahead.
CREATE TABLE gps_partitions.activity_gps_points_default PARTITION OF "activity_gps_points" DEFAULT;

ALTER TABLE "activity_gps_points" ADD CONSTRAINT "activity_gps_points_pkey" PRIMARY KEY ("activity_id", "seq", "recorded_at");
ALTER TABLE "activity_gps_points" ADD CONSTRAINT "activity_gps_points_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity_gps_points" ADD CONSTRAINT "gps_points_valid" CHECK ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180 AND "seq" >= 0);
CREATE INDEX "activity_gps_points_recorded_brin" ON "activity_gps_points" USING BRIN ("recorded_at");

-- Rows already in the default partition for these months must move before the monthly partitions exist.
DO $$
DECLARE
  start_month date := least(date_trunc('month', now() - interval '12 months'), coalesce((SELECT date_trunc('month', min(recorded_at)) FROM gps_partitions.activity_gps_points_default), now()))::date;
BEGIN
  CREATE TEMP TABLE _gps_move ON COMMIT DROP AS SELECT * FROM gps_partitions.activity_gps_points_default;
  DELETE FROM gps_partitions.activity_gps_points_default;
  PERFORM gps_partitions.ensure_partitions(start_month, (extract(year FROM age(date_trunc('month', now()) + interval '4 months', start_month)) * 12 + extract(month FROM age(date_trunc('month', now()) + interval '4 months', start_month)))::integer);
  INSERT INTO activity_gps_points SELECT * FROM _gps_move;
END $$;
