-- AlterTable: Add floor plan position fields to rooms
ALTER TABLE "rooms" ADD COLUMN "map_x" DOUBLE PRECISION;
ALTER TABLE "rooms" ADD COLUMN "map_y" DOUBLE PRECISION;
ALTER TABLE "rooms" ADD COLUMN "map_w" DOUBLE PRECISION;
ALTER TABLE "rooms" ADD COLUMN "map_h" DOUBLE PRECISION;

-- AlterTable: Add floor plan position fields to doors
ALTER TABLE "doors" ADD COLUMN "map_x" DOUBLE PRECISION;
ALTER TABLE "doors" ADD COLUMN "map_y" DOUBLE PRECISION;
