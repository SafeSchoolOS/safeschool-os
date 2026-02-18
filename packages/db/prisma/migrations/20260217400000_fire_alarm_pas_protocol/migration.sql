-- CreateEnum
CREATE TYPE "FireAlarmDeviceType" AS ENUM ('SMOKE_DETECTOR', 'HEAT_DETECTOR', 'MANUAL_PULL_STATION', 'SPRINKLER_WATERFLOW', 'DUCT_DETECTOR', 'UNKNOWN_DEVICE');

CREATE TYPE "FireAlarmEventStatus" AS ENUM ('ALARM_ACTIVE', 'ACKNOWLEDGED_ALARM', 'INVESTIGATING', 'CONFIRMED_FIRE', 'FALSE_ALARM', 'AUTO_ESCALATED');

CREATE TYPE "FireAlarmSuspicion" AS ENUM ('HIGH_SUSPICION', 'ELEVATED_SUSPICION', 'MODERATE_SUSPICION', 'LOW_SUSPICION', 'UNKNOWN_SUSPICION');

CREATE TYPE "FireAlarmDecision" AS ENUM ('EVACUATE_ALL', 'EVACUATE_DIRECTED', 'MAINTAIN_LOCKDOWN', 'EXTEND_INVESTIGATION');

-- CreateTable
CREATE TABLE "fire_alarm_zones" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "building_id" TEXT,
    "name" TEXT NOT NULL,
    "zone_number" TEXT NOT NULL,
    "floor" INTEGER,
    "description" TEXT,
    "has_pull_stations" BOOLEAN NOT NULL DEFAULT true,
    "has_smoke_detectors" BOOLEAN NOT NULL DEFAULT true,
    "has_heat_detectors" BOOLEAN NOT NULL DEFAULT false,
    "has_sprinklers" BOOLEAN NOT NULL DEFAULT false,
    "map_x" DOUBLE PRECISION,
    "map_y" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fire_alarm_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fire_alarm_events" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "alert_id" TEXT,
    "fire_alarm_zone_id" TEXT,
    "device_type" "FireAlarmDeviceType" NOT NULL,
    "status" "FireAlarmEventStatus" NOT NULL DEFAULT 'ALARM_ACTIVE',
    "suspicion_level" "FireAlarmSuspicion" NOT NULL DEFAULT 'UNKNOWN_SUSPICION',
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by_id" TEXT,
    "investigation_ends_at" TIMESTAMP(3),
    "decision_made_at" TIMESTAMP(3),
    "decision_made_by_id" TEXT,
    "decision" "FireAlarmDecision",
    "active_lockdown_id" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fire_alarm_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evacuation_routes" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "building_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "from_zones" TEXT[],
    "to_exit" TEXT,
    "door_ids" TEXT[],
    "avoid_zones" TEXT[],
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "map_path" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evacuation_routes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fire_alarm_zones_site_id_zone_number_key" ON "fire_alarm_zones"("site_id", "zone_number");
CREATE INDEX "fire_alarm_zones_site_id_idx" ON "fire_alarm_zones"("site_id");
CREATE INDEX "fire_alarm_events_site_id_status_idx" ON "fire_alarm_events"("site_id", "status");
CREATE INDEX "fire_alarm_events_alert_id_idx" ON "fire_alarm_events"("alert_id");
CREATE INDEX "evacuation_routes_site_id_idx" ON "evacuation_routes"("site_id");

-- AddForeignKey
ALTER TABLE "fire_alarm_zones" ADD CONSTRAINT "fire_alarm_zones_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fire_alarm_events" ADD CONSTRAINT "fire_alarm_events_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fire_alarm_events" ADD CONSTRAINT "fire_alarm_events_fire_alarm_zone_id_fkey" FOREIGN KEY ("fire_alarm_zone_id") REFERENCES "fire_alarm_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "evacuation_routes" ADD CONSTRAINT "evacuation_routes_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
