-- CreateTable
CREATE TABLE "badgeguard_integrations" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "api_url" TEXT NOT NULL DEFAULT 'https://badgeguard-production.up.railway.app',
    "api_key" TEXT NOT NULL,
    "device_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "push_interval_seconds" INTEGER NOT NULL DEFAULT 300,
    "last_push_at" TIMESTAMP(3),
    "last_alert_at" TIMESTAMP(3),
    "alert_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "badgeguard_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "badgeguard_integrations_site_id_key" ON "badgeguard_integrations"("site_id");

-- AddForeignKey
ALTER TABLE "badgeguard_integrations" ADD CONSTRAINT "badgeguard_integrations_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
