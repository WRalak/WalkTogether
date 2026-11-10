-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('RECORDING', 'COMPLETED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "GoalPeriod" AS ENUM ('WEEK', 'MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "GoalMetric" AS ENUM ('DISTANCE_M', 'ACTIVITIES', 'MOVING_SECONDS');

-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "weight_kg" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "type" "ActivityType" NOT NULL,
    "status" "ActivityStatus" NOT NULL DEFAULT 'RECORDING',
    "title" VARCHAR(120),
    "notes" VARCHAR(1000),
    "visibility" "Visibility" NOT NULL DEFAULT 'FOLLOWERS',
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "distance_m" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "moving_seconds" INTEGER NOT NULL DEFAULT 0,
    "elapsed_seconds" INTEGER NOT NULL DEFAULT 0,
    "avg_pace_sec_per_km" INTEGER,
    "avg_speed_mps" DOUBLE PRECISION,
    "max_speed_mps" DOUBLE PRECISION,
    "elevation_gain_m" INTEGER,
    "calories_estimate" INTEGER,
    "point_count" INTEGER NOT NULL DEFAULT 0,
    "route_polyline" TEXT,
    "route" geography(LineString, 4326),
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "flags" JSONB NOT NULL DEFAULT '{}',
    "client_stats" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_gps_points" (
    "activity_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "segment" INTEGER NOT NULL DEFAULT 0,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy_m" DOUBLE PRECISION,
    "altitude_m" DOUBLE PRECISION,
    "altitude_accuracy_m" DOUBLE PRECISION,
    "speed_mps" DOUBLE PRECISION,

    CONSTRAINT "activity_gps_points_pkey" PRIMARY KEY ("activity_id","seq")
);

-- CreateTable
CREATE TABLE "activity_club_shares" (
    "activity_id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_club_shares_pkey" PRIMARY KEY ("activity_id","club_id")
);

-- CreateTable
CREATE TABLE "personal_goals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "metric" "GoalMetric" NOT NULL,
    "period" "GoalPeriod" NOT NULL,
    "activity_type" "ActivityType",
    "target" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activities_user_id_status_started_at_idx" ON "activities"("user_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "activities_status_visibility_started_at_idx" ON "activities"("status", "visibility", "started_at");

-- CreateIndex
CREATE INDEX "activities_route_gist" ON "activities" USING GIST ("route");

-- CreateIndex
CREATE UNIQUE INDEX "activities_user_id_client_id_key" ON "activities"("user_id", "client_id");

-- CreateIndex
CREATE INDEX "activity_club_shares_club_id_created_at_idx" ON "activity_club_shares"("club_id", "created_at");

-- CreateIndex
CREATE INDEX "personal_goals_user_id_active_idx" ON "personal_goals"("user_id", "active");

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_gps_points" ADD CONSTRAINT "activity_gps_points_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_club_shares" ADD CONSTRAINT "activity_club_shares_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_club_shares" ADD CONSTRAINT "activity_club_shares_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_goals" ADD CONSTRAINT "personal_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activities" ADD CONSTRAINT "activities_stats_nonneg" CHECK ("distance_m" >= 0 AND "moving_seconds" >= 0 AND "elapsed_seconds" >= 0 AND "point_count" >= 0);
ALTER TABLE "activity_gps_points" ADD CONSTRAINT "gps_points_valid" CHECK ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180 AND "seq" >= 0);
ALTER TABLE "personal_goals" ADD CONSTRAINT "personal_goals_target_pos" CHECK ("target" > 0);
-- BRIN index: cheap time-ordered access to very large point tables.
CREATE INDEX "activity_gps_points_recorded_brin" ON "activity_gps_points" USING BRIN ("recorded_at");
