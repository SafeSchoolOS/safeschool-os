-- Remove FK constraint from secure_messages.sender_id to responder_users
-- This allows both staff (User) and responders (ResponderUser) to send messages
-- The senderType column distinguishes the sender type

ALTER TABLE "secure_messages" DROP CONSTRAINT IF EXISTS "secure_messages_sender_id_fkey";
