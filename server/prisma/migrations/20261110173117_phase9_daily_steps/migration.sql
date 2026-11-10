-- CreateEnum
CREATE TYPE "StepsSource" AS ENUM ('HEALTH_CONNECT', 'HEALTHKIT');

-- CreateTable
CREATE TABLE "daily_steps" (
    "user_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "source" "StepsSource" NOT NULL,
    "steps" INTEGER NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_steps_pkey" PRIMARY KEY ("user_id","day","source")
);

-- AddForeignKey
ALTER TABLE "daily_steps" ADD CONSTRAINT "daily_steps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_steps" ADD CONSTRAINT "daily_steps_range" CHECK ("steps" BETWEEN 0 AND 200000);
