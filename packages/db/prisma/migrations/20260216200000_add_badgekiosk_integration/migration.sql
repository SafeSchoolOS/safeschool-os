-- CreateTable
CREATE TABLE "badgekiosk_integrations" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "api_url" TEXT NOT NULL DEFAULT 'https://api.badgekiosk.com',
    "api_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "auto_sync" BOOLEAN NOT NULL DEFAULT true,
    "default_template_id" TEXT,
    "default_printer_id" TEXT,
    "auto_print" BOOLEAN NOT NULL DEFAULT false,
    "features" JSONB NOT NULL DEFAULT '{}',
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "badgekiosk_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "badgekiosk_integrations_site_id_key" ON "badgekiosk_integrations"("site_id");

-- AddForeignKey
ALTER TABLE "badgekiosk_integrations" ADD CONSTRAINT "badgekiosk_integrations_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
