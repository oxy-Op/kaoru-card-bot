# How To Play Kaoru

This guide is for players, not maintainers.

## Core Loop

1. Summon cards
2. Grab cards
3. Build your collection
4. Improve cards (fuse/burn/upgrade)
5. Trade with other players
6. Repeat with better targeting (wishlist, summon list, filters)

## Start Here

- `/summon` (`k!s`) — roll 3 cards (2 visible + 1 mystery)
- `/grab` button on summon message — claim one before others do
- `/collection` (`k!c`) — see your cards
- `/cardinfo <code>` (`k!ci`) — detailed stats and ownership
- `/cooldown` (`k!cd`) — check summon/grab/daily timers

## Economy (Current Runtime)

### Currencies

- **Gold**: daily, summons/fusions, minigames
- **Shards**: achievements (and optional vote integration if host enables it)
- **Cinders**: fusion/burn progression currency

### Main Sinks

- Packs and shop items (gold/shards)
- Quality upgrades (cinders)
- Wishlist targeting (`/wish add`) uses popularity-scaled gold cost
- Cosmetic progression

## Progression

### Leveling

Runtime XP is currently awarded from summon/grab loops.  
Transfers are currently open once you are level 1.

### Key Gates

- Give cards: level 1
- Trade: level 1
- Multi-trade: level 1
- Fusion board: level 3

## Collection Power Features

- `/wish` and summon list slots to target characters
- `/wish add` costs gold scaled by character popularity (higher popularity = higher cost)
- `/lookup <name>` for discovery
- `/leaderboard` for progression competition
- Tags for card organization

## Fusion and Upgrades

- Add cards to fusion board and fuse for output + cinders
- Burn low-value cards for cinders
- Upgrade quality using cinders

## Trading

- Quick trade for simple 1:1 exchanges
- Multi-trade for larger card + resource swaps

Always verify card codes and values before confirming.

## Fair Play

- Cooldowns and anti-abuse checks are enforced by host configuration
- Suspicious automation patterns may be rate-limited/restricted

## Optional Host Features

Depending on deployment config:

- Vote rewards may be disabled until verified integration is enabled
- Seasonal/event systems may be partial or fully active
- Premium-style currencies/features may be disabled

## Where To Learn More

- Command catalog: `docs/commands-reference.md`
