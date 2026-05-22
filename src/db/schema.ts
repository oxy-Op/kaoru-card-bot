import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
  jsonb,
  real,
  primaryKey,
} from "drizzle-orm/pg-core";

// ─── Enums ───────────────────────────────────────────────

export const seriesTypeEnum = pgEnum("series_type", [
  "anime",
  "manga",
  "game",
  "cartoon",
  "comic",
  "webtoon",
  "other",
]);

export const sourceEnum = pgEnum("source", [
  "anilist",
  "mal",
  "kitsu",
  "wiki",
  "custom",
]);

export const editionMethodEnum = pgEnum("edition_method", [
  "original",
  "alternate_art",
  "color_grade",
  "pixel_art",
  "sketch",
  "negative",
  "silhouette",
  "cinematic",
  "glitch",
  "holographic",
  "seasonal",
  "neon",
  "watercolor",
  "mosaic",
  "duotone",
  "pop_art",
  "minimal",
  "retro",
  "golden",
]);

export const cardQualityEnum = pgEnum("card_quality", [
  "damaged",
  "poor",
  "good",
  "excellent",
  "pristine",
]);

export const cooldownTypeEnum = pgEnum("cooldown_type", [
  "summon",
  "grab",
  "daily",
  "vote",
  "minigame",
]);

export const costTypeEnum = pgEnum("cost_type", [
  "free",
  "gold",
  "opals",
  "roses",
  "shards",
  "cinders",
  "event",
]);

export const itemTypeEnum = pgEnum("item_type", [
  "extra_grab",
  "extra_summon",
  "sticker_pack",
  "hex_pack",
  "frame",
  "card_pack",
  "mystery_box",
]);

export const tradeStatusEnum = pgEnum("trade_status", [
  "pending",
  "completed",
  "cancelled",
  "expired",
]);

export const rarityEnum = pgEnum("rarity", [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
]);

export const auraIntensityEnum = pgEnum("aura_intensity", [
  "subtle",
  "medium",
  "intense",
]);

// ─── Characters & Editions ───────────────────────────────

export const characters = pgTable(
  "characters",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    nameJp: text("name_jp"),
    nameFirst: text("name_first"),
    nameLast: text("name_last"),
    nameAlt: jsonb("name_alt").$type<string[]>().default([]), // alternative/spoiler names
    series: text("series").notNull(),
    seriesJp: text("series_jp"), // romaji title
    seriesType: seriesTypeEnum("series_type").notNull().default("anime"),
    sourceId: text("source_id"),
    malId: integer("mal_id"),
    source: sourceEnum("source").notNull().default("anilist"),
    description: text("description"),
    gender: text("gender"),
    age: text("age"),
    dateOfBirth: jsonb("date_of_birth").$type<{ month?: number; day?: number; year?: number }>(),
    bloodType: text("blood_type"),
    popularity: integer("popularity").default(0), // favourites count from source
    imageUrl: text("image_url"),
    imageMediumUrl: text("image_medium_url"),
    // All media this character appears in (for lookup/filtering)
    allMedia: jsonb("all_media").$type<Array<{
      id: number;
      title: string;
      titleJp: string | null;
      type: string;
      role: string; // MAIN, SUPPORTING, BACKGROUND
    }>>().default([]),
    // Primary role in primary media — used for rarity
    role: text("role"), // MAIN, SUPPORTING, BACKGROUND
    seriesYear: integer("series_year"), // cached from series_meta for fast summon weighting
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_characters_name").on(t.name),
    index("idx_characters_series").on(t.series),
    index("idx_characters_source").on(t.source, t.sourceId),
    index("idx_characters_popularity").on(t.popularity),
    index("idx_characters_role").on(t.role),
  ]
);

export const characterEditions = pgTable(
  "character_editions",
  {
    id: serial("id").primaryKey(),
    characterId: integer("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    editionNumber: integer("edition_number").notNull(),
    imagePath: text("image_path").notNull(), // local/S3 path to processed image
    imageHash: text("image_hash"), // for dedup
    generationMethod: editionMethodEnum("generation_method")
      .notNull()
      .default("original"),
    rarityWeight: real("rarity_weight").notNull().default(1.0), // higher = more common
    maxPrints: integer("max_prints"), // null = unlimited
    currentPrints: integer("current_prints").notNull().default(0),
    summonable: boolean("summonable").notNull().default(true),
    artistName: text("artist_name"),
    artistUrl: text("artist_url"),
    sourceUrl: text("source_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("idx_edition_unique").on(t.characterId, t.editionNumber),
    index("idx_editions_character").on(t.characterId),
  ]
);

// ─── Cards (Instances) ──────────────────────────────────

export const cards = pgTable(
  "cards",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(), // e.g. "aK7x2Q"
    characterId: integer("character_id")
      .notNull()
      .references(() => characters.id),
    editionId: integer("edition_id")
      .notNull()
      .references(() => characterEditions.id),
    printNumber: integer("print_number").notNull(),
    quality: cardQualityEnum("quality").notNull().default("good"),
    originalQuality: cardQualityEnum("original_quality").notNull().default("good"),

    // Ownership
    ownerId: integer("owner_id").references(() => users.id),
    summonerId: integer("summoner_id")
      .notNull()
      .references(() => users.id),
    grabberId: integer("grabber_id").references(() => users.id),
    guildId: text("guild_id").notNull(), // Discord guild where summoned

    // Cosmetics applied
    frameId: integer("frame_id").references(() => frames.id),
    hexId: integer("hex_id").references(() => hexes.id),
    auraId: integer("aura_id").references(() => auras.id),
    spell: text("spell"), // text effect (glow, shadow, rainbow, etc.)

    // Card RPG stats
    cardLevel: integer("card_level").notNull().default(1),
    cardXp: integer("card_xp").notNull().default(0),
    statAtk: integer("stat_atk").notNull().default(0),
    statDef: integer("stat_def").notNull().default(0),
    statSpd: integer("stat_spd").notNull().default(0),
    statHp: integer("stat_hp").notNull().default(0),
    statLuk: integer("stat_luk").notNull().default(0),
    unspentPoints: integer("unspent_points").notNull().default(0),

    // State
    inFusionPile: boolean("in_fusion_pile").notNull().default(false),
    isEventCard: boolean("is_event_card").notNull().default(false),
    eventId: integer("event_id"),
    tag: text("tag"),
    tagEmoji: text("tag_emoji"),

    // Timestamps
    summonedAt: timestamp("summoned_at").defaultNow().notNull(),
    grabbedAt: timestamp("grabbed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_cards_owner").on(t.ownerId),
    index("idx_cards_character").on(t.characterId),
    index("idx_cards_edition").on(t.editionId),
    index("idx_cards_guild").on(t.guildId),
    index("idx_cards_owner_character").on(t.ownerId, t.characterId),
    index("idx_cards_print").on(t.editionId, t.printNumber),
    index("idx_cards_tag").on(t.ownerId, t.tag),
    index("idx_cards_fusion").on(t.inFusionPile),
  ]
);

// ─── Users ──────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    discordId: text("discord_id").notNull().unique(),
    username: text("username").notNull(),

    // Economy
    gold: bigint("gold", { mode: "number" }).notNull().default(0),
    opals: bigint("opals", { mode: "number" }).notNull().default(0),
    roses: bigint("roses", { mode: "number" }).notNull().default(0),
    cinders: bigint("cinders", { mode: "number" }).notNull().default(0),
    shards: bigint("shards", { mode: "number" }).notNull().default(0),

    // Level
    xp: integer("xp").notNull().default(0),
    level: integer("level").notNull().default(1),

    // Stats
    totalSummons: integer("total_summons").notNull().default(0),
    totalGrabs: integer("total_grabs").notNull().default(0),
    totalFusions: integer("total_fusions").notNull().default(0),
    totalTrades: integer("total_trades").notNull().default(0),
    totalGifts: integer("total_gifts").notNull().default(0),

    // Social
    partnerId: integer("partner_id"), // self-referencing FK handled at app level

    // Profile customization
    profileBg: text("profile_bg"),
    profileColor: text("profile_color"),
    progressBarColor: text("progress_bar_color"),
    progressFillColor: text("progress_fill_color"),
    profileOpacity: real("profile_opacity").default(1.0),
    blurb: text("blurb"),
    profileNote: text("profile_note"),
    badges: jsonb("badges").$type<string[]>().default([]),
    activeBadge: text("active_badge"),
    activeBackgroundId: integer("active_background_id"),
    privateFields: jsonb("private_fields").$type<string[]>().default([]),

    // Slots (upgradeable)
    summonListSlots: integer("summon_list_slots").notNull().default(5),
    likeListSlots: integer("like_list_slots").notNull().default(10),

    // Active wish boost (targeted summon assist)
    wishCharacterId: integer("wish_character_id"),
    wishSummonsRemaining: integer("wish_summons_remaining").notNull().default(0),
    // Low-print pity streak: increments when a summon has no low-print hit.
    lowPrintPityStreak: integer("low_print_pity_streak").notNull().default(0),

    // Favorite card
    favoriteCardId: integer("favorite_card_id"),

    // Albums
    maxAlbums: integer("max_albums").notNull().default(2),
    maxAlbumPages: integer("max_album_pages").notNull().default(5),

    joinedAt: timestamp("joined_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("idx_users_discord").on(t.discordId),
    index("idx_users_wish_character").on(t.wishCharacterId),
  ]
);

// ─── Guild Config ───────────────────────────────────────

export const guilds = pgTable(
  "guilds",
  {
    id: serial("id").primaryKey(),
    discordId: text("discord_id").notNull().unique(),
    prefix: text("prefix").notNull().default("k!"),
    summonChannelId: text("summon_channel_id"),
    antiSnipeSeconds: integer("anti_snipe_seconds").notNull().default(0),
    restrictedChannels: jsonb("restricted_channels")
      .$type<Record<string, string[]>>()
      .default({}),
    activityThreshold: integer("activity_threshold").notNull().default(5),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("idx_guilds_discord").on(t.discordId),
  ]
);

// ─── Cosmetics ──────────────────────────────────────────

export const frames = pgTable("frames", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  imagePath: text("image_path").notNull(),
  costType: costTypeEnum("cost_type").notNull().default("free"),
  costAmount: integer("cost_amount").notNull().default(0),
  isRotating: boolean("is_rotating").notNull().default(false),
  availableFrom: timestamp("available_from"),
  availableUntil: timestamp("available_until"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const hexes = pgTable("hexes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  colorPrimary: text("color_primary").notNull(),
  colorSecondary: text("color_secondary"),
  rarity: rarityEnum("rarity").notNull().default("common"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const auras = pgTable("auras", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  glowColor: text("glow_color").notNull(),
  intensity: auraIntensityEnum("intensity").notNull().default("subtle"),
  isSpecial: boolean("is_special").notNull().default(false),
  pattern: jsonb("pattern"), // multi-color/animated pattern definition
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const stickers = pgTable("stickers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  imagePath: text("image_path").notNull(),
  rarity: rarityEnum("rarity").notNull().default("common"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── User Inventories (Cosmetics) ───────────────────────

export const userHexes = pgTable(
  "user_hexes",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hexId: integer("hex_id")
      .notNull()
      .references(() => hexes.id),
    quantity: integer("quantity").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.userId, t.hexId] })]
);

export const userAuras = pgTable(
  "user_auras",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    auraId: integer("aura_id")
      .notNull()
      .references(() => auras.id),
    quantity: integer("quantity").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.userId, t.auraId] })]
);

export const userStickers = pgTable(
  "user_stickers",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stickerId: integer("sticker_id")
      .notNull()
      .references(() => stickers.id),
    quantity: integer("quantity").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.userId, t.stickerId] })]
);

export const userFrames = pgTable(
  "user_frames",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    frameId: integer("frame_id")
      .notNull()
      .references(() => frames.id),
    quantity: integer("quantity").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.userId, t.frameId] })]
);

// ─── Card Stickers (Placed on Cards) ────────────────────

export const cardStickers = pgTable(
  "card_stickers",
  {
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    stickerId: integer("sticker_id")
      .notNull()
      .references(() => stickers.id),
    position: integer("position").notNull(), // 1-19
  },
  (t) => [primaryKey({ columns: [t.cardId, t.position] })]
);

// ─── Lists (Summon Wishlist + Like List) ─────────────────

export const summonList = pgTable(
  "summon_list",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    characterId: integer("character_id")
      .notNull()
      .references(() => characters.id),
    slotNumber: integer("slot_number").notNull(),
    addedAt: timestamp("added_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.characterId] }),
    index("idx_summon_list_user").on(t.userId),
  ]
);

export const likeList = pgTable(
  "like_list",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    characterId: integer("character_id")
      .notNull()
      .references(() => characters.id),
    addedAt: timestamp("added_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.characterId] }),
    index("idx_like_list_user").on(t.userId),
  ]
);

// ─── User Tags (Tag Registry) ───────────────────────────

export const userTags = pgTable(
  "user_tags",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.name] }),
    index("idx_user_tags_user").on(t.userId),
  ]
);

// ─── Gifts ──────────────────────────────────────────────

export const gifts = pgTable(
  "gifts",
  {
    id: serial("id").primaryKey(),
    senderId: integer("sender_id")
      .notNull()
      .references(() => users.id),
    recipientId: integer("recipient_id")
      .references(() => users.id),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id),
    anonymous: boolean("anonymous").notNull().default(false),
    status: text("status").notNull().default("pending"), // pending, accepted, declined, expired
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => [
    index("idx_gifts_sender").on(t.senderId),
    index("idx_gifts_recipient").on(t.recipientId),
    index("idx_gifts_status").on(t.status),
  ]
);

// ─── Trading ────────────────────────────────────────────

export const trades = pgTable(
  "trades",
  {
    id: serial("id").primaryKey(),
    initiatorId: integer("initiator_id")
      .notNull()
      .references(() => users.id),
    receiverId: integer("receiver_id")
      .notNull()
      .references(() => users.id),

    // What each side is offering
    initiatorCards: jsonb("initiator_cards").$type<string[]>().default([]),
    receiverCards: jsonb("receiver_cards").$type<string[]>().default([]),
    initiatorResources: jsonb("initiator_resources")
      .$type<Record<string, number>>()
      .default({}),
    receiverResources: jsonb("receiver_resources")
      .$type<Record<string, number>>()
      .default({}),

    // Lock/confirm state
    initiatorLocked: boolean("initiator_locked").notNull().default(false),
    receiverLocked: boolean("receiver_locked").notNull().default(false),

    status: tradeStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("idx_trades_initiator").on(t.initiatorId),
    index("idx_trades_receiver").on(t.receiverId),
    index("idx_trades_status").on(t.status),
  ]
);

// ─── Bounties ────────────────────────────────────────────

export const bounties = pgTable(
  "bounties",
  {
    id: serial("id").primaryKey(),
    requesterId: integer("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    characterId: integer("character_id")
      .notNull()
      .references(() => characters.id),
    goldAmount: bigint("gold_amount", { mode: "number" }).notNull(),
    status: text("status").notNull().default("active"), // active, fulfilled, cancelled, expired
    fulfilledByUserId: integer("fulfilled_by_user_id").references(() => users.id),
    fulfilledCardId: integer("fulfilled_card_id").references(() => cards.id),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_bounties_status").on(t.status),
    index("idx_bounties_requester").on(t.requesterId),
    index("idx_bounties_character").on(t.characterId),
    index("idx_bounties_expires").on(t.expiresAt),
  ]
);

// ─── Auctions ────────────────────────────────────────────

export const auctions = pgTable(
  "auctions",
  {
    id: serial("id").primaryKey(),
    sellerId: integer("seller_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    startingBid: bigint("starting_bid", { mode: "number" }).notNull(),
    currentBid: bigint("current_bid", { mode: "number" }),
    currentBidderId: integer("current_bidder_id").references(() => users.id),
    status: text("status").notNull().default("active"), // active, settled, cancelled, expired
    endsAt: timestamp("ends_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_auctions_status").on(t.status),
    index("idx_auctions_seller").on(t.sellerId),
    index("idx_auctions_card").on(t.cardId),
    index("idx_auctions_ends").on(t.endsAt),
  ]
);

// ─── Petals Ledger ───────────────────────────────────────

export const petalTransactions = pgTable(
  "petal_transactions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Signed amount: positive=credit, negative=debit.
    amount: bigint("amount", { mode: "number" }).notNull(),
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    direction: text("direction").notNull(), // credit, debit
    reason: text("reason").notNull(), // purchase, reward, admin_grant, refund, etc.
    source: text("source").notNull().default("internal"), // internal, webhook, admin, etc.
    idempotencyKey: text("idempotency_key").notNull().unique(),
    externalRef: text("external_ref"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_petal_transactions_user").on(t.userId),
    index("idx_petal_transactions_created").on(t.createdAt),
    index("idx_petal_transactions_reason").on(t.reason),
  ]
);

// ─── Fusion Pile ─────────────────────────────────────────

export const fusionPileEntries = pgTable(
  "fusion_pile_entries",
  {
    id: serial("id").primaryKey(),
    characterId: integer("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    editionId: integer("edition_id")
      .notNull()
      .references(() => characterEditions.id, { onDelete: "cascade" }),
    sourceCardId: integer("source_card_id").references(() => cards.id, { onDelete: "set null" }),
    sourceUserId: integer("source_user_id").references(() => users.id, { onDelete: "set null" }),
    source: text("source").notNull().default("fusion"), // fusion, admin_seed, event
    status: text("status").notNull().default("available"), // available, claimed, retired
    claimedByUserId: integer("claimed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    claimedCardId: integer("claimed_card_id").references(() => cards.id, { onDelete: "set null" }),
    claimSummonId: text("claim_summon_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    claimedAt: timestamp("claimed_at"),
  },
  (t) => [
    index("idx_fusion_pile_status").on(t.status),
    index("idx_fusion_pile_created").on(t.createdAt),
    index("idx_fusion_pile_claimed_user").on(t.claimedByUserId),
    index("idx_fusion_pile_character").on(t.characterId),
  ]
);

// ─── Shop ───────────────────────────────────────────────

export const shopItems = pgTable("shop_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  itemType: itemTypeEnum("item_type").notNull(),
  costType: costTypeEnum("cost_type").notNull().default("gold"),
  costAmount: integer("cost_amount").notNull(),
  isAvailable: boolean("is_available").notNull().default(true),
  stockLimit: integer("stock_limit"), // null = unlimited
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── RPG: Teams, Gear, Quests ───────────────────────────

export const teams = pgTable(
  "teams",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    level: integer("level").notNull().default(1),
    experience: integer("experience").notNull().default(0),
    slotsUnlocked: integer("slots_unlocked").notNull().default(2), // start with 2 of 4 slots
    status: text("status").notNull().default("home"), // home, questing
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("idx_teams_user").on(t.userId)]
);

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id),
    slot: integer("slot").notNull(), // 1-5
    gearId: integer("gear_id").references(() => gear.id),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.slot] })]
);

export const gear = pgTable("gear", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  rarity: rarityEnum("rarity").notNull().default("common"),
  statBonus: jsonb("stat_bonus").$type<Record<string, number>>().default({}),
  ownerId: integer("owner_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const quests = pgTable("quests", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  lore: text("lore"),
  location: text("location").notNull().default("Unknown"),
  difficulty: text("difficulty").notNull().default("easy"), // easy, medium, hard
  requiredLevel: integer("required_level").notNull().default(1),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  recommendedStats: jsonb("recommended_stats").$type<Record<string, number>>().default({}),
  favoredStat: text("favored_stat"), // atk, def, spd, hp, luk
  rewardGold: integer("reward_gold").notNull().default(0),
  rewardShards: integer("reward_shards").notNull().default(0),
  rewardCinders: integer("reward_cinders").notNull().default(0),
  rewardGearId: integer("reward_gear_id").references(() => gear.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userQuests = pgTable(
  "user_quests",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questId: integer("quest_id")
      .notNull()
      .references(() => quests.id),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id),
    status: text("status").notNull().default("active"), // active, completed, failed, cancelled
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    endsAt: timestamp("ends_at").notNull(),
    successChance: real("success_chance").notNull().default(0.5),
    firstClear: boolean("first_clear").notNull().default(false),
  },
  (t) => [
    index("idx_user_quests_user").on(t.userId),
    index("idx_user_quests_team").on(t.teamId),
  ]
);

// ─── PVP ────────────────────────────────────────────────

export const pvpMatches = pgTable(
  "pvp_matches",
  {
    id: serial("id").primaryKey(),
    player1Id: integer("player1_id")
      .notNull()
      .references(() => users.id),
    player2Id: integer("player2_id")
      .notNull()
      .references(() => users.id),
    winnerId: integer("winner_id").references(() => users.id),
    player1TeamId: integer("player1_team_id").references(() => teams.id),
    player2TeamId: integer("player2_team_id").references(() => teams.id),
    log: jsonb("log").$type<object[]>().default([]), // battle log
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_pvp_player1").on(t.player1Id),
    index("idx_pvp_player2").on(t.player2Id),
  ]
);

// ─── Events ─────────────────────────────────────────────

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  bannerUrl: text("banner_url"),
  rewardMultiplier: real("reward_multiplier").notNull().default(1.5),
  active: boolean("active").notNull().default(false),
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const eventCards = pgTable(
  "event_cards",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    characterId: integer("character_id").notNull().references(() => characters.id),
    editionId: integer("edition_id").notNull().references(() => characterEditions.id),
    dropWeight: real("drop_weight").notNull().default(1.0),
  },
  (t) => [
    index("idx_event_cards_event").on(t.eventId),
  ]
);

// ─── Backgrounds ────────────────────────────────────────

export const backgrounds = pgTable("backgrounds", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  imagePath: text("image_path").notNull(),
  rarity: text("rarity").notNull().default("common"),
  cost: integer("cost").notNull().default(500),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userBackgrounds = pgTable(
  "user_backgrounds",
  {
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    backgroundId: integer("background_id").notNull().references(() => backgrounds.id),
    acquiredAt: timestamp("acquired_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.backgroundId] }),
  ]
);

// ─── Achievements ───────────────────────────────────────

export const achievements = pgTable("achievements", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(), // 'summon', 'grab', 'trade', 'fusion', 'social', 'collection'
  requirementType: text("requirement_type").notNull(), // 'total_summons', 'total_grabs', etc.
  requirementValue: integer("requirement_value").notNull(),
  rewardType: text("reward_type"), // 'gold', 'shards', 'cinders', 'badge'
  rewardAmount: integer("reward_amount").default(0),
  badgeEmoji: text("badge_emoji"),
});

export const userAchievements = pgTable(
  "user_achievements",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    achievementId: integer("achievement_id")
      .notNull()
      .references(() => achievements.id),
    progress: integer("progress").notNull().default(0),
    completed: boolean("completed").notNull().default(false),
    claimed: boolean("claimed").notNull().default(false),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.achievementId] }),
    index("idx_user_achievements_user").on(t.userId),
  ]
);

// ─── Audit Log (for anti-cheat and support) ─────────────

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id),
    action: text("action").notNull(), // "summon", "grab", "trade", "fuse", etc.
    details: jsonb("details").$type<Record<string, unknown>>().default({}),
    guildId: text("guild_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_audit_user").on(t.userId),
    index("idx_audit_action").on(t.action),
    index("idx_audit_created").on(t.createdAt),
  ]
);

// ─── Mail / Inbox ────────────────────────────────────────

export const mail = pgTable(
  "mail",
  {
    id: serial("id").primaryKey(),
    recipientId: integer("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    read: boolean("read").notNull().default(false),
    category: text("category").notNull().default("system"), // system, gift, trade, event, achievement
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
  },
  (t) => [
    index("idx_mail_recipient").on(t.recipientId),
    index("idx_mail_read").on(t.recipientId, t.read),
  ]
);

// ─── Admin Users (Web Panel) ────────────────────────────

export const adminUsers = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  discordId: text("discord_id").notNull().unique(),
  username: text("username").notNull(),
  role: text("role").notNull().default("viewer"),
  addedBy: text("added_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Pending Editions (Image Curation) ──────────────────

export const pendingEditions = pgTable(
  "pending_editions",
  {
    id: serial("id").primaryKey(),
    characterId: integer("character_id")
      .notNull()
      .references(() => characters.id),
    imageUrl: text("image_url").notNull(),
    imagePath: text("image_path"),
    source: text("source").notNull(),
    sourceUrl: text("source_url"),
    artistName: text("artist_name"),
    artistUrl: text("artist_url"),
    status: text("status").notNull().default("pending"),
    reviewedBy: integer("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at"),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_pending_status").on(t.status),
    index("idx_pending_character").on(t.characterId),
  ]
);

// ─── Albums ─────────────────────────────────────────────

export const albums = pgTable(
  "albums",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    defaultBackgroundId: integer("default_background_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_albums_user").on(t.userId),
  ]
);

export const albumPages = pgTable(
  "album_pages",
  {
    id: serial("id").primaryKey(),
    albumId: integer("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    backgroundId: integer("background_id"),
  },
  (t) => [
    index("idx_album_pages_album").on(t.albumId),
  ]
);

export const albumCards = pgTable(
  "album_cards",
  {
    id: serial("id").primaryKey(),
    pageId: integer("page_id")
      .notNull()
      .references(() => albumPages.id, { onDelete: "cascade" }),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id),
    position: real("position").notNull(), // 1-8, decimals allowed for ordering
  },
  (t) => [
    index("idx_album_cards_page").on(t.pageId),
  ]
);
