-- Add status and review fields to demo_requests
ALTER TABLE "demo_requests" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "demo_requests" ADD COLUMN "reviewed_by" TEXT;
ALTER TABLE "demo_requests" ADD COLUMN "reviewed_at" TIMESTAMP(3);
ALTER TABLE "demo_requests" ADD COLUMN "notes" TEXT;
