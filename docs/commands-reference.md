# Kaoru Bot — Command Reference

71 commands across 10 categories. Default prefix: `ka!`

---

## Play (Core)

| Command | Prefix | Description |
|---------|--------|-------------|
| `/summon` | `ka!s` | Summon 3 cards (2 revealed + 1 mystery). Cooldown-gated. |
| `/view [code]` | `ka!v` | View a card image. No args = your last grabbed card. |
| `/collection [page]` | `ka!c` | Browse your card collection with pagination. |
| `/lookup <name>` | `ka!lu` | Search characters by name or series. Supports `s:` and `c:` filters. |
| `/cardinfo <code>` | `ka!ci` | Detailed card info (quality, owner, summoner, tag, print). |
| `/cooldown` | `ka!cd` | Check all your active cooldown timers. |
| `/tag <code> [text]` | `ka!tag` | Tag a card with custom text. Empty text removes the tag. |
| `/leaderboard [type]` | `ka!lb` | Global rankings: grabs, summons, gold, fusions, trades. |
| `/wish` | `ka!wish` | Manage wishlist (likes) and summon list. Wishlist adds consume popularity-scaled gold. |
| `/event` | `ka!event` | View current seasonal event metadata (full summon/event-card wiring is optional by host). |
| `/achievements` | `ka!ach` | View/claim achievements with progress bars. |
| `/completeachievement` | `ka!ca` | Claim a completed achievement's reward. |
| `/alarm` | — | Set DM reminders for cooldown expiry. **New** |

### Alarm Subcommands
- `/alarm show` — View which alarms are enabled
- `/alarm set <type>` — Enable alarm for summon/grab/daily/vote/minigame
- `/alarm off <type>` — Disable a specific alarm
- `/alarm all` — Enable all alarms
- `/alarm clear` — Disable all alarms

When a cooldown expires, the bot DMs you "{Type} cooldown is ready!" Alarms persist across sessions via Redis.

---

## Economy

| Command | Prefix | Description |
|---------|--------|-------------|
| `/daily` | `ka!daily` | Claim daily gold (1-100). 20h cooldown. |
| `/balance` | `ka!bal` | Check gold, petals, cinders, shards. |
| `/give <@user> <code>` | `ka!give` | Give a card to another player. |
| `/trade <@user> <code> <code>` | `ka!trade` | Quick 1:1 card trade. |
| `/multitrade <@user>` | — | Interactive multi-card trade with lock/confirm flow. |
| `/upgrade <code>` | `ka!upgrade` | Upgrade card quality using Cinders. |
| `/shop` | `ka!shop` | View the shop and prices. |
| `/buy <item> [qty]` | `ka!buy` | Purchase items from the shop. **New** |
| `/vote` | — | Vote rewards command (host must enable verified vote rewards). |
| `/givecosmetic` | `ka!gc` | Gift a cosmetic item to another player. |
| `/openpack <type>` | `ka!pack` | Open a card pack (Standard/Premium/Legendary). |
| `/burn <code>` | `ka!burn` | Destroy a card for cinders. |
| `/bounty` | `ka!bounty` | Post/list/claim/cancel character bounties with gold escrow. |

### Buy Details
- `/buy <name or id>` — Fuzzy matches shop item names or exact ID
- `/buy <item> quantity:3` — Buy multiple (max 10)
- Handles all item types: extra grabs, extra summons, packs, frames, mystery boxes
- Mystery boxes give random gold (50-200) or a random cosmetic

---

## Fusion

| Command | Prefix | Description |
|---------|--------|-------------|
| `/fusionboard` | `ka!fb` | View your fusion board. |
| `/fuseadd <codes>` | `ka!fa` | Add cards to your fusion pile. Comma or space separated. |
| `/fuse` | `ka!f` | Fuse all cards on your board. Earns gold + cinders. |
| `/fastfuse <codes>` | `ka!ff` | Add cards and immediately fuse in one command. |

---

## Tags

| Command | Prefix | Description |
|---------|--------|-------------|
| `/tagadd <name> <emoji>` | `ka!ta` | Create a named tag with an emoji. |
| `/tagremove <name>` | `ka!tr` | Delete a tag (removes from all cards). |
| `/tagrename <old> <new>` | — | Rename an existing tag. |
| `/tagreemote <name> <emoji>` | — | Change a tag's emoji. |
| `/untag <code>` | `ka!ut` | Remove tag from a specific card. |
| `/taglist` | `ka!tl` | List all your tags with card counts. |

---

## Cosmetics

| Command | Prefix | Description |
|---------|--------|-------------|
| `/use <type> <id> <card>` | `ka!use` | Apply a frame, hex, or aura to a card. |
| `/removehex <card>` | — | Remove hex from card, return to inventory. **New** |
| `/removeaura <card>` | — | Remove aura from card, return to inventory. **New** |
| `/removeframe <card>` | — | Remove frame from card, return to inventory. **New** |
| `/stick <code> <pos> [id]` | `ka!stick` | Place or remove stickers on cards (positions 1-19). |
| `/open <type>` | `ka!open` | Open a cosmetic pack (hex or sticker). |
| `/cosmetics` | — | View your cosmetic inventory. |
| `/spell` | — | Apply/remove text effects on cards (costs shards). |

---

## Profile

| Command | Prefix | Description |
|---------|--------|-------------|
| `/profile [@user]` | `ka!p` | View your or another player's profile. |
| `/blurb <text>` | `ka!blurb` | Set your profile blurb (max 200 chars). |
| `/profileset` | — | Customize profile colors and display. |
| `/background` | `ka!bg` | Buy and equip profile backgrounds. |

---

## Social

| Command | Prefix | Description |
|---------|--------|-------------|
| `/partner <@user>` | — | Propose a partnership. |
| `/divorce` | — | End your current partnership. |
| `/giftcard <@user> <code>` | `ka!gift` | Gift a card with optional anonymity. |
| `/gifts` | — | View your pending gifts (accept/decline). |
| `/mail` | `ka!mail` | Check your inbox. **New** |

### Mail Subcommands
- `/mail inbox [page]` — Paginated inbox with unread count
- `/mail read <id>` — Read a specific message
- `/mail clear` — Mark all messages as read
- `/mail delete <id>` — Delete a message

Mail inbox tooling is implemented. Producers are deployment-specific and can be wired by host features (gifts/system/admin jobs). Messages auto-expire after 30 days.

---

## Player Info

| Command | Prefix | Description |
|---------|--------|-------------|
| `/inventory` | `ka!i` | View your currency balances. |
| `/userinfo` | `ka!ui` | View your stats (level, XP, summons, grabs, etc). |
| `/seriesmatch` | `ka!sm` | Find users who collect the same series as you. |
| `/content` | — | View recent summons in this server. |
| `/private` | `ka!pr` | Toggle privacy on profile fields. |
| `/badges` | `ka!b` | View and set your active badge. |
| `/likematch` | `ka!lm` | Find users with similar wishlists. |

---

## Minigames

| Command | Prefix | Description |
|---------|--------|-------------|
| `/trivia` | — | Anime trivia with timed multiple-choice. |
| `/guess` | `ka!mg1` | Guess the character from a blurred image. |
| `/rps` | `ka!mg3` | Rock-Paper-Scissors for gold. |
| `/fish` | `ka!mg4` | Fishing minigame — catch fish for gold and rare items. |

All minigames share a 5-minute cooldown.

---

## Settings (Server Admin)

| Command | Prefix | Description |
|---------|--------|-------------|
| `/prefix <new>` | `ka!prefix` | Change bot prefix (max 5 chars). Needs Manage Server. |
| `/setchannel <#channel>` | `ka!set` | Restrict summons to one channel. |
| `/antisnipe <seconds>` | — | Set grab delay (0-30s) to prevent sniping. |
| `/restrict <category> <#channel>` | — | Restrict command categories to specific channels. |

---

## Admin (Bot Owner)

| Command | Prefix | Description |
|---------|--------|-------------|
| `/grant <character> <@user>` | — | Grant a card to a user. Respects edition selection. |
| `/spawn` | — | Force an activity spawn in the current channel. |
| `/browse` | — | Browse the character database. |
| `/review` | — | Review and clear anti-bot flags on users. |

---

## Services (Background Systems)

### Summon Watch (New)
When a character on your wishlist is summoned in any server, you get a DM notification:
> 💖 **Character Name** from your wishlist was just summoned in **Server Name** (#channel)!

Rate-limited to once per character per 10 minutes to prevent spam.

### Anti-Bot System
Multi-layered protection against automation:
- **Behavioral rate limits**: Command velocity, grab timing consistency, message entropy
- **Account checks**: Account age for economy-sensitive actions
- **Flag system**: Accumulating flags lead to soft-lockout
- **Audit trail**: All flagged actions logged for admin review via `/review`

### Alarm Service
Persistent cooldown reminders via DM. Preferences stored in Redis (`alarm:{userId}`). Timers scheduled via `setTimeout` with the exact remaining cooldown duration.

---

## Database Tables (30 total)

| Table | Purpose |
|-------|---------|
| `characters` | Character definitions (name, series, source, popularity) |
| `character_editions` | Edition images for each character |
| `cards` | Card instances (owner, print, quality, cosmetics) |
| `users` | Player data (economy, stats, profile, level) |
| `guilds` | Per-server config (prefix, channels, restrictions) |
| `frames`, `hexes`, `auras`, `stickers` | Cosmetic item definitions |
| `user_hexes/auras/stickers/frames` | Player cosmetic inventories |
| `card_stickers` | Stickers placed on specific cards |
| `summon_list`, `like_list` | Summon boost list and wishlist |
| `user_tags` | Custom tag definitions per user |
| `gifts` | Card gift system (pending/accepted/declined) |
| `mail` | Inbox messages (system, gift, trade, event, achievement) |
| `trades` | Trade history and state |
| `shop_items` | Shop catalog |
| `teams`, `team_members` | RPG team system |
| `gear` | Equipment items (partially wired; some gameplay systems pending) |
| `quests`, `user_quests` | Quest system |
| `pvp_matches` | PvP battle log (future) |
| `events`, `event_cards` | Seasonal events |
| `backgrounds`, `user_backgrounds` | Profile backgrounds |
| `achievements`, `user_achievements` | Achievement tracking |
| `audit_log` | Action audit trail for anti-cheat |

---

## Economy Overview

| Currency | Emoji | How to Earn |
|----------|-------|-------------|
| Gold | 💰 | Daily, summons/fusions, minigames, selling |
| Petals | 🌸 | Premium economy (host-configurable) |
| Shards | ✨ | Achievements, optional vote integration |
| Cinders | 🔥 | Fusing cards |

### Quality Tiers
`Damaged → Poor → Good → Excellent → Pristine`

Upgrade costs (in Cinders): 10 → 25 → 75 → 200

### Print Numbers
Weighted random distribution: lower prints are exponentially rarer (4th-root power distribution). Print #1 has roughly 1/256 the chance of high prints.

---

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Bot Framework**: discord.js v14
- **Database**: PostgreSQL + Drizzle ORM
- **Cache**: Redis (cooldowns, alarms, rate limits, anti-bot state)
- **Image Rendering**: Canvas-based card renderer
