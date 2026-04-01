---
name: Sxbet
description: Use when building trading bots, market-making systems, custom frontends, or analytics tools on the SX Bet peer-to-peer sports prediction market. Reach for this skill when agents need to fetch markets, read orderbooks, post/fill orders, manage exposure, subscribe to real-time updates, or integrate with the exchange API.
metadata:
    mintlify-proj: sxbet
    version: "1.0"
---

# SX Bet Developer Skill

## Product summary

SX Bet is a decentralized, peer-to-peer sports prediction market where users trade directly against each other through an open orderbook — not against a house. Agents use the REST API to fetch markets, read odds, post maker orders, and fill taker orders. Real-time updates flow through Centrifugo WebSocket channels. The platform charges 0% maker fees and 5% parlay fees.

**Key files and endpoints:**
- REST API: `https://api.sx.bet` (mainnet) or `https://api.toronto.sx.bet` (testnet)
- WebSocket: `wss://realtime.sx.bet/connection/websocket` (mainnet)
- Config: Fetch `/metadata` endpoint for executor, TokenTransferProxy, and EIP712FillHasher addresses — never hardcode them
- Authentication: API key via `X-Api-Key` header for WebSocket; private key signatures for orders

**Primary docs:** https://sxbet-9c561d83.mintlify.app/developers/introduction

## When to use

Reach for this skill when:
- Building a trading bot that posts maker orders or fills taker orders
- Implementing a market-making system with real-time order monitoring and repricing
- Fetching live markets, odds, or orderbook data for a custom frontend
- Subscribing to real-time trade, order, or market updates via WebSocket
- Managing order exposure, cancellations, or heartbeat safety mechanisms
- Integrating parlay RFQ (request for quote) handling
- Switching between testnet and mainnet environments
- Debugging signature mismatches, balance issues, or order rejections

Do not use this skill for: user account management, KYC/AML, deposit/withdrawal flows, or UI-only operations.

## Quick reference

### Base URLs and environments

| Environment | API URL | WebSocket | Chain ID | USDC Address |
|-------------|---------|-----------|----------|--------------|
| Mainnet | `https://api.sx.bet` | `wss://realtime.sx.bet/connection/websocket` | `4162` | `0x6629Ce1Cf35Cc1329ebB4F63202F3f197b3F050B` |
| Testnet | `https://api.toronto.sx.bet` | `wss://realtime.toronto.sx.bet/connection/websocket` | `79479957` | `0x1BC6326EA6aF2aB8E4b6Bc83418044B1923b2956` |

### Essential REST endpoints

| Operation | Endpoint | Auth |
|-----------|----------|------|
| Fetch active markets | `GET /markets/active` | None |
| Get best odds | `GET /orders/odds/best` | None |
| Read orderbook | `GET /orders` | None |
| Post maker order | `POST /orders/new` | Private key signature |
| Fill taker order | `POST /orders/fill/v2` | Private key signature |
| Cancel orders | `POST /orders/cancel/v2` | Private key signature |
| Get metadata | `GET /metadata` | None |
| Heartbeat | `POST /user/heartbeat` | API key |

### WebSocket channels (require API key)

| Channel | Purpose |
|---------|---------|
| `active_orders:{maker}` | Monitor your open orders in real-time |
| `order_book:market_{marketHash}` | Full orderbook updates for a market |
| `best_odds:global` | Best available odds changes across all markets |
| `recent_trades:global` | Global trade feed |
| `markets:global` | Market status changes, suspension, settlement |
| `fixtures:live_scores` | Live match scores |
| `parlay_markets:global` | Incoming parlay RFQ requests |

### Odds format

Odds are stored as `implied_probability * 10^20` (e.g., 52.5% = `52500000000000000000`). Taker odds are the inverse: `10^20 - maker_odds`.

### Token amounts

All amounts are in Ethereum units (wei). USDC has 6 decimals: `1 USDC = 1000000` wei. Minimum maker order: 10 USDC. Minimum taker stake: 1 USDC.

## Decision guidance

### When to use maker vs taker

| Scenario | Use | Why |
|----------|-----|-----|
| You want to provide liquidity and earn spread | Maker (`POST /orders/new`) | 0% fees; you set the price |
| You want immediate execution at posted prices | Taker (`POST /orders/fill/v2`) | Fast execution; no exposure management |
| You're repricing in a volatile market | Cancel + repost | No in-place edit; cancel old, post new |

### When to use REST polling vs WebSocket

| Scenario | Use | Why |
|----------|-----|-----|
| One-time market fetch on startup | REST (`GET /markets/active`) | Simple, no connection overhead |
| Monitoring your open orders continuously | WebSocket (`active_orders:{maker}`) | Real-time updates; lower latency |
| Tracking best odds across many markets | WebSocket (`best_odds:global`) | Efficient; fires only on changes |
| Reconciling state after reconnect | REST snapshot + WebSocket | Avoids gaps; handles recovery |

### When to use cancellation endpoints

| Scenario | Endpoint | Why |
|----------|----------|-----|
| Cancel specific orders by hash | `POST /orders/cancel/v2` | Surgical; only affects named orders |
| Cancel all orders for one event | `POST /orders/cancel/event` | Useful when event is suspended |
| Cancel everything on shutdown | `POST /orders/cancel/all` | Clean slate; prevents stale orders |

## Workflow

### 1. Set up configuration

Store environment-specific values in a config object. Fetch executor, TokenTransferProxy, and EIP712FillHasher from `/metadata` at startup — never hardcode them.

```python
import os
import requests

ENV = os.environ.get("SX_ENV", "testnet")
CONFIG = {
    "testnet": {
        "api_url": "https://api.toronto.sx.bet",
        "chain_id": 79479957,
        "usdc_address": "0x1BC6326EA6aF2aB8E4b6Bc83418044B1923b2956",
    },
    "mainnet": {
        "api_url": "https://api.sx.bet",
        "chain_id": 4162,
        "usdc_address": "0x6629Ce1Cf35Cc1329ebB4F63202F3f197b3F050B",
    },
}
cfg = CONFIG[ENV]
metadata = requests.get(f"{cfg['api_url']}/metadata").json()["data"]
cfg["executor"] = metadata["executorAddress"]
cfg["token_transfer_proxy"] = metadata["TokenTransferProxy"]
cfg["eip712_fill_hasher"] = metadata["EIP712FillHasher"]
```

### 2. Fetch markets and odds

Query active markets, filter by sport or market type, and check current best odds before posting or filling.

```python
markets = requests.get(f"{cfg['api_url']}/markets/active").json()["data"]["markets"]
best_odds = requests.get(
    f"{cfg['api_url']}/orders/odds/best",
    params={"marketHashes": market_hash, "baseToken": cfg["usdc_address"]}
).json()["data"]["bestOdds"]
```

### 3. Post a maker order (if market making)

Build order, sign with private key, submit. Monitor fills via WebSocket `active_orders:{maker}`.

```python
from eth_account import Account
from web3 import Web3

account = Account.from_key(os.environ["SX_PRIVATE_KEY"])
order = {
    "marketHash": market_hash,
    "maker": account.address,
    "baseToken": cfg["usdc_address"],
    "totalBetSize": "100000000",  # 100 USDC
    "percentageOdds": "52500000000000000000",  # 52.5%
    "expiry": 2209006800,
    "apiExpiry": int(time.time()) + 3600,
    "executor": cfg["executor"],
    "salt": str(int.from_bytes(secrets.token_bytes(32), "big")),
    "isMakerBettingOutcomeOne": True,
}
order_hash = Web3.solidity_keccak([...], [...])  # see posting-orders docs
signed = account.sign_message(encode_defunct(primitive=order_hash))
requests.post(f"{cfg['api_url']}/orders/new", json={"orders": [{**order, "signature": signed.signature.hex()}]})
```

### 4. Fill a taker order (if betting)

Find orders, sign fill with EIP-712, submit. Monitor fills via WebSocket `recent_trades:global`.

```python
from eth_account import Account

account = Account.from_key(os.environ["SX_PRIVATE_KEY"])
fill_salt = int.from_bytes(secrets.token_bytes(32), "big")
DOMAIN = {
    "name": "SX Bet",
    "version": "6.0",
    "chainId": cfg["chain_id"],
    "verifyingContract": cfg["eip712_fill_hasher"],
}
FILL_TYPES = {
    "Details": [...],  # see filling-orders docs
    "FillObject": [...],
}
signed = Account.sign_typed_data(account.key, domain_data=DOMAIN, message_types=FILL_TYPES, message_data={...})
requests.post(f"{cfg['api_url']}/orders/fill/v2", json={...})
```

### 5. Monitor and manage orders

Subscribe to `active_orders:{maker}` for real-time updates. Set up heartbeat to auto-cancel on disconnect. Cancel stale orders when repricing.

```python
# Heartbeat (every 15 seconds, with 30-second timeout)
requests.post(f"{cfg['api_url']}/user/heartbeat", json={"interval": 30}, headers={"X-Api-Key": api_key})

# Cancel specific orders
signed = account.sign_typed_data(account.key, domain_data={...}, message_types={...}, message_data={...})
requests.post(f"{cfg['api_url']}/orders/cancel/v2", json={"orderHashes": [...], "signature": ...})
```

### 6. Subscribe to real-time updates

Connect Centrifuge client, subscribe to channels, handle reconnects with recovery.

```python
from centrifuge import Client, SubscriptionOptions

async def fetch_token():
    res = requests.get(f"{cfg['api_url']}/user/realtime-token/api-key", headers={"x-api-key": api_key})
    return res.json()["token"]

client = Client("wss://realtime.sx.bet/connection/websocket", get_token=fetch_token)
sub = client.new_subscription(f"active_orders:{account.address}", handler, SubscriptionOptions(positioned=True, recoverable=True))
await client.connect()
await sub.subscribe()
```

## Common gotchas

- **Hardcoded addresses:** Never hardcode executor, TokenTransferProxy, or EIP712FillHasher. Fetch from `/metadata` at startup and cache.
- **Wrong chain ID in signatures:** Testnet is `79479957`, mainnet is `4162`. Mismatched chain ID causes `TAKER_SIGNATURE_MISMATCH`.
- **Wrong token addresses:** USDC differs per network. Using testnet USDC on mainnet causes `BAD_BASE_TOKEN`.
- **Odds not on ladder:** `percentageOdds` must land on the 0.125% odds ladder. Use the odds rounding guide to validate.
- **Exposure exceeds balance:** Total exposure per market hash (`sum of totalBetSize - fillAmount`) must stay under wallet balance. Orders are removed if balance dips below exposure.
- **Betting not enabled:** Must approve TokenTransferProxy before posting/filling. Do this once per token via the UI or programmatically.
- **Stale orders on disconnect:** Always set up heartbeat before going live. If your service crashes and misses a heartbeat, all orders auto-cancel.
- **Checksum addresses:** All ETH addresses in the API must use checksum format (EIP-55 mixed case). Lowercase-only addresses return no results.
- **Betting delay:** Fills are queued and matched after a short delay (seconds for pre-game, optimized for in-play). Your fill is matched against the orderbook state **after** the delay, not at submission time.
- **Partial fills:** Orders can be partially filled. If not enough liquidity exists at your `desiredOdds`, you get a partial fill or no fill.
- **Recovery window:** WebSocket recovery history is 5 minutes. After that, you must re-seed from REST.

## Verification checklist

Before submitting work:

- [ ] Configuration uses environment-specific values (API URL, chain ID, token addresses) from config object, not hardcoded
- [ ] Executor, TokenTransferProxy, and EIP712FillHasher are fetched from `/metadata`, not hardcoded
- [ ] All ETH addresses use checksum format (mixed case)
- [ ] Order `percentageOdds` validated against odds ladder (0.125% intervals)
- [ ] Maker `totalBetSize` is at least 10 USDC; taker `stakeWei` is at least 1 USDC
- [ ] Fill signing domain uses correct `chainId` and `verifyingContract` for the target network
- [ ] Heartbeat is set up before posting orders (interval ≤ 30 seconds, ping every 15 seconds)
- [ ] WebSocket subscriptions use `positioned: true, recoverable: true` for at-least-once delivery
- [ ] Error handling covers `INSUFFICIENT_BALANCE`, `INVALID_ODDS`, `ODDS_STALE`, `TAKER_SIGNATURE_MISMATCH`
- [ ] Testnet integration tested before switching to mainnet
- [ ] Private key stored in `.env` file, never committed to version control

## Resources

**Comprehensive navigation:** https://sxbet-9c561d83.mintlify.app/llms.txt

**Critical pages:**
1. [Quickstart](https://sxbet-9c561d83.mintlify.app/developers/quickstart) — End-to-end guide from setup to first fill
2. [Market Making](https://sxbet-9c561d83.mintlify.app/developers/market-making) — Posting orders, spreads, exposure management
3. [Real-time Data](https://sxbet-9c561d83.mintlify.app/developers/real-time) — WebSocket channels, recovery, reliability
4. [Testnet & Mainnet](https://sxbet-9c561d83.mintlify.app/developers/testnet-and-mainnet) — Configuration, switching environments
5. [Error Codes](https://sxbet-9c561d83.mintlify.app/developers/error-codes) — Troubleshooting order and fill rejections

---

> For additional documentation and navigation, see: https://sxbet-9c561d83.mintlify.app/llms.txt