-- CreateTable
CREATE TABLE "escalation_rules" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alert_level" TEXT NOT NULL,
    "delay_minutes" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "target_roles" TEXT[],
    "target_level" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "escalation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "escalation_rules_site_id_alert_level_idx" ON "escalation_rules"("site_id", "alert_level");

-- AddForeignKey
ALTER TABLE "escalation_rules" ADD CONSTRAINT "escalation_rules_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
