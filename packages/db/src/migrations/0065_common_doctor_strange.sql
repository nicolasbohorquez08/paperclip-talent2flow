CREATE TABLE IF NOT EXISTS "agents_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"model" text DEFAULT 'gemini-1.5-pro' NOT NULL,
	"temperature" numeric(3, 2),
	"top_p" numeric(3, 2),
	"max_output_tokens" integer,
	"safety_settings" jsonb,
	"extra_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"skill_bindings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_chat_id" uuid,
	"created_by_user_id" text,
	"title" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggested_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb,
	"token_usage" jsonb DEFAULT '{"inputTokens":0,"outputTokens":0,"totalTokens":0}'::jsonb NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_chats_company_id_companies_id_fk') THEN
  ALTER TABLE "agents_chats" ADD CONSTRAINT "agents_chats_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_chats_agent_id_agents_id_fk') THEN
  ALTER TABLE "agents_chats" ADD CONSTRAINT "agents_chats_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chats_company_id_companies_id_fk') THEN
  ALTER TABLE "chats" ADD CONSTRAINT "chats_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chats_agent_id_agents_id_fk') THEN
  ALTER TABLE "chats" ADD CONSTRAINT "chats_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chats_agent_chat_id_agents_chats_id_fk') THEN
  ALTER TABLE "chats" ADD CONSTRAINT "chats_agent_chat_id_agents_chats_id_fk" FOREIGN KEY ("agent_chat_id") REFERENCES "public"."agents_chats"("id") ON DELETE set null ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agents_chats_company_agent_uniq" ON "agents_chats" USING btree ("company_id","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_chats_company_enabled_idx" ON "agents_chats" USING btree ("company_id","enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chats_company_agent_last_message_idx" ON "chats" USING btree ("company_id","agent_id","last_message_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chats_company_user_last_message_idx" ON "chats" USING btree ("company_id","created_by_user_id","last_message_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chats_company_created_at_idx" ON "chats" USING btree ("company_id","created_at");
