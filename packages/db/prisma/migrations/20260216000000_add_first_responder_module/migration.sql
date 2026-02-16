-- First Responder Module Migration
-- Adds all tables for agency management, incidents, floor plans, tips,
-- reunification, secure messaging, gateway redundancy, and audit logging.

-- ============================================================================
-- Enums
-- ============================================================================

CREATE TYPE "AgencyType" AS ENUM ('POLICE', 'FIRE', 'EMS', 'DISPATCH_CENTER');
CREATE TYPE "AgencyStatus" AS ENUM ('ACTIVE_AGENCY', 'SUSPENDED_AGENCY', 'PENDING_AGENCY');
CREATE TYPE "ResponderRole" AS ENUM ('DISPATCH_ROLE', 'PATROL', 'COMMAND', 'AGENCY_ADMIN', 'INVESTIGATOR');
CREATE TYPE "ResponderPermission" AS ENUM ('VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS', 'VIEW_CAMERA_FEEDS', 'CONTROL_DOORS', 'VIEW_VISITOR_LIST', 'VIEW_STUDENT_ACCOUNTABILITY', 'VIEW_INCIDENT_LOGS', 'EXPORT_DATA', 'COMMUNICATE_STAFF', 'VIEW_TIPS');
CREATE TYPE "ResponderUserStatus" AS ENUM ('ACTIVE_RESPONDER', 'DISABLED_RESPONDER');
CREATE TYPE "AgencyAccessLevel" AS ENUM ('PRE_INCIDENT', 'FULL_RESPONSE', 'INVESTIGATION');
CREATE TYPE "SchoolAgencyStatus" AS ENUM ('ACTIVE_LINK', 'EXPIRED_LINK', 'REVOKED_LINK');
CREATE TYPE "IncidentType" AS ENUM ('ACTIVE_THREAT', 'LOCKDOWN_INCIDENT', 'MEDICAL_INCIDENT', 'FIRE_INCIDENT', 'HAZMAT', 'WEATHER_INCIDENT', 'INTRUDER', 'BOMB_THREAT', 'OTHER_INCIDENT');
CREATE TYPE "IncidentStatus" AS ENUM ('TRIGGERED_INCIDENT', 'DISPATCHED_INCIDENT', 'RESPONDING_INCIDENT', 'ON_SCENE', 'LOCKDOWN_ACTIVE', 'ALL_CLEAR_INCIDENT', 'REUNIFICATION_INCIDENT', 'RESOLVED_INCIDENT', 'FALSE_ALARM');
CREATE TYPE "IncidentSeverity" AS ENUM ('CRITICAL_INCIDENT', 'HIGH_INCIDENT', 'MEDIUM_INCIDENT', 'LOW_INCIDENT');
CREATE TYPE "TimelineActionType" AS ENUM ('PANIC_ACTIVATED', 'DISPATCH_SENT', 'DISPATCH_ACKNOWLEDGED', 'LOCKDOWN_INITIATED', 'DOOR_LOCKED', 'DOOR_UNLOCKED', 'DOOR_FORCED', 'CAMERA_ACCESSED', 'RESPONDER_EN_ROUTE', 'RESPONDER_ON_SCENE', 'NOTIFICATION_SENT', 'ACCOUNTABILITY_UPDATE', 'ALL_CLEAR_ACTION', 'REUNIFICATION_STARTED', 'STUDENT_RELEASED', 'INCIDENT_RESOLVED', 'NOTE_ADDED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'FALSE_ALARM_DECLARED');
CREATE TYPE "FloorDeviceType" AS ENUM ('FP_DOOR', 'FP_CAMERA', 'FP_PANIC_BUTTON_WALL', 'FP_READER', 'FP_INTERCOM', 'FP_AED', 'FP_FIRE_EXTINGUISHER', 'FP_FIRE_PULL', 'FP_FIRE_PANEL', 'FP_UTILITY_SHUTOFF_ELECTRIC', 'FP_UTILITY_SHUTOFF_GAS', 'FP_UTILITY_SHUTOFF_WATER', 'FP_FIRST_AID_KIT', 'FP_RALLY_POINT', 'FP_STAIRWELL', 'FP_ELEVATOR', 'FP_RESTROOM', 'FP_OFFICE', 'FP_HAZMAT_STORAGE');
CREATE TYPE "FRReunificationStatus" AS ENUM ('PREPARING', 'ACTIVE_REUNIFICATION', 'WINDING_DOWN', 'COMPLETED_REUNIFICATION');
CREATE TYPE "FRTipSource" AS ENUM ('WEB_FORM', 'MOBILE_APP_TIP', 'TEXT_SMS', 'PHONE_TIP', 'EMAIL_TIP', 'WEBHOOK_WETIP', 'WEBHOOK_STOPIT', 'WEBHOOK_SAY_SOMETHING', 'WEBHOOK_CUSTOM');
CREATE TYPE "FRTipCategory" AS ENUM ('THREAT_OF_VIOLENCE', 'WEAPON', 'BULLYING_TIP', 'DRUGS_TIP', 'SELF_HARM_TIP', 'SUSPICIOUS_PERSON', 'SUSPICIOUS_PACKAGE', 'INFRASTRUCTURE_TIP', 'OTHER_TIP');
CREATE TYPE "FRTipStatus" AS ENUM ('NEW_TIP', 'UNDER_REVIEW_TIP', 'ESCALATED_TIP', 'RESOLVED_TIP', 'DISMISSED_TIP');
CREATE TYPE "SmsTipState" AS ENUM ('AWAITING_SCHOOL', 'AWAITING_CATEGORY', 'AWAITING_CONTENT', 'AWAITING_CONFIRM', 'COMPLETED_SMS', 'EXPIRED_SMS', 'CANCELLED_SMS');
CREATE TYPE "GatewayClusterRole" AS ENUM ('SINGLE', 'PRIMARY_GW', 'SECONDARY_GW', 'ASSUMED_PRIMARY');
CREATE TYPE "GatewayClusterMode" AS ENUM ('STANDALONE', 'ACTIVE_ACTIVE', 'ACTIVE_PASSIVE');
CREATE TYPE "GatewayClusterState" AS ENUM ('HEALTHY_GW', 'DEGRADED_GW', 'FAILOVER_GW', 'RECOVERING_GW', 'SINGLE_GW');
CREATE TYPE "GatewayStatus" AS ENUM ('ONLINE_GW', 'OFFLINE_GW', 'DEGRADED_STATUS_GW', 'UPDATING_GW', 'PROVISIONING_GW');
CREATE TYPE "GatewayFailoverReason" AS ENUM ('HEARTBEAT_TIMEOUT', 'NETWORK_LOSS', 'HARDWARE_FAILURE', 'MANUAL_TRIGGER', 'SOFTWARE_CRASH', 'UPDATE_REBOOT');

-- ============================================================================
-- Agencies
-- ============================================================================

CREATE TABLE "agencies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AgencyType" NOT NULL,
    "jurisdiction" TEXT,
    "primary_contact" TEXT,
    "primary_phone" TEXT,
    "primary_email" TEXT,
    "dispatch_phone" TEXT,
    "psap_id" TEXT,
    "rapid_sos_org_id" TEXT,
    "status" "AgencyStatus" NOT NULL DEFAULT 'PENDING_AGENCY',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "responder_users" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "badge_number" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" "ResponderRole" NOT NULL,
    "permissions" "ResponderPermission"[],
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret" TEXT,
    "last_login" TIMESTAMP(3),
    "status" "ResponderUserStatus" NOT NULL DEFAULT 'ACTIVE_RESPONDER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "responder_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "responder_users_email_key" ON "responder_users"("email");
CREATE INDEX "responder_users_agency_id_idx" ON "responder_users"("agency_id");

CREATE TABLE "school_agency_links" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "access_level" "AgencyAccessLevel" NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "mou_signed" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3),
    "status" "SchoolAgencyStatus" NOT NULL DEFAULT 'ACTIVE_LINK',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "school_agency_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "school_agency_links_site_id_agency_id_key" ON "school_agency_links"("site_id", "agency_id");

-- ============================================================================
-- Incidents
-- ============================================================================

CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "type" "IncidentType" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'TRIGGERED_INCIDENT',
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'HIGH_INCIDENT',
    "triggered_by" TEXT,
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger_device_id" TEXT,
    "trigger_building_id" TEXT,
    "trigger_floor" INTEGER,
    "trigger_room" TEXT,
    "trigger_lat" DOUBLE PRECISION,
    "trigger_lng" DOUBLE PRECISION,
    "dispatched_at" TIMESTAMP(3),
    "first_responder_arrival" TIMESTAMP(3),
    "all_clear_at" TIMESTAMP(3),
    "reunification_started_at" TIMESTAMP(3),
    "reunification_completed_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "incidents_site_id_idx" ON "incidents"("site_id");
CREATE INDEX "incidents_status_idx" ON "incidents"("status");
CREATE INDEX "incidents_site_id_status_idx" ON "incidents"("site_id", "status");

CREATE TABLE "incident_timeline" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "action_type" "TimelineActionType" NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "incident_timeline_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "incident_timeline_incident_id_timestamp_idx" ON "incident_timeline"("incident_id", "timestamp");

CREATE TABLE "incident_agencies" (
    "incident_id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "notified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "on_scene_at" TIMESTAMP(3),
    CONSTRAINT "incident_agencies_pkey" PRIMARY KEY ("incident_id", "agency_id")
);

-- ============================================================================
-- Floor Plans & Facility Data
-- ============================================================================

CREATE TABLE "floor_plans" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "building_id" TEXT NOT NULL,
    "building_name" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "floor_name" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "image_width" INTEGER NOT NULL,
    "image_height" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "floor_plans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "floor_plans_site_id_idx" ON "floor_plans"("site_id");
CREATE INDEX "floor_plans_building_id_idx" ON "floor_plans"("building_id");

CREATE TABLE "floor_plan_devices" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "type" "FloorDeviceType" NOT NULL,
    "label" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB,
    CONSTRAINT "floor_plan_devices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "floor_plan_devices_plan_id_idx" ON "floor_plan_devices"("plan_id");

CREATE TABLE "floor_plan_annotations" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT,
    "coordinates" JSONB NOT NULL,
    "color" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "floor_plan_annotations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "floor_plan_annotations_plan_id_idx" ON "floor_plan_annotations"("plan_id");

CREATE TABLE "data_packages" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_by" TEXT,
    "contents" JSONB NOT NULL,
    "pdf_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "data_packages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "data_packages_site_id_idx" ON "data_packages"("site_id");

CREATE TABLE "data_package_downloads" (
    "id" TEXT NOT NULL,
    "data_package_id" TEXT NOT NULL,
    "downloaded_by" TEXT NOT NULL,
    "downloaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,
    CONSTRAINT "data_package_downloads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fr_reunification_sites" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "capacity" INTEGER,
    "distance_from_school" TEXT,
    "driving_directions" TEXT,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "parking_capacity" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fr_reunification_sites_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fr_reunification_sites_site_id_idx" ON "fr_reunification_sites"("site_id");

CREATE TABLE "staging_areas" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staging_areas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "staging_areas_site_id_idx" ON "staging_areas"("site_id");

CREATE TABLE "key_holders" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT,
    "has_keys" BOOLEAN NOT NULL DEFAULT false,
    "has_access_card" BOOLEAN NOT NULL DEFAULT false,
    "has_alarm_code" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 99,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "key_holders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "key_holders_site_id_idx" ON "key_holders"("site_id");

CREATE TABLE "hazard_locations" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "building_id" TEXT,
    "type" TEXT NOT NULL,
    "location_description" TEXT,
    "floor" INTEGER,
    "description" TEXT,
    "sds_available" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hazard_locations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hazard_locations_site_id_idx" ON "hazard_locations"("site_id");

-- ============================================================================
-- Reunification (Enhanced)
-- ============================================================================

CREATE TABLE "fr_reunification_events" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "reunification_site_id" TEXT,
    "status" "FRReunificationStatus" NOT NULL DEFAULT 'PREPARING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "total_students" INTEGER NOT NULL DEFAULT 0,
    "students_accounted" INTEGER NOT NULL DEFAULT 0,
    "students_released" INTEGER NOT NULL DEFAULT 0,
    "students_missing" INTEGER NOT NULL DEFAULT 0,
    "students_injured" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fr_reunification_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fr_reunification_events_incident_id_idx" ON "fr_reunification_events"("incident_id");
CREATE INDEX "fr_reunification_events_site_id_idx" ON "fr_reunification_events"("site_id");

CREATE TABLE "guardian_checkins" (
    "id" TEXT NOT NULL,
    "reunification_event_id" TEXT NOT NULL,
    "guardian_name" TEXT NOT NULL,
    "guardian_id_type" TEXT,
    "guardian_id_last4" TEXT,
    "guardian_id_verified" BOOLEAN NOT NULL DEFAULT false,
    "requested_student_ids" TEXT[],
    "authorized_in_sis" BOOLEAN NOT NULL DEFAULT false,
    "checked_in_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked_in_by" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CHECKED_IN',
    "deny_reason" TEXT,
    CONSTRAINT "guardian_checkins_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "guardian_checkins_reunification_event_id_idx" ON "guardian_checkins"("reunification_event_id");

CREATE TABLE "student_releases" (
    "id" TEXT NOT NULL,
    "reunification_event_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "student_name" TEXT NOT NULL,
    "guardian_checkin_id" TEXT,
    "released_to" TEXT NOT NULL,
    "released_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_by" TEXT,
    "notes" TEXT,
    CONSTRAINT "student_releases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "student_releases_reunification_event_id_idx" ON "student_releases"("reunification_event_id");

-- ============================================================================
-- Tips (Enhanced)
-- ============================================================================

CREATE TABLE "fr_tips" (
    "id" TEXT NOT NULL,
    "tracking_code" TEXT NOT NULL,
    "site_id" TEXT,
    "source" "FRTipSource" NOT NULL,
    "category" "FRTipCategory" NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tipster_contact" TEXT,
    "is_anonymous" BOOLEAN NOT NULL DEFAULT true,
    "severity" "TipSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "FRTipStatus" NOT NULL DEFAULT 'NEW_TIP',
    "assigned_to" TEXT,
    "escalated_to_agency_id" TEXT,
    "escalated_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution" TEXT,
    "public_status_message" TEXT,
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "external_source_id" TEXT,
    "external_source" TEXT,
    "sms_conversation_id" TEXT,
    "sms_phone_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fr_tips_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fr_tips_tracking_code_key" ON "fr_tips"("tracking_code");
CREATE INDEX "fr_tips_site_id_status_idx" ON "fr_tips"("site_id", "status");
CREATE INDEX "fr_tips_severity_idx" ON "fr_tips"("severity");
CREATE INDEX "fr_tips_tracking_code_idx" ON "fr_tips"("tracking_code");
CREATE INDEX "fr_tips_external_source_external_source_id_idx" ON "fr_tips"("external_source", "external_source_id");

CREATE TABLE "tip_follow_ups" (
    "id" TEXT NOT NULL,
    "tip_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tip_follow_ups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tip_follow_ups_tip_id_created_at_idx" ON "tip_follow_ups"("tip_id", "created_at");

CREATE TABLE "sms_tip_conversations" (
    "id" TEXT NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "phone_encrypted" TEXT,
    "state" "SmsTipState" NOT NULL DEFAULT 'AWAITING_SCHOOL',
    "site_id" TEXT,
    "category" TEXT,
    "content" TEXT,
    "tip_id" TEXT,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sms_tip_conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sms_tip_conversations_phone_hash_state_idx" ON "sms_tip_conversations"("phone_hash", "state");
CREATE INDEX "sms_tip_conversations_expires_at_idx" ON "sms_tip_conversations"("expires_at");

CREATE TABLE "sms_tip_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "twilio_sid" TEXT,
    "status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sms_tip_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sms_tip_messages_conversation_id_created_at_idx" ON "sms_tip_messages"("conversation_id", "created_at");

CREATE TABLE "tip_webhook_configs" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "api_key" TEXT NOT NULL,
    "category_mapping" JSONB NOT NULL DEFAULT '{}',
    "default_category" TEXT NOT NULL DEFAULT 'OTHER_TIP',
    "school_external_id" TEXT,
    "last_received_at" TIMESTAMP(3),
    "total_received" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tip_webhook_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tip_webhook_configs_site_id_source_key" ON "tip_webhook_configs"("site_id", "source");

-- ============================================================================
-- Secure Messaging
-- ============================================================================

CREATE TABLE "secure_messages" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "sender_type" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL,
    "recipient_type" TEXT NOT NULL,
    "recipient_id" TEXT,
    "content" TEXT NOT NULL,
    "message_type" TEXT NOT NULL DEFAULT 'TEXT',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "secure_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "secure_messages_incident_id_thread_id_created_at_idx" ON "secure_messages"("incident_id", "thread_id", "created_at");

-- ============================================================================
-- Responder Audit Log
-- ============================================================================

CREATE TABLE "responder_audit_log" (
    "id" TEXT NOT NULL,
    "responder_user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "site_id" TEXT,
    "incident_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "responder_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "responder_audit_log_responder_user_id_created_at_idx" ON "responder_audit_log"("responder_user_id", "created_at");
CREATE INDEX "responder_audit_log_site_id_created_at_idx" ON "responder_audit_log"("site_id", "created_at");

-- ============================================================================
-- Video Bookmarks
-- ============================================================================

CREATE TABLE "video_bookmarks" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "camera_id" TEXT NOT NULL,
    "camera_name" TEXT,
    "bookmark_start" TIMESTAMP(3) NOT NULL,
    "bookmark_end" TIMESTAMP(3),
    "label" TEXT,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "video_bookmarks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "video_bookmarks_incident_id_idx" ON "video_bookmarks"("incident_id");

-- ============================================================================
-- Gateway Redundancy
-- ============================================================================

CREATE TABLE "gateways" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT,
    "ip_address" TEXT,
    "mac_address" TEXT,
    "hardware_model" TEXT,
    "firmware_version" TEXT,
    "serial_number" TEXT,
    "cluster_role" "GatewayClusterRole" NOT NULL DEFAULT 'SINGLE',
    "cluster_mode" "GatewayClusterMode" NOT NULL DEFAULT 'STANDALONE',
    "cluster_state" "GatewayClusterState" NOT NULL DEFAULT 'SINGLE_GW',
    "partner_id" TEXT,
    "assigned_devices" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assigned_zones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "GatewayStatus" NOT NULL DEFAULT 'PROVISIONING_GW',
    "last_heartbeat_at" TIMESTAMP(3),
    "last_cloud_sync_at" TIMESTAMP(3),
    "cpu_usage" INTEGER,
    "memory_usage" INTEGER,
    "disk_usage" INTEGER,
    "uptime_seconds" BIGINT,
    "ble_devices_connected" INTEGER NOT NULL DEFAULT 0,
    "network_latency_ms" INTEGER,
    "primary_connection" TEXT NOT NULL DEFAULT 'ETHERNET',
    "has_backup_cellular" BOOLEAN NOT NULL DEFAULT false,
    "cellular_signal_strength" INTEGER,
    "provisioning_token" TEXT,
    "auth_token_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gateways_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gateways_site_id_idx" ON "gateways"("site_id");
CREATE INDEX "gateways_partner_id_idx" ON "gateways"("partner_id");
CREATE INDEX "gateways_status_idx" ON "gateways"("status");

CREATE TABLE "gateway_heartbeats" (
    "id" TEXT NOT NULL,
    "gateway_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "cpu_usage" INTEGER,
    "memory_usage" INTEGER,
    "ble_devices_connected" INTEGER,
    "pending_commands" INTEGER NOT NULL DEFAULT 0,
    "active_incident_id" TEXT,
    "firmware_version" TEXT,
    CONSTRAINT "gateway_heartbeats_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gateway_heartbeats_gateway_id_timestamp_idx" ON "gateway_heartbeats"("gateway_id", "timestamp" DESC);

CREATE TABLE "gateway_failover_events" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "failed_gateway_id" TEXT NOT NULL,
    "assuming_gateway_id" TEXT NOT NULL,
    "failover_type" TEXT NOT NULL,
    "reason" "GatewayFailoverReason" NOT NULL,
    "devices_transferred" INTEGER NOT NULL DEFAULT 0,
    "failover_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failover_completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "incident_active_at_time" BOOLEAN NOT NULL DEFAULT false,
    "recovered_at" TIMESTAMP(3),
    "rebalanced_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gateway_failover_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gateway_failover_events_site_id_failover_started_at_idx" ON "gateway_failover_events"("site_id", "failover_started_at" DESC);

CREATE TABLE "gateway_state_syncs" (
    "id" TEXT NOT NULL,
    "source_gateway_id" TEXT NOT NULL,
    "target_gateway_id" TEXT NOT NULL,
    "sync_type" TEXT NOT NULL,
    "payload_size_bytes" INTEGER,
    "sync_duration_ms" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gateway_state_syncs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gateway_state_syncs_source_gateway_id_created_at_idx" ON "gateway_state_syncs"("source_gateway_id", "created_at" DESC);

CREATE TABLE "door_commands" (
    "id" TEXT NOT NULL,
    "door_id" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "issued_by" TEXT NOT NULL,
    "issued_by_type" TEXT NOT NULL,
    "incident_id" TEXT,
    "gateway_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "executed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "timeout_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "door_commands_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "door_commands_gateway_id_status_idx" ON "door_commands"("gateway_id", "status");
CREATE INDEX "door_commands_incident_id_idx" ON "door_commands"("incident_id");

-- ============================================================================
-- Foreign Keys
-- ============================================================================

ALTER TABLE "responder_users" ADD CONSTRAINT "responder_users_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "school_agency_links" ADD CONSTRAINT "school_agency_links_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "school_agency_links" ADD CONSTRAINT "school_agency_links_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incident_timeline" ADD CONSTRAINT "incident_timeline_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incident_agencies" ADD CONSTRAINT "incident_agencies_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incident_agencies" ADD CONSTRAINT "incident_agencies_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "floor_plan_devices" ADD CONSTRAINT "floor_plan_devices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "floor_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "floor_plan_annotations" ADD CONSTRAINT "floor_plan_annotations_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "floor_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_packages" ADD CONSTRAINT "data_packages_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_package_downloads" ADD CONSTRAINT "data_package_downloads_data_package_id_fkey" FOREIGN KEY ("data_package_id") REFERENCES "data_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_package_downloads" ADD CONSTRAINT "data_package_downloads_downloaded_by_fkey" FOREIGN KEY ("downloaded_by") REFERENCES "responder_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fr_reunification_sites" ADD CONSTRAINT "fr_reunification_sites_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staging_areas" ADD CONSTRAINT "staging_areas_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "key_holders" ADD CONSTRAINT "key_holders_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hazard_locations" ADD CONSTRAINT "hazard_locations_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fr_reunification_events" ADD CONSTRAINT "fr_reunification_events_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fr_reunification_events" ADD CONSTRAINT "fr_reunification_events_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fr_reunification_events" ADD CONSTRAINT "fr_reunification_events_reunification_site_id_fkey" FOREIGN KEY ("reunification_site_id") REFERENCES "fr_reunification_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "guardian_checkins" ADD CONSTRAINT "guardian_checkins_reunification_event_id_fkey" FOREIGN KEY ("reunification_event_id") REFERENCES "fr_reunification_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_releases" ADD CONSTRAINT "student_releases_reunification_event_id_fkey" FOREIGN KEY ("reunification_event_id") REFERENCES "fr_reunification_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_releases" ADD CONSTRAINT "student_releases_guardian_checkin_id_fkey" FOREIGN KEY ("guardian_checkin_id") REFERENCES "guardian_checkins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fr_tips" ADD CONSTRAINT "fr_tips_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fr_tips" ADD CONSTRAINT "fr_tips_escalated_to_agency_id_fkey" FOREIGN KEY ("escalated_to_agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tip_follow_ups" ADD CONSTRAINT "tip_follow_ups_tip_id_fkey" FOREIGN KEY ("tip_id") REFERENCES "fr_tips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sms_tip_messages" ADD CONSTRAINT "sms_tip_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "sms_tip_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "secure_messages" ADD CONSTRAINT "secure_messages_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "secure_messages" ADD CONSTRAINT "secure_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "responder_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "responder_audit_log" ADD CONSTRAINT "responder_audit_log_responder_user_id_fkey" FOREIGN KEY ("responder_user_id") REFERENCES "responder_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "video_bookmarks" ADD CONSTRAINT "video_bookmarks_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "video_bookmarks" ADD CONSTRAINT "video_bookmarks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "responder_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gateways" ADD CONSTRAINT "gateways_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gateways" ADD CONSTRAINT "gateways_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "gateways"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gateway_heartbeats" ADD CONSTRAINT "gateway_heartbeats_gateway_id_fkey" FOREIGN KEY ("gateway_id") REFERENCES "gateways"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gateway_failover_events" ADD CONSTRAINT "gateway_failover_events_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gateway_failover_events" ADD CONSTRAINT "gateway_failover_events_failed_gateway_id_fkey" FOREIGN KEY ("failed_gateway_id") REFERENCES "gateways"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gateway_failover_events" ADD CONSTRAINT "gateway_failover_events_assuming_gateway_id_fkey" FOREIGN KEY ("assuming_gateway_id") REFERENCES "gateways"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gateway_state_syncs" ADD CONSTRAINT "gateway_state_syncs_source_gateway_id_fkey" FOREIGN KEY ("source_gateway_id") REFERENCES "gateways"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gateway_state_syncs" ADD CONSTRAINT "gateway_state_syncs_target_gateway_id_fkey" FOREIGN KEY ("target_gateway_id") REFERENCES "gateways"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "door_commands" ADD CONSTRAINT "door_commands_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "door_commands" ADD CONSTRAINT "door_commands_gateway_id_fkey" FOREIGN KEY ("gateway_id") REFERENCES "gateways"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
