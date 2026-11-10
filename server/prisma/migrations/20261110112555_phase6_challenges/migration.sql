-- CreateEnum
CREATE TYPE "ChallengeScope" AS ENUM ('PLATFORM', 'CLUB', 'CLUB_VS_CLUB', 'SPONSORED');

-- CreateEnum
CREATE TYPE "ChallengeMetric" AS ENUM ('DISTANCE_M', 'ACTIVITIES', 'MOVING_SECONDS', 'ACTIVE_DAYS');

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeaderboardScope" AS ENUM ('GLOBAL', 'CLUB');

-- CreateEnum
CREATE TYPE "LeaderboardPeriod" AS ENUM ('WEEK', 'MONTH');

-- CreateTable
CREATE TABLE "challenges" (
    "id" UUID NOT NULL,
    "scope" "ChallengeScope" NOT NULL,
    "club_id" UUID,
    "created_by_id" UUID,
    "created_by_admin_id" UUID,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(3000),
    "metric" "ChallengeMetric" NOT NULL,
    "activity_types" "ActivityType"[],
    "target" INTEGER,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "visibility" "EventVisibility" NOT NULL DEFAULT 'PUBLIC',
    "status" "ChallengeStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_premium" BOOLEAN NOT NULL DEFAULT false,
    "rules" VARCHAR(5000),
    "reward_description" VARCHAR(500),
    "max_daily_distance_m" INTEGER NOT NULL DEFAULT 42195,
    "sponsor_name" VARCHAR(120),
    "cover_url" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_clubs" (
    "challenge_id" UUID NOT NULL,
    "club_id" UUID NOT NULL,

    CONSTRAINT "challenge_clubs_pkey" PRIMARY KEY ("challenge_id","club_id")
);

-- CreateTable
CREATE TABLE "challenge_participants" (
    "challenge_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "team_club_id" UUID,
    "hide_from_leaderboard" BOOLEAN NOT NULL DEFAULT false,
    "progress_value" INTEGER NOT NULL DEFAULT 0,
    "progress_updated_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "notified_halfway" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_participants_pkey" PRIMARY KEY ("challenge_id","user_id")
);

-- CreateTable
CREATE TABLE "challenge_progress" (
    "challenge_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "challenge_progress_pkey" PRIMARY KEY ("challenge_id","user_id","day")
);

-- CreateTable
CREATE TABLE "challenge_results" (
    "challenge_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_results_pkey" PRIMARY KEY ("challenge_id","user_id")
);

-- CreateTable
CREATE TABLE "leaderboards" (
    "id" UUID NOT NULL,
    "scope" "LeaderboardScope" NOT NULL,
    "club_id" UUID,
    "period" "LeaderboardPeriod" NOT NULL,
    "period_start" DATE NOT NULL,
    "activity_type" "ActivityType",
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leaderboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboard_entries" (
    "leaderboard_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "leaderboard_entries_pkey" PRIMARY KEY ("leaderboard_id","user_id")
);

-- CreateTable
CREATE TABLE "fitness_achievements" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "icon" VARCHAR(16) NOT NULL DEFAULT '🏅',
    "rule" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fitness_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_achievements" (
    "user_id" UUID NOT NULL,
    "achievement_id" UUID NOT NULL,
    "earned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_id" UUID,

    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("user_id","achievement_id")
);

-- CreateIndex
CREATE INDEX "challenges_status_scope_ends_at_idx" ON "challenges"("status", "scope", "ends_at");

-- CreateIndex
CREATE INDEX "challenges_club_id_status_idx" ON "challenges"("club_id", "status");

-- CreateIndex
CREATE INDEX "challenge_participants_challenge_id_progress_value_idx" ON "challenge_participants"("challenge_id", "progress_value");

-- CreateIndex
CREATE INDEX "challenge_participants_user_id_idx" ON "challenge_participants"("user_id");

-- CreateIndex
CREATE INDEX "challenge_results_challenge_id_rank_idx" ON "challenge_results"("challenge_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboards_scope_club_id_period_period_start_activity_typ_key" ON "leaderboards"("scope", "club_id", "period", "period_start", "activity_type");

-- CreateIndex
CREATE INDEX "leaderboard_entries_leaderboard_id_rank_idx" ON "leaderboard_entries"("leaderboard_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "fitness_achievements_code_key" ON "fitness_achievements"("code");

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_clubs" ADD CONSTRAINT "challenge_clubs_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_clubs" ADD CONSTRAINT "challenge_clubs_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_progress" ADD CONSTRAINT "challenge_progress_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_results" ADD CONSTRAINT "challenge_results_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_leaderboard_id_fkey" FOREIGN KEY ("leaderboard_id") REFERENCES "leaderboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "fitness_achievements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "challenges" ADD CONSTRAINT "challenges_time_order" CHECK ("ends_at" > "starts_at");
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_target_pos" CHECK ("target" IS NULL OR "target" > 0);
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_daily_cap_pos" CHECK ("max_daily_distance_m" > 0);
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_club_scope" CHECK (("scope" = 'CLUB') = ("club_id" IS NOT NULL));
