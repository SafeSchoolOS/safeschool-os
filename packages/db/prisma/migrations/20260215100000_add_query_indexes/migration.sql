-- AddQueryIndexes
-- Adds composite indexes based on actual query patterns in the API routes
-- These indexes cover WHERE+ORDER BY combinations for the most-queried tables

-- Alerts: cover findMany({ where: { siteId, status }, orderBy: { triggeredAt: 'desc' } })
CREATE INDEX "alerts_site_id_status_triggered_at_idx" ON "alerts"("site_id", "status", "triggered_at");

-- Doors: cover lockdown updateMany({ where: { siteId, buildingId, isEmergencyExit: false } })
CREATE INDEX "doors_site_id_building_id_is_emergency_exit_idx" ON "doors"("site_id", "building_id", "is_emergency_exit");

-- AuditLog: cover user-scoped audit queries (siteId + userId + ordered by createdAt)
CREATE INDEX "audit_logs_site_id_user_id_created_at_idx" ON "audit_logs"("site_id", "user_id", "created_at");

-- ParentContact: cover parent portal email lookup
CREATE INDEX "parent_contacts_email_idx" ON "parent_contacts"("email");

-- Students: cover building/room filter on student list
CREATE INDEX "students_site_id_building_id_idx" ON "students"("site_id", "building_id");
CREATE INDEX "students_site_id_room_id_idx" ON "students"("site_id", "room_id");

-- Drills: cover status filter and compliance date-range queries
CREATE INDEX "drills_site_id_status_idx" ON "drills"("site_id", "status");
CREATE INDEX "drills_site_id_status_completed_at_idx" ON "drills"("site_id", "status", "completed_at");

-- AnonymousTips: cover severity-based filtering
CREATE INDEX "anonymous_tips_site_id_severity_idx" ON "anonymous_tips"("site_id", "severity");

-- ThreatReports: cover date-ordered listing
CREATE INDEX "threat_reports_site_id_created_at_idx" ON "threat_reports"("site_id", "created_at");

-- SocialMediaAlerts: cover date-ordered listing
CREATE INDEX "social_media_alerts_site_id_created_at_idx" ON "social_media_alerts"("site_id", "created_at");

-- CardholderCredentials: cover lockdown bulk-revoke of visitor credentials
CREATE INDEX "cardholder_credentials_status_credential_type_idx" ON "cardholder_credentials"("status", "credential_type");
