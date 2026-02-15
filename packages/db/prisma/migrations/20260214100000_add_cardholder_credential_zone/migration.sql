-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('STAFF', 'STUDENT', 'WORKER', 'VISITOR');

-- CreateEnum
CREATE TYPE "CredentialType" AS ENUM ('PHYSICAL_CARD', 'MOBILE', 'TEMPORARY_CARD', 'FOB');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "access_zones" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "door_zone_assignments" (
    "id" TEXT NOT NULL,
    "door_id" TEXT NOT NULL,
    "zone_id" TEXT NOT NULL,

    CONSTRAINT "door_zone_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cardholders" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "person_type" "PersonType" NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "title" TEXT,
    "user_id" TEXT,
    "visitor_id" TEXT,
    "external_id" TEXT,
    "photo" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cardholders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cardholder_credentials" (
    "id" TEXT NOT NULL,
    "cardholder_id" TEXT NOT NULL,
    "credential_type" "CredentialType" NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "card_number" TEXT,
    "facility_code" TEXT,
    "external_id" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "last_used_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cardholder_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential_zone_assignments" (
    "id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "zone_id" TEXT NOT NULL,

    CONSTRAINT "credential_zone_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_zones_site_id_idx" ON "access_zones"("site_id");

-- CreateIndex
CREATE UNIQUE INDEX "access_zones_site_id_name_key" ON "access_zones"("site_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "door_zone_assignments_door_id_zone_id_key" ON "door_zone_assignments"("door_id", "zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "cardholders_user_id_key" ON "cardholders"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "cardholders_visitor_id_key" ON "cardholders"("visitor_id");

-- CreateIndex
CREATE INDEX "cardholders_site_id_person_type_idx" ON "cardholders"("site_id", "person_type");

-- CreateIndex
CREATE INDEX "cardholders_site_id_is_active_idx" ON "cardholders"("site_id", "is_active");

-- CreateIndex
CREATE INDEX "cardholder_credentials_cardholder_id_idx" ON "cardholder_credentials"("cardholder_id");

-- CreateIndex
CREATE INDEX "cardholder_credentials_status_idx" ON "cardholder_credentials"("status");

-- CreateIndex
CREATE UNIQUE INDEX "credential_zone_assignments_credential_id_zone_id_key" ON "credential_zone_assignments"("credential_id", "zone_id");

-- AddForeignKey
ALTER TABLE "access_zones" ADD CONSTRAINT "access_zones_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "door_zone_assignments" ADD CONSTRAINT "door_zone_assignments_door_id_fkey" FOREIGN KEY ("door_id") REFERENCES "doors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "door_zone_assignments" ADD CONSTRAINT "door_zone_assignments_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "access_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cardholders" ADD CONSTRAINT "cardholders_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cardholders" ADD CONSTRAINT "cardholders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cardholders" ADD CONSTRAINT "cardholders_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "visitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cardholder_credentials" ADD CONSTRAINT "cardholder_credentials_cardholder_id_fkey" FOREIGN KEY ("cardholder_id") REFERENCES "cardholders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_zone_assignments" ADD CONSTRAINT "credential_zone_assignments_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "cardholder_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_zone_assignments" ADD CONSTRAINT "credential_zone_assignments_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "access_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
