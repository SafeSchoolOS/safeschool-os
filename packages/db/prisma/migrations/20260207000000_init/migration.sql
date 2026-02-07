-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('CLASSROOM', 'OFFICE', 'GYM', 'CAFETERIA', 'HALLWAY', 'ENTRANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'SITE_ADMIN', 'OPERATOR', 'TEACHER', 'FIRST_RESPONDER', 'PARENT');

-- CreateEnum
CREATE TYPE "AlertLevel" AS ENUM ('MEDICAL', 'LOCKDOWN', 'ACTIVE_THREAT', 'FIRE', 'WEATHER', 'ALL_CLEAR', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('TRIGGERED', 'ACKNOWLEDGED', 'DISPATCHED', 'RESPONDING', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AlertSource" AS ENUM ('WEARABLE', 'MOBILE_APP', 'WALL_STATION', 'DASHBOARD', 'AUTOMATED');

-- CreateEnum
CREATE TYPE "DoorStatus" AS ENUM ('LOCKED', 'UNLOCKED', 'OPEN', 'FORCED', 'HELD', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LockdownScope" AS ENUM ('FULL_SITE', 'BUILDING', 'FLOOR', 'ZONE');

-- CreateEnum
CREATE TYPE "DispatchMethod" AS ENUM ('RAPIDSОС', 'RAVE_911', 'SIP_DIRECT', 'CELLULAR', 'CONSOLE');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('PENDING', 'SENT', 'RECEIVED', 'DISPATCHED', 'ON_SCENE', 'FAILED');

-- CreateEnum
CREATE TYPE "VisitorStatus" AS ENUM ('PRE_REGISTERED', 'CHECKED_IN', 'CHECKED_OUT', 'DENIED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "ScanType" AS ENUM ('BOARD', 'EXIT');

-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buildings" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "floors" INTEGER NOT NULL DEFAULT 1,
    "floor_plan_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "floor" INTEGER NOT NULL DEFAULT 1,
    "type" "RoomType" NOT NULL DEFAULT 'CLASSROOM',
    "capacity" INTEGER,
    "ble_beacon_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "clerk_id" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "phone" TEXT,
    "wearable_device_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sites" (
    "user_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,

    CONSTRAINT "user_sites_pkey" PRIMARY KEY ("user_id","site_id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "level" "AlertLevel" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'TRIGGERED',
    "source" "AlertSource" NOT NULL,
    "triggered_by_id" TEXT NOT NULL,
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_by_id" TEXT,
    "acknowledged_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "building_id" TEXT NOT NULL,
    "building_name" TEXT NOT NULL,
    "floor" INTEGER,
    "room_id" TEXT,
    "room_name" TEXT,
    "zone" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "message" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doors" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "floor" INTEGER NOT NULL DEFAULT 1,
    "zone" TEXT,
    "status" "DoorStatus" NOT NULL DEFAULT 'LOCKED',
    "controller_type" TEXT NOT NULL DEFAULT 'mock',
    "controller_id" TEXT NOT NULL DEFAULT '',
    "is_exterior" BOOLEAN NOT NULL DEFAULT false,
    "is_emergency_exit" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lockdown_commands" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "scope" "LockdownScope" NOT NULL,
    "target_id" TEXT NOT NULL,
    "initiated_by_id" TEXT NOT NULL,
    "initiated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),
    "alert_id" TEXT,
    "doors_locked" INTEGER NOT NULL DEFAULT 0,
    "doors_failed" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lockdown_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_records" (
    "id" TEXT NOT NULL,
    "alert_id" TEXT NOT NULL,
    "method" "DispatchMethod" NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "failover_used" BOOLEAN NOT NULL DEFAULT false,
    "failover_method" "DispatchMethod",
    "response_time_ms" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatch_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "details" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitors" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "photo" TEXT,
    "id_type" TEXT,
    "id_number_hash" TEXT,
    "purpose" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "host_user_id" TEXT,
    "status" "VisitorStatus" NOT NULL DEFAULT 'PRE_REGISTERED',
    "checked_in_at" TIMESTAMP(3),
    "checked_out_at" TIMESTAMP(3),
    "badge_number" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitor_screenings" (
    "id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "sex_offender_check" TEXT NOT NULL,
    "watchlist_check" TEXT NOT NULL,
    "custom_check" TEXT,
    "checked_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitor_screenings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buses" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "bus_number" TEXT NOT NULL,
    "driver_id" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 72,
    "has_rfid_reader" BOOLEAN NOT NULL DEFAULT false,
    "has_panic_button" BOOLEAN NOT NULL DEFAULT false,
    "has_cameras" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "current_latitude" DOUBLE PRECISION,
    "current_longitude" DOUBLE PRECISION,
    "current_speed" DOUBLE PRECISION,
    "current_heading" DOUBLE PRECISION,
    "last_gps_at" TIMESTAMP(3),
    "current_student_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_routes" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "route_number" TEXT NOT NULL,
    "scheduled_departure_time" TEXT NOT NULL,
    "scheduled_arrival_time" TEXT NOT NULL,
    "is_am_route" BOOLEAN NOT NULL DEFAULT true,
    "is_pm_route" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bus_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_route_assignments" (
    "id" TEXT NOT NULL,
    "bus_id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,

    CONSTRAINT "bus_route_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_stops" (
    "id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "scheduled_time" TEXT NOT NULL,
    "stop_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bus_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_cards" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "student_name" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "grade" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_stop_assignments" (
    "id" TEXT NOT NULL,
    "student_card_id" TEXT NOT NULL,
    "stop_id" TEXT NOT NULL,

    CONSTRAINT "student_stop_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ridership_events" (
    "id" TEXT NOT NULL,
    "student_card_id" TEXT NOT NULL,
    "bus_id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "scan_type" "ScanType" NOT NULL,
    "scan_method" TEXT NOT NULL DEFAULT 'RFID',
    "scanned_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ridership_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parent_contacts" (
    "id" TEXT NOT NULL,
    "student_card_id" TEXT NOT NULL,
    "parent_name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "push_token" TEXT,
    "board_alerts" BOOLEAN NOT NULL DEFAULT true,
    "exit_alerts" BOOLEAN NOT NULL DEFAULT true,
    "eta_alerts" BOOLEAN NOT NULL DEFAULT true,
    "delay_alerts" BOOLEAN NOT NULL DEFAULT true,
    "missed_bus_alerts" BOOLEAN NOT NULL DEFAULT true,
    "sms_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "push_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parent_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "alert_id" TEXT,
    "channel" TEXT NOT NULL,
    "recipient_count" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "sent_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demo_requests" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "school" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phone" TEXT,
    "buildings" INTEGER,
    "state" TEXT,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demo_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_clerk_id_key" ON "users"("clerk_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "alerts_site_id_status_idx" ON "alerts"("site_id", "status");

-- CreateIndex
CREATE INDEX "alerts_triggered_at_idx" ON "alerts"("triggered_at");

-- CreateIndex
CREATE INDEX "doors_site_id_idx" ON "doors"("site_id");

-- CreateIndex
CREATE INDEX "doors_building_id_idx" ON "doors"("building_id");

-- CreateIndex
CREATE INDEX "lockdown_commands_site_id_idx" ON "lockdown_commands"("site_id");

-- CreateIndex
CREATE INDEX "dispatch_records_alert_id_idx" ON "dispatch_records"("alert_id");

-- CreateIndex
CREATE INDEX "audit_logs_site_id_created_at_idx" ON "audit_logs"("site_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "visitors_site_id_status_idx" ON "visitors"("site_id", "status");

-- CreateIndex
CREATE INDEX "visitors_site_id_checked_in_at_idx" ON "visitors"("site_id", "checked_in_at");

-- CreateIndex
CREATE UNIQUE INDEX "visitor_screenings_visitor_id_key" ON "visitor_screenings"("visitor_id");

-- CreateIndex
CREATE INDEX "buses_site_id_idx" ON "buses"("site_id");

-- CreateIndex
CREATE INDEX "bus_routes_site_id_idx" ON "bus_routes"("site_id");

-- CreateIndex
CREATE UNIQUE INDEX "bus_route_assignments_bus_id_route_id_key" ON "bus_route_assignments"("bus_id", "route_id");

-- CreateIndex
CREATE INDEX "bus_stops_route_id_idx" ON "bus_stops"("route_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_cards_card_id_key" ON "student_cards"("card_id");

-- CreateIndex
CREATE INDEX "student_cards_site_id_idx" ON "student_cards"("site_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_stop_assignments_student_card_id_stop_id_key" ON "student_stop_assignments"("student_card_id", "stop_id");

-- CreateIndex
CREATE INDEX "ridership_events_student_card_id_scanned_at_idx" ON "ridership_events"("student_card_id", "scanned_at");

-- CreateIndex
CREATE INDEX "ridership_events_bus_id_scanned_at_idx" ON "ridership_events"("bus_id", "scanned_at");

-- CreateIndex
CREATE INDEX "parent_contacts_student_card_id_idx" ON "parent_contacts"("student_card_id");

-- CreateIndex
CREATE INDEX "notification_logs_site_id_sent_at_idx" ON "notification_logs"("site_id", "sent_at");

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sites" ADD CONSTRAINT "user_sites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sites" ADD CONSTRAINT "user_sites_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledged_by_id_fkey" FOREIGN KEY ("acknowledged_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doors" ADD CONSTRAINT "doors_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doors" ADD CONSTRAINT "doors_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lockdown_commands" ADD CONSTRAINT "lockdown_commands_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lockdown_commands" ADD CONSTRAINT "lockdown_commands_initiated_by_id_fkey" FOREIGN KEY ("initiated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lockdown_commands" ADD CONSTRAINT "lockdown_commands_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_records" ADD CONSTRAINT "dispatch_records_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_host_user_id_fkey" FOREIGN KEY ("host_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitor_screenings" ADD CONSTRAINT "visitor_screenings_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buses" ADD CONSTRAINT "buses_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_routes" ADD CONSTRAINT "bus_routes_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_route_assignments" ADD CONSTRAINT "bus_route_assignments_bus_id_fkey" FOREIGN KEY ("bus_id") REFERENCES "buses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_route_assignments" ADD CONSTRAINT "bus_route_assignments_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "bus_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_stops" ADD CONSTRAINT "bus_stops_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "bus_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_cards" ADD CONSTRAINT "student_cards_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_stop_assignments" ADD CONSTRAINT "student_stop_assignments_student_card_id_fkey" FOREIGN KEY ("student_card_id") REFERENCES "student_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_stop_assignments" ADD CONSTRAINT "student_stop_assignments_stop_id_fkey" FOREIGN KEY ("stop_id") REFERENCES "bus_stops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ridership_events" ADD CONSTRAINT "ridership_events_student_card_id_fkey" FOREIGN KEY ("student_card_id") REFERENCES "student_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ridership_events" ADD CONSTRAINT "ridership_events_bus_id_fkey" FOREIGN KEY ("bus_id") REFERENCES "buses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ridership_events" ADD CONSTRAINT "ridership_events_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "bus_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_contacts" ADD CONSTRAINT "parent_contacts_student_card_id_fkey" FOREIGN KEY ("student_card_id") REFERENCES "student_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
