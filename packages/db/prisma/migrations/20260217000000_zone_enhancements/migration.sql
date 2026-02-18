-- CreateEnum
CREATE TYPE "ZoneType" AS ENUM ('PUBLIC', 'CLASSROOM', 'ADMINISTRATIVE', 'SERVICE', 'UTILITY', 'RESTRICTED', 'SECURE');

-- AlterTable: AccessZone
ALTER TABLE "access_zones" ADD COLUMN "type" "ZoneType" NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "access_zones" ADD COLUMN "is_restricted_area" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "access_zones" ADD COLUMN "requires_approval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "access_zones" ADD COLUMN "access_schedule" JSONB;

-- AlterEnum: RoomType
ALTER TYPE "RoomType" ADD VALUE 'LOADING_DOCK';
ALTER TYPE "RoomType" ADD VALUE 'MAINTENANCE';
ALTER TYPE "RoomType" ADD VALUE 'KITCHEN';
ALTER TYPE "RoomType" ADD VALUE 'MECHANICAL';
ALTER TYPE "RoomType" ADD VALUE 'STORAGE';

-- AlterTable: Visitor
ALTER TABLE "visitors" ADD COLUMN "allowed_zone_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
