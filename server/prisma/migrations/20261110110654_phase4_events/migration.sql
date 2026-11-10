-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('WALK', 'RUN', 'HIKE', 'CHARITY_WALK', 'FITNESS', 'SOCIAL');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('PUBLIC', 'MEMBERS');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MODERATE', 'HARD');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('GOING', 'WAITLISTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceMethod" AS ENUM ('QR', 'ORGANIZER');

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "club_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "series_id" UUID,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(5000),
    "type" "EventType" NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "visibility" "EventVisibility" NOT NULL DEFAULT 'MEMBERS',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Africa/Nairobi',
    "meeting_point" VARCHAR(200) NOT NULL,
    "meeting_lat" DOUBLE PRECISION,
    "meeting_lng" DOUBLE PRECISION,
    "meeting_location" geography(Point, 4326),
    "route_description" VARCHAR(2000),
    "distance_m" INTEGER,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'EASY',
    "max_participants" INTEGER,
    "registration_closes_at" TIMESTAMP(3),
    "cover_url" VARCHAR(500),
    "check_in_secret" VARCHAR(64) NOT NULL,
    "cancel_reason" VARCHAR(300),
    "going_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_registrations" (
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "RegistrationStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_registrations_pkey" PRIMARY KEY ("event_id","user_id")
);

-- CreateTable
CREATE TABLE "event_attendance" (
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "method" "AttendanceMethod" NOT NULL,
    "checked_in_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked_in_by_id" UUID,
    "distance_from_meeting_m" INTEGER,

    CONSTRAINT "event_attendance_pkey" PRIMARY KEY ("event_id","user_id")
);

-- CreateTable
CREATE TABLE "event_reminders" (
    "event_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_reminders_pkey" PRIMARY KEY ("event_id","kind")
);

-- CreateIndex
CREATE INDEX "events_club_id_starts_at_idx" ON "events"("club_id", "starts_at");

-- CreateIndex
CREATE INDEX "events_status_visibility_starts_at_idx" ON "events"("status", "visibility", "starts_at");

-- CreateIndex
CREATE INDEX "events_series_id_starts_at_idx" ON "events"("series_id", "starts_at");

-- CreateIndex
CREATE INDEX "events_meeting_location_gist" ON "events" USING GIST ("meeting_location");

-- CreateIndex
CREATE INDEX "event_registrations_event_id_status_created_at_idx" ON "event_registrations"("event_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "event_registrations_user_id_status_idx" ON "event_registrations"("user_id", "status");

-- CreateIndex
CREATE INDEX "event_attendance_user_id_checked_in_at_idx" ON "event_attendance"("user_id", "checked_in_at");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_reminders" ADD CONSTRAINT "event_reminders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "events" ADD CONSTRAINT "events_time_order" CHECK ("ends_at" > "starts_at");
ALTER TABLE "events" ADD CONSTRAINT "events_capacity" CHECK ("max_participants" IS NULL OR "max_participants" > 0);
ALTER TABLE "events" ADD CONSTRAINT "events_going_nonneg" CHECK ("going_count" >= 0);
