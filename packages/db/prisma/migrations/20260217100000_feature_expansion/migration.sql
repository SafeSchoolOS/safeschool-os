-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('SPORTS', 'ASSEMBLY', 'CONCERT', 'PARENT_NIGHT', 'COMMUNITY', 'MAINTENANCE', 'OTHER_EVENT');
CREATE TYPE "EventStatus" AS ENUM ('SCHEDULED', 'ACTIVE_EVENT', 'COMPLETED_EVENT', 'CANCELLED_EVENT');
CREATE TYPE "DoorEventType" AS ENUM ('FORCED_OPEN', 'HELD_OPEN', 'OFFLINE', 'SLOW_RESPONSE', 'BATTERY_LOW', 'COMM_FAILURE');
CREATE TYPE "WorkOrderPriority" AS ENUM ('LOW_WO', 'MEDIUM_WO', 'HIGH_WO', 'URGENT_WO');
CREATE TYPE "WorkOrderStatus" AS ENUM ('OPEN', 'IN_PROGRESS_WO', 'COMPLETED_WO', 'CANCELLED_WO');
CREATE TYPE "ActionType" AS ENUM ('LOCKDOWN_ACTION', 'DISPATCH_911', 'NOTIFICATION_ACTION', 'DOOR_COMMAND_ACTION', 'UNLOCK_EVENT');
CREATE TYPE "ConfirmationStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED_ACTION', 'PARTIAL_CONFIRMATION', 'FAILED_CONFIRMATION', 'TIMED_OUT_CONFIRMATION');
CREATE TYPE "RollCallStatus" AS ENUM ('ACTIVE_ROLLCALL', 'COMPLETED_ROLLCALL', 'CANCELLED_ROLLCALL');
CREATE TYPE "IntegrationType" AS ENUM ('ACCESS_CONTROL_INT', 'CAMERAS_INT', 'DISPATCH_911_INT', 'NOTIFICATIONS_INT', 'VISITOR_MGMT_INT', 'PANIC_DEVICES_INT', 'WEAPONS_DETECTION_INT', 'GUNSHOT_DETECTION_INT', 'EDGE_SYNC_INT', 'ENVIRONMENTAL_INT');
CREATE TYPE "IntegrationStatus" AS ENUM ('HEALTHY_INTEGRATION', 'DEGRADED_INTEGRATION', 'DOWN_INTEGRATION', 'UNKNOWN_INTEGRATION', 'DISABLED_INTEGRATION');

-- CreateTable: events
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "EventType" NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "recurrence" JSONB,
    "school_hours_override" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable: event_door_grants
CREATE TABLE "event_door_grants" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "door_id" TEXT NOT NULL,
    "unlock_at" TIMESTAMP(3) NOT NULL,
    "lock_at" TIMESTAMP(3) NOT NULL,
    "executed" BOOLEAN NOT NULL DEFAULT false,
    "failed_at" TIMESTAMP(3),
    "fail_reason" TEXT,
    CONSTRAINT "event_door_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable: door_health_events
CREATE TABLE "door_health_events" (
    "id" TEXT NOT NULL,
    "door_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "event_type" "DoorEventType" NOT NULL,
    "severity" TEXT NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "metadata" JSONB,
    "auto_work_order" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "door_health_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable: work_orders
CREATE TABLE "work_orders" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "door_id" TEXT,
    "health_event_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "WorkOrderPriority" NOT NULL,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_to" TEXT,
    "created_by_id" TEXT,
    "due_date" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "notes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable: action_confirmations
CREATE TABLE "action_confirmations" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "action_type" "ActionType" NOT NULL,
    "action_id" TEXT NOT NULL,
    "status" "ConfirmationStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "initiated_by_id" TEXT,
    "initiated_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "timeout_at" TIMESTAMP(3) NOT NULL,
    "escalated_at" TIMESTAMP(3),
    "escalation_msg" TEXT,
    "metadata" JSONB,
    CONSTRAINT "action_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: roll_calls
CREATE TABLE "roll_calls" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "initiated_by_id" TEXT NOT NULL,
    "initiated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "RollCallStatus" NOT NULL DEFAULT 'ACTIVE_ROLLCALL',
    "total_classrooms" INTEGER NOT NULL,
    "reported_classrooms" INTEGER NOT NULL DEFAULT 0,
    "total_students" INTEGER NOT NULL,
    "accounted_students" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "roll_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable: roll_call_reports
CREATE TABLE "roll_call_reports" (
    "id" TEXT NOT NULL,
    "roll_call_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "students_present" INTEGER NOT NULL,
    "students_absent" INTEGER NOT NULL,
    "students_missing" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "students_injured" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "roll_call_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable: integration_health
CREATE TABLE "integration_health" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "integration_name" TEXT NOT NULL,
    "integration_type" "IntegrationType" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'UNKNOWN_INTEGRATION',
    "last_check_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "last_error_at" TIMESTAMP(3),
    "last_error" TEXT,
    "config" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "integration_health_pkey" PRIMARY KEY ("id")
);

-- CreateTable: visitor_bans
CREATE TABLE "visitor_bans" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "date_of_birth" TIMESTAMP(3),
    "id_number" TEXT,
    "reason" TEXT NOT NULL,
    "banned_by_id" TEXT NOT NULL,
    "banned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "photo_url" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "visitor_bans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "events_site_id_status_idx" ON "events"("site_id", "status");
CREATE INDEX "events_site_id_start_time_idx" ON "events"("site_id", "start_time");
CREATE INDEX "event_door_grants_event_id_idx" ON "event_door_grants"("event_id");
CREATE INDEX "event_door_grants_unlock_at_idx" ON "event_door_grants"("unlock_at");
CREATE INDEX "door_health_events_site_id_detected_at_idx" ON "door_health_events"("site_id", "detected_at");
CREATE INDEX "door_health_events_door_id_detected_at_idx" ON "door_health_events"("door_id", "detected_at");
CREATE INDEX "work_orders_site_id_status_idx" ON "work_orders"("site_id", "status");
CREATE INDEX "work_orders_site_id_priority_idx" ON "work_orders"("site_id", "priority");
CREATE UNIQUE INDEX "work_orders_health_event_id_key" ON "work_orders"("health_event_id");
CREATE INDEX "action_confirmations_site_id_status_idx" ON "action_confirmations"("site_id", "status");
CREATE INDEX "action_confirmations_timeout_at_idx" ON "action_confirmations"("timeout_at");
CREATE INDEX "roll_calls_site_id_status_idx" ON "roll_calls"("site_id", "status");
CREATE INDEX "roll_calls_incident_id_idx" ON "roll_calls"("incident_id");
CREATE UNIQUE INDEX "roll_call_reports_roll_call_id_user_id_key" ON "roll_call_reports"("roll_call_id", "user_id");
CREATE INDEX "roll_call_reports_roll_call_id_idx" ON "roll_call_reports"("roll_call_id");
CREATE UNIQUE INDEX "integration_health_site_id_integration_name_key" ON "integration_health"("site_id", "integration_name");
CREATE INDEX "integration_health_site_id_idx" ON "integration_health"("site_id");
CREATE INDEX "visitor_bans_site_id_last_name_first_name_idx" ON "visitor_bans"("site_id", "last_name", "first_name");
CREATE INDEX "visitor_bans_site_id_is_active_idx" ON "visitor_bans"("site_id", "is_active");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_door_grants" ADD CONSTRAINT "event_door_grants_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_door_grants" ADD CONSTRAINT "event_door_grants_door_id_fkey" FOREIGN KEY ("door_id") REFERENCES "doors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "door_health_events" ADD CONSTRAINT "door_health_events_door_id_fkey" FOREIGN KEY ("door_id") REFERENCES "doors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "door_health_events" ADD CONSTRAINT "door_health_events_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_door_id_fkey" FOREIGN KEY ("door_id") REFERENCES "doors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_health_event_id_fkey" FOREIGN KEY ("health_event_id") REFERENCES "door_health_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "action_confirmations" ADD CONSTRAINT "action_confirmations_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "roll_calls" ADD CONSTRAINT "roll_calls_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "roll_calls" ADD CONSTRAINT "roll_calls_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "roll_call_reports" ADD CONSTRAINT "roll_call_reports_roll_call_id_fkey" FOREIGN KEY ("roll_call_id") REFERENCES "roll_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "roll_call_reports" ADD CONSTRAINT "roll_call_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "roll_call_reports" ADD CONSTRAINT "roll_call_reports_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_health" ADD CONSTRAINT "integration_health_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visitor_bans" ADD CONSTRAINT "visitor_bans_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visitor_bans" ADD CONSTRAINT "visitor_bans_banned_by_id_fkey" FOREIGN KEY ("banned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
