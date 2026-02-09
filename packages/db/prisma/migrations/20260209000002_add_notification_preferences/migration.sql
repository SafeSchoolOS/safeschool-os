CREATE TABLE "notification_preferences" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "site_id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "alert_level" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "notification_preferences_user_id_site_id_channel_alert_level_key" ON "notification_preferences"("user_id", "site_id", "channel", "alert_level");
CREATE INDEX "notification_preferences_user_id_site_id_idx" ON "notification_preferences"("user_id", "site_id");
