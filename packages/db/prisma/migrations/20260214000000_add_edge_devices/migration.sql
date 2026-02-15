-- CreateEnum
CREATE TYPE "UpgradeStatus" AS ENUM ('IDLE', 'PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "edge_devices" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "current_version" TEXT,
    "target_version" TEXT,
    "operating_mode" TEXT,
    "pending_changes" INTEGER NOT NULL DEFAULT 0,
    "upgrade_status" "UpgradeStatus" NOT NULL DEFAULT 'IDLE',
    "upgrade_error" TEXT,
    "hostname" TEXT,
    "ip_address" TEXT,
    "node_version" TEXT,
    "disk_usage_percent" DOUBLE PRECISION,
    "memory_usage_mb" DOUBLE PRECISION,
    "last_heartbeat_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "edge_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "edge_devices_site_id_key" ON "edge_devices"("site_id");

-- CreateIndex
CREATE INDEX "edge_devices_upgrade_status_idx" ON "edge_devices"("upgrade_status");

-- AddForeignKey
ALTER TABLE "edge_devices" ADD CONSTRAINT "edge_devices_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
