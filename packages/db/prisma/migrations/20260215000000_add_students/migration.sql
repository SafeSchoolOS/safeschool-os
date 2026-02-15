-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "student_number" TEXT NOT NULL,
    "photo" TEXT,
    "grade" TEXT,
    "date_of_birth" TIMESTAMP(3),
    "building_id" TEXT,
    "room_id" TEXT,
    "enrollment_date" TIMESTAMP(3),
    "withdrawal_date" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "medical_notes" TEXT,
    "allergies" TEXT,
    "notes" TEXT,
    "external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- AlterTable: StudentCard — add nullable student_id FK
ALTER TABLE "student_cards" ADD COLUMN "student_id" TEXT;

-- AlterTable: ParentContact — add nullable student_id FK, make student_card_id nullable
ALTER TABLE "parent_contacts" ADD COLUMN "student_id" TEXT;
ALTER TABLE "parent_contacts" ALTER COLUMN "student_card_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "students_site_id_grade_idx" ON "students"("site_id", "grade");
CREATE INDEX "students_site_id_is_active_idx" ON "students"("site_id", "is_active");
CREATE UNIQUE INDEX "students_site_id_student_number_key" ON "students"("site_id", "student_number");

-- CreateIndex for new FKs
CREATE INDEX "student_cards_student_id_idx" ON "student_cards"("student_id");
CREATE INDEX "parent_contacts_student_id_idx" ON "parent_contacts"("student_id");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "students" ADD CONSTRAINT "students_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "students" ADD CONSTRAINT "students_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "student_cards" ADD CONSTRAINT "student_cards_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "parent_contacts" ADD CONSTRAINT "parent_contacts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
