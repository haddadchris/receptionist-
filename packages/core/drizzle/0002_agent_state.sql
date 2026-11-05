ALTER TABLE "conversations" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "processing_until" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_inbound_provider_id_unique" ON "messages" USING btree ("business_id","provider_message_id") WHERE direction = 'inbound' and provider_message_id is not null;