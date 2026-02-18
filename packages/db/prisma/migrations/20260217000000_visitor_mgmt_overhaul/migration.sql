-- CreateEnum
CREATE TYPE "VisitorType" AS ENUM ('VISITOR', 'PARENT', 'CONTRACTOR', 'VENDOR', 'VOLUNTEER', 'SUBSTITUTE_TEACHER', 'DELIVERY', 'EMERGENCY_CONTACT');

-- AlterTable: Add new columns to visitors
ALTER TABLE "visitors" ADD COLUMN "visitor_type" "VisitorType" NOT NULL DEFAULT 'VISITOR',
ADD COLUMN "email" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "signature" TEXT,
ADD COLUMN "policy_acked_at" TIMESTAMP(3),
ADD COLUMN "qr_token" TEXT,
ADD COLUMN "scheduled_at" TIMESTAMP(3),
ADD COLUMN "group_id" TEXT,
ADD COLUMN "company_name" TEXT,
ADD COLUMN "notes" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "visitors_qr_token_key" ON "visitors"("qr_token");

-- CreateTable
CREATE TABLE "visitor_policies" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visitor_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitor_groups" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT,
    "host_user_id" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visitor_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_visitor_settings" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "host_notification_enabled" BOOLEAN NOT NULL DEFAULT true,
    "auto_checkout_enabled" BOOLEAN NOT NULL DEFAULT false,
    "auto_checkout_time" TEXT NOT NULL DEFAULT '18:00',
    "require_signature" BOOLEAN NOT NULL DEFAULT false,
    "require_photo" BOOLEAN NOT NULL DEFAULT false,
    "require_policy_ack" BOOLEAN NOT NULL DEFAULT false,
    "public_pre_reg_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_visitor_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visitor_policies_site_id_is_active_idx" ON "visitor_policies"("site_id", "is_active");

-- CreateIndex
CREATE INDEX "visitor_groups_site_id_idx" ON "visitor_groups"("site_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_visitor_settings_site_id_key" ON "site_visitor_settings"("site_id");

-- AddForeignKey
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "visitor_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitor_policies" ADD CONSTRAINT "visitor_policies_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitor_groups" ADD CONSTRAINT "visitor_groups_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitor_groups" ADD CONSTRAINT "visitor_groups_host_user_id_fkey" FOREIGN KEY ("host_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_visitor_settings" ADD CONSTRAINT "site_visitor_settings_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
