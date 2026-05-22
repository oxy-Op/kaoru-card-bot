CREATE TYPE "public"."aura_intensity" AS ENUM('subtle', 'medium', 'intense');--> statement-breakpoint
CREATE TYPE "public"."card_quality" AS ENUM('damaged', 'poor', 'good', 'excellent', 'pristine');--> statement-breakpoint
CREATE TYPE "public"."cooldown_type" AS ENUM('summon', 'grab', 'daily', 'vote', 'minigame');--> statement-breakpoint
CREATE TYPE "public"."cost_type" AS ENUM('free', 'gold', 'opals', 'shards', 'cinders', 'event');--> statement-breakpoint
CREATE TYPE "public"."edition_method" AS ENUM('original', 'alternate_art', 'color_grade', 'pixel_art', 'sketch', 'negative', 'silhouette', 'cinematic', 'glitch', 'holographic', 'seasonal', 'neon', 'watercolor', 'mosaic', 'duotone', 'pop_art', 'minimal', 'retro', 'golden');--> statement-breakpoint
CREATE TYPE "public"."item_type" AS ENUM('extra_grab', 'extra_summon', 'sticker_pack', 'hex_pack', 'frame', 'card_pack', 'mystery_box');--> statement-breakpoint
CREATE TYPE "public"."rarity" AS ENUM('common', 'uncommon', 'rare', 'epic', 'legendary');--> statement-breakpoint
CREATE TYPE "public"."series_type" AS ENUM('anime', 'manga', 'game', 'cartoon', 'comic', 'webtoon', 'other');--> statement-breakpoint
CREATE TYPE "public"."source" AS ENUM('anilist', 'mal', 'kitsu', 'wiki', 'custom');--> statement-breakpoint
CREATE TYPE "public"."trade_status" AS ENUM('pending', 'completed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "achievements" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"requirement_type" text NOT NULL,
	"requirement_value" integer NOT NULL,
	"reward_type" text,
	"reward_amount" integer DEFAULT 0,
	"badge_emoji" text,
	CONSTRAINT "achievements_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb,
	"guild_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auras" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"glow_color" text NOT NULL,
	"intensity" "aura_intensity" DEFAULT 'subtle' NOT NULL,
	"is_special" boolean DEFAULT false NOT NULL,
	"pattern" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backgrounds" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"image_path" text NOT NULL,
	"rarity" text DEFAULT 'common' NOT NULL,
	"cost" integer DEFAULT 500 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_stickers" (
	"card_id" integer NOT NULL,
	"sticker_id" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "card_stickers_card_id_position_pk" PRIMARY KEY("card_id","position")
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"character_id" integer NOT NULL,
	"edition_id" integer NOT NULL,
	"print_number" integer NOT NULL,
	"quality" "card_quality" DEFAULT 'good' NOT NULL,
	"original_quality" "card_quality" DEFAULT 'good' NOT NULL,
	"owner_id" integer,
	"summoner_id" integer NOT NULL,
	"grabber_id" integer,
	"guild_id" text NOT NULL,
	"frame_id" integer,
	"hex_id" integer,
	"aura_id" integer,
	"spell" text,
	"in_fusion_pile" boolean DEFAULT false NOT NULL,
	"is_event_card" boolean DEFAULT false NOT NULL,
	"event_id" integer,
	"tag" text,
	"tag_emoji" text,
	"summoned_at" timestamp DEFAULT now() NOT NULL,
	"grabbed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cards_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "character_editions" (
	"id" serial PRIMARY KEY NOT NULL,
	"character_id" integer NOT NULL,
	"edition_number" integer NOT NULL,
	"image_path" text NOT NULL,
	"image_hash" text,
	"generation_method" "edition_method" DEFAULT 'original' NOT NULL,
	"rarity_weight" real DEFAULT 1 NOT NULL,
	"max_prints" integer,
	"current_prints" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_jp" text,
	"name_first" text,
	"name_last" text,
	"name_alt" jsonb DEFAULT '[]'::jsonb,
	"series" text NOT NULL,
	"series_jp" text,
	"series_type" "series_type" DEFAULT 'anime' NOT NULL,
	"source_id" text,
	"mal_id" integer,
	"source" "source" DEFAULT 'anilist' NOT NULL,
	"description" text,
	"gender" text,
	"age" text,
	"date_of_birth" jsonb,
	"blood_type" text,
	"popularity" integer DEFAULT 0,
	"image_url" text,
	"image_medium_url" text,
	"all_media" jsonb DEFAULT '[]'::jsonb,
	"role" text,
	"series_year" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"character_id" integer NOT NULL,
	"edition_id" integer NOT NULL,
	"drop_weight" real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"banner_url" text,
	"reward_multiplier" real DEFAULT 1.5 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frames" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"image_path" text NOT NULL,
	"cost_type" "cost_type" DEFAULT 'free' NOT NULL,
	"cost_amount" integer DEFAULT 0 NOT NULL,
	"is_rotating" boolean DEFAULT false NOT NULL,
	"available_from" timestamp,
	"available_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "frames_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "gear" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rarity" "rarity" DEFAULT 'common' NOT NULL,
	"stat_bonus" jsonb DEFAULT '{}'::jsonb,
	"owner_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"sender_id" integer NOT NULL,
	"recipient_id" integer,
	"card_id" integer NOT NULL,
	"anonymous" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" serial PRIMARY KEY NOT NULL,
	"discord_id" text NOT NULL,
	"prefix" text DEFAULT 'k!' NOT NULL,
	"summon_channel_id" text,
	"anti_snipe_seconds" integer DEFAULT 0 NOT NULL,
	"restricted_channels" jsonb DEFAULT '{}'::jsonb,
	"activity_threshold" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "guilds_discord_id_unique" UNIQUE("discord_id")
);
--> statement-breakpoint
CREATE TABLE "hexes" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color_primary" text NOT NULL,
	"color_secondary" text,
	"rarity" "rarity" DEFAULT 'common' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "like_list" (
	"user_id" integer NOT NULL,
	"character_id" integer NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "like_list_user_id_character_id_pk" PRIMARY KEY("user_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "mail" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_id" integer NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"category" text DEFAULT 'system' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pvp_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"player1_id" integer NOT NULL,
	"player2_id" integer NOT NULL,
	"winner_id" integer,
	"player1_team_id" integer,
	"player2_team_id" integer,
	"log" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quests" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"lore" text,
	"required_level" integer DEFAULT 1 NOT NULL,
	"reward_gold" integer DEFAULT 0 NOT NULL,
	"reward_shards" integer DEFAULT 0 NOT NULL,
	"reward_gear_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"item_type" "item_type" NOT NULL,
	"cost_type" "cost_type" DEFAULT 'gold' NOT NULL,
	"cost_amount" integer NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"stock_limit" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stickers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"image_path" text NOT NULL,
	"rarity" "rarity" DEFAULT 'common' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summon_list" (
	"user_id" integer NOT NULL,
	"character_id" integer NOT NULL,
	"slot_number" integer NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "summon_list_user_id_character_id_pk" PRIMARY KEY("user_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" integer NOT NULL,
	"card_id" integer NOT NULL,
	"slot" integer NOT NULL,
	"gear_id" integer,
	CONSTRAINT "team_members_team_id_slot_pk" PRIMARY KEY("team_id","slot")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"experience" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"initiator_id" integer NOT NULL,
	"receiver_id" integer NOT NULL,
	"initiator_cards" jsonb DEFAULT '[]'::jsonb,
	"receiver_cards" jsonb DEFAULT '[]'::jsonb,
	"initiator_resources" jsonb DEFAULT '{}'::jsonb,
	"receiver_resources" jsonb DEFAULT '{}'::jsonb,
	"initiator_locked" boolean DEFAULT false NOT NULL,
	"receiver_locked" boolean DEFAULT false NOT NULL,
	"status" "trade_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" integer NOT NULL,
	"achievement_id" integer NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"claimed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "user_achievements_user_id_achievement_id_pk" PRIMARY KEY("user_id","achievement_id")
);
--> statement-breakpoint
CREATE TABLE "user_auras" (
	"user_id" integer NOT NULL,
	"aura_id" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "user_auras_user_id_aura_id_pk" PRIMARY KEY("user_id","aura_id")
);
--> statement-breakpoint
CREATE TABLE "user_backgrounds" (
	"user_id" integer NOT NULL,
	"background_id" integer NOT NULL,
	"acquired_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_backgrounds_user_id_background_id_pk" PRIMARY KEY("user_id","background_id")
);
--> statement-breakpoint
CREATE TABLE "user_frames" (
	"user_id" integer NOT NULL,
	"frame_id" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "user_frames_user_id_frame_id_pk" PRIMARY KEY("user_id","frame_id")
);
--> statement-breakpoint
CREATE TABLE "user_hexes" (
	"user_id" integer NOT NULL,
	"hex_id" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "user_hexes_user_id_hex_id_pk" PRIMARY KEY("user_id","hex_id")
);
--> statement-breakpoint
CREATE TABLE "user_quests" (
	"user_id" integer NOT NULL,
	"quest_id" integer NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"progress" jsonb DEFAULT '{}'::jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "user_quests_user_id_quest_id_pk" PRIMARY KEY("user_id","quest_id")
);
--> statement-breakpoint
CREATE TABLE "user_stickers" (
	"user_id" integer NOT NULL,
	"sticker_id" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "user_stickers_user_id_sticker_id_pk" PRIMARY KEY("user_id","sticker_id")
);
--> statement-breakpoint
CREATE TABLE "user_tags" (
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_tags_user_id_name_pk" PRIMARY KEY("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"discord_id" text NOT NULL,
	"username" text NOT NULL,
	"gold" bigint DEFAULT 0 NOT NULL,
	"opals" bigint DEFAULT 0 NOT NULL,
	"cinders" bigint DEFAULT 0 NOT NULL,
	"shards" bigint DEFAULT 0 NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"total_summons" integer DEFAULT 0 NOT NULL,
	"total_grabs" integer DEFAULT 0 NOT NULL,
	"total_fusions" integer DEFAULT 0 NOT NULL,
	"total_trades" integer DEFAULT 0 NOT NULL,
	"total_gifts" integer DEFAULT 0 NOT NULL,
	"partner_id" integer,
	"profile_bg" text,
	"profile_color" text,
	"progress_bar_color" text,
	"progress_fill_color" text,
	"profile_opacity" real DEFAULT 1,
	"blurb" text,
	"profile_note" text,
	"badges" jsonb DEFAULT '[]'::jsonb,
	"active_badge" text,
	"active_background_id" integer,
	"private_fields" jsonb DEFAULT '[]'::jsonb,
	"summon_list_slots" integer DEFAULT 5 NOT NULL,
	"like_list_slots" integer DEFAULT 10 NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_discord_id_unique" UNIQUE("discord_id")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_stickers" ADD CONSTRAINT "card_stickers_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_stickers" ADD CONSTRAINT "card_stickers_sticker_id_stickers_id_fk" FOREIGN KEY ("sticker_id") REFERENCES "public"."stickers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_edition_id_character_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."character_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_summoner_id_users_id_fk" FOREIGN KEY ("summoner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_grabber_id_users_id_fk" FOREIGN KEY ("grabber_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_frame_id_frames_id_fk" FOREIGN KEY ("frame_id") REFERENCES "public"."frames"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_hex_id_hexes_id_fk" FOREIGN KEY ("hex_id") REFERENCES "public"."hexes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_aura_id_auras_id_fk" FOREIGN KEY ("aura_id") REFERENCES "public"."auras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_editions" ADD CONSTRAINT "character_editions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_cards" ADD CONSTRAINT "event_cards_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_cards" ADD CONSTRAINT "event_cards_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_cards" ADD CONSTRAINT "event_cards_edition_id_character_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."character_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gear" ADD CONSTRAINT "gear_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "like_list" ADD CONSTRAINT "like_list_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "like_list" ADD CONSTRAINT "like_list_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail" ADD CONSTRAINT "mail_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvp_matches" ADD CONSTRAINT "pvp_matches_player1_id_users_id_fk" FOREIGN KEY ("player1_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvp_matches" ADD CONSTRAINT "pvp_matches_player2_id_users_id_fk" FOREIGN KEY ("player2_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvp_matches" ADD CONSTRAINT "pvp_matches_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvp_matches" ADD CONSTRAINT "pvp_matches_player1_team_id_teams_id_fk" FOREIGN KEY ("player1_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pvp_matches" ADD CONSTRAINT "pvp_matches_player2_team_id_teams_id_fk" FOREIGN KEY ("player2_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_reward_gear_id_gear_id_fk" FOREIGN KEY ("reward_gear_id") REFERENCES "public"."gear"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summon_list" ADD CONSTRAINT "summon_list_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summon_list" ADD CONSTRAINT "summon_list_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_gear_id_gear_id_fk" FOREIGN KEY ("gear_id") REFERENCES "public"."gear"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_receiver_id_users_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_id_achievements_id_fk" FOREIGN KEY ("achievement_id") REFERENCES "public"."achievements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_auras" ADD CONSTRAINT "user_auras_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_auras" ADD CONSTRAINT "user_auras_aura_id_auras_id_fk" FOREIGN KEY ("aura_id") REFERENCES "public"."auras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_backgrounds" ADD CONSTRAINT "user_backgrounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_backgrounds" ADD CONSTRAINT "user_backgrounds_background_id_backgrounds_id_fk" FOREIGN KEY ("background_id") REFERENCES "public"."backgrounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_frames" ADD CONSTRAINT "user_frames_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_frames" ADD CONSTRAINT "user_frames_frame_id_frames_id_fk" FOREIGN KEY ("frame_id") REFERENCES "public"."frames"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_hexes" ADD CONSTRAINT "user_hexes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_hexes" ADD CONSTRAINT "user_hexes_hex_id_hexes_id_fk" FOREIGN KEY ("hex_id") REFERENCES "public"."hexes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_quests" ADD CONSTRAINT "user_quests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_quests" ADD CONSTRAINT "user_quests_quest_id_quests_id_fk" FOREIGN KEY ("quest_id") REFERENCES "public"."quests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stickers" ADD CONSTRAINT "user_stickers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stickers" ADD CONSTRAINT "user_stickers_sticker_id_stickers_id_fk" FOREIGN KEY ("sticker_id") REFERENCES "public"."stickers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tags" ADD CONSTRAINT "user_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_user" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_audit_action" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_audit_created" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_cards_owner" ON "cards" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_cards_character" ON "cards" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "idx_cards_edition" ON "cards" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "idx_cards_guild" ON "cards" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "idx_cards_owner_character" ON "cards" USING btree ("owner_id","character_id");--> statement-breakpoint
CREATE INDEX "idx_cards_print" ON "cards" USING btree ("edition_id","print_number");--> statement-breakpoint
CREATE INDEX "idx_cards_tag" ON "cards" USING btree ("owner_id","tag");--> statement-breakpoint
CREATE INDEX "idx_cards_fusion" ON "cards" USING btree ("in_fusion_pile");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_edition_unique" ON "character_editions" USING btree ("character_id","edition_number");--> statement-breakpoint
CREATE INDEX "idx_editions_character" ON "character_editions" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "idx_characters_name" ON "characters" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_characters_series" ON "characters" USING btree ("series");--> statement-breakpoint
CREATE INDEX "idx_characters_source" ON "characters" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "idx_characters_popularity" ON "characters" USING btree ("popularity");--> statement-breakpoint
CREATE INDEX "idx_characters_role" ON "characters" USING btree ("role");--> statement-breakpoint
CREATE INDEX "idx_event_cards_event" ON "event_cards" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_gifts_sender" ON "gifts" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "idx_gifts_recipient" ON "gifts" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "idx_gifts_status" ON "gifts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_guilds_discord" ON "guilds" USING btree ("discord_id");--> statement-breakpoint
CREATE INDEX "idx_like_list_user" ON "like_list" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_mail_recipient" ON "mail" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "idx_mail_read" ON "mail" USING btree ("recipient_id","read");--> statement-breakpoint
CREATE INDEX "idx_pvp_player1" ON "pvp_matches" USING btree ("player1_id");--> statement-breakpoint
CREATE INDEX "idx_pvp_player2" ON "pvp_matches" USING btree ("player2_id");--> statement-breakpoint
CREATE INDEX "idx_summon_list_user" ON "summon_list" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_teams_user" ON "teams" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_trades_initiator" ON "trades" USING btree ("initiator_id");--> statement-breakpoint
CREATE INDEX "idx_trades_receiver" ON "trades" USING btree ("receiver_id");--> statement-breakpoint
CREATE INDEX "idx_trades_status" ON "trades" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_user_achievements_user" ON "user_achievements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_tags_user" ON "user_tags" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_discord" ON "users" USING btree ("discord_id");