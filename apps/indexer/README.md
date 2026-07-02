# 🔍 Marketplace Indexer

A production-ready, high-performance blockchain indexer for the NFT Marketplace. Built with TypeScript, this indexer monitors smart contract events in real-time and maintains a synchronized database of all marketplace activity.

## 📋 Table of Contents

- [Architecture](#-architecture)
- [Features](#-features)
- [Getting Started](#-getting-started)
- [Configuration](#-configuration)
- [Adding New Contracts](#-adding-new-contracts)
- [Folder Structure](#-folder-structure)
- [Development](#-development)
- [Troubleshooting](#-troubleshooting)

---

## 🏗️ Architecture

### Overview

The indexer follows a **layered architecture** with clean separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                   IndexerOrchestrator                       │
│          (Polling loop & orchestration logic)               │
└──────────────────┬──────────────────────────────────────────┘
                   │
         ┌─────────┼─────────┐
         │         │         │
         ▼         ▼         ▼
   ┌─────────┬─────────┬──────────┐
   │Provider │  Event  │ Handler  │
   │  Pool   │ Fetcher │ Registry │
   └────┬────┴────┬────┴─────┬────┘
        │         │          │
        ▼         ▼          ▼
   ┌────────┬─────────┬──────────┐
   │  RPC   │ Parsers │ Handlers │
   │Providers│         │          │
   └────────┴─────────┴─────┬────┘
                            │
                            ▼
                    ┌──────────────┐
                    │ Repositories │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   Supabase   │
                    └──────────────┘
```

### Key Components

#### 1. **Multi-Provider RPC Layer** (`src/providers/`)

- **ProviderPool**: Manages multiple RPC providers with automatic fallback
- **ViemRpcProvider**: Concrete implementation using Viem
- **Graceful degradation**: If primary provider fails, automatically tries fallback providers

#### 2. **Event Fetching** (`src/fetchers/`)

- **BatchEventFetcher**: Fetches events in parallel with configurable batch sizes
- **MetadataFetcher**: Retrieves NFT and collection metadata from contracts
- Smart chunking for large block ranges

#### 3. **Handler System** (`src/handlers/`)

- **HandlerRegistry**: Routes events to appropriate handlers
- **CoreEventHandler**: Handles marketplace core contract events (listings, sales, collections)
- **BidsEventHandler**: Handles bid-related events (token bids, collection bids)
- **Stateless handlers**: Each handler is pure and has no internal state

#### 4. **Repository Layer** (`src/persistence/`)

- Clean abstraction over database operations
- Six repositories: `Activity`, `Collections`, `Listings`, `Bids`, `NFT`, `IndexerState`
- All handlers use repositories—**NO direct database calls**

#### 5. **Orchestrator** (`src/services/`)

- **IndexerOrchestrator**: The heart of the indexer
- Runs the polling loop
- Coordinates fetching, parsing, and dispatching
- Handles errors gracefully without crashing

---

## ✨ Features

### 🚀 Performance

- **Parallel event fetching** from multiple contracts
- **Batching** to minimize RPC calls
- **Chunking** of large block ranges
- Configurable concurrency limits

### 🛡️ Resilience

- **Multi-provider fallback** strategy
- **Exponential backoff** retry logic
- **Graceful error handling** (never crashes the process)
- **Archive node detection** with automatic fallback

### 📊 Observability

- **Structured logging** with Pino
- Detailed performance metrics
- Clear error context with stack traces
- Emoji-based visual indicators for quick scanning

### 🔧 Maintainability

- **100% TypeScript** with strict type safety
- **Dependency injection** throughout
- **Stateless handlers** (easy to test and scale)
- **Clean architecture** with clear boundaries

---

## 🚀 Getting Started

### Prerequisites

1. **Node.js 18+** and **pnpm**
2. **Supabase account** (free tier works)
3. **RPC provider** (Alchemy, Infura, or similar)

### Step 1: Clone and Install

```bash
# From the monorepo root
pnpm install
```

### Step 2: Set Up Database

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Run the migrations from `packages/database/migrations/`
3. Initialize the indexer state:

```sql
INSERT INTO indexer_state (chain_id, last_block)
VALUES (11155111, 5000000);  -- Sepolia starting block
```

### Step 3: Get RPC Providers

#### Option 1: Alchemy (Recommended)

1. Sign up at [alchemy.com](https://www.alchemy.com/)
2. Create a Sepolia app
3. Copy your API key
4. Free tier: **300M compute units/month**

#### Option 2: Infura

1. Sign up at [infura.io](https://www.infura.io/)
2. Create a project
3. Copy your project ID
4. Free tier: **100k requests/day**

#### Option 3: Public Nodes (Backup only)

- `https://rpc.ankr.com/eth_sepolia` (rate-limited)
- `https://ethereum-sepolia.publicnode.com` (rate-limited)

### Step 4: Configure Environment

```bash
cd apps/indexer
cp .env.example .env
```

Edit `.env` with your values:

```bash
# Required
FAST_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Optional but recommended
ARCHIVE_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ARCHIVE_KEY
FALLBACK_RPC_URL=https://rpc.ankr.com/eth_sepolia
```

### Step 5: Run the Indexer

```bash
# Development mode (with hot reload)
pnpm run indexer:dev

# Production mode
pnpm run indexer

# Build only
pnpm run build
```

---

## ⚙️ Configuration

### Environment Variables

| Variable                | Required | Default | Description                             |
| ----------------------- | -------- | ------- | --------------------------------------- |
| `FAST_RPC_URL`          | ✅       | -       | Primary RPC endpoint                    |
| `ARCHIVE_RPC_URL`       | ❌       | -       | Archive node for historical data        |
| `FALLBACK_RPC_URL`      | ❌       | -       | Backup RPC endpoint                     |
| `BATCH_SIZE`            | ❌       | 5000    | Max blocks per iteration                |
| `MAX_PARALLEL_REQUESTS` | ❌       | 3       | Concurrent contract fetches             |
| `POLLING_INTERVAL_MS`   | ❌       | 15000   | Time between polls (ms)                 |
| `MAX_RETRY_ATTEMPTS`    | ❌       | 3       | Retry attempts per RPC call             |
| `LOG_LEVEL`             | ❌       | info    | Log level (trace/debug/info/warn/error) |

### Performance Tuning

#### For Fast Initial Sync

```bash
BATCH_SIZE=10000
MAX_PARALLEL_REQUESTS=5
POLLING_INTERVAL_MS=5000
```

#### For Stable Production

```bash
BATCH_SIZE=2000
MAX_PARALLEL_REQUESTS=3
POLLING_INTERVAL_MS=15000
```

#### For Rate-Limited RPCs

```bash
BATCH_SIZE=500
MAX_PARALLEL_REQUESTS=1
POLLING_INTERVAL_MS=30000
```

---

## 🔌 Adding New Contracts

Want to index a new contract? Follow these steps:

### Step 1: Add Contract Configuration

Edit `src/config/contracts.config.ts`:

```typescript
export const CONTRACTS_TO_INDEX: ContractConfig[] = [
  // ... existing contracts
  {
    name: "my_new_contract",
    address: "0x..." as Address,
    abi: MyContractABI,
    events: [
      "EventOne",
      "EventTwo",
      // ... list all events you want to index
    ],
  },
]
```

### Step 2: Create Repository (if needed)

Create `src/persistence/MyContractRepository.ts`:

```typescript
export class MyContractRepository {
  constructor(private supabase: SupabaseClient) {}

  async insertSomething(params: {...}): Promise<void> {
    const { error } = await this.supabase
      .from("my_table")
      .insert({...})

    if (error) {
      logger.error({ error }, "Failed to insert")
      throw error
    }
  }
}
```

### Step 3: Create Event Handler

Create `src/handlers/MyContractEventHandler.ts`:

```typescript
export class MyEventHandler extends BaseHandler {
  readonly eventName = "EventOne"

  async handle(event: ParsedEvent<EventOneArgs>): Promise<void> {
    const { arg1, arg2 } = event.args

    logger.info({ arg1, arg2 }, "🎯 Handling EventOne")

    // Use repository
    await this.myRepo.insertSomething({...})

    // Insert activity
    await this.activityRepo.insert({...})
  }
}

// Factory function
export function createMyContractHandlers(...deps): IEventHandler[] {
  return [
    new MyEventHandler(...deps),
    // ... more handlers
  ]
}
```

### Step 4: Register Handlers

Edit `src/index.ts`:

```typescript
// Import
import { createMyContractHandlers } from "./handlers/MyContractEventHandler"

// In main():
const myHandlers = createMyContractHandlers(
  activityRepo,
  myContractRepo,
  // ... other dependencies
)

for (const handler of myHandlers) {
  handlerRegistry.register(handler)
}
```

### Step 5: Run & Monitor

```bash
pnpm run indexer:dev
```

Watch the logs for your new events being processed! 🎉

---

## 📁 Folder Structure

```
apps/indexer/
├── src/
│   ├── config/              # Configuration files
│   │   ├── env.ts          # Environment variable loader
│   │   └── contracts.config.ts  # Contract definitions
│   │
│   ├── providers/          # RPC provider layer
│   │   ├── IRpcProvider.ts
│   │   ├── ViemRpcProvider.ts
│   │   ├── ProviderPool.ts
│   │   └── ProviderFactory.ts
│   │
│   ├── fetchers/           # Event fetching logic
│   │   ├── IEventFetcher.ts
│   │   ├── BatchEventFetcher.ts
│   │   └── MetadataFetcher.ts
│   │
│   ├── handlers/           # Event handlers
│   │   ├── IEventHandler.ts
│   │   ├── HandlerRegistry.ts
│   │   ├── CoreEventHandler.ts
│   │   └── BidsEventHandler.ts
│   │
│   ├── persistence/        # Repository layer
│   │   ├── ActivityRepository.ts
│   │   ├── CollectionsRepository.ts
│   │   ├── ListingsRepository.ts
│   │   ├── BidsRepository.ts
│   │   ├── NFTRepository.ts
│   │   └── IndexerStateRepository.ts
│   │
│   ├── services/           # Orchestration
│   │   └── IndexerOrchestrator.ts
│   │
│   ├── utils/              # Utilities
│   │   ├── logger.ts
│   │   ├── retry.ts
│   │   └── BlockRange.ts
│   │
│   ├── types/              # TypeScript types
│   │   └── indexer.types.ts
│   │
│   └── index.ts            # Entry point
│
├── .env.example            # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🛠️ Development

### Running in Development

```bash
# Hot reload
pnpm run indexer:dev

# Build
pnpm run build

# Type check
pnpm run type-check
```

### Testing

```bash
# Unit tests
pnpm test

# Integration tests
pnpm test:integration

# Test single provider
pnpm test:provider
```

### Debugging

Set `LOG_LEVEL=debug` or `LOG_LEVEL=trace` for detailed output:

```bash
LOG_LEVEL=debug pnpm run indexer:dev
```

### Graceful Shutdown

Press `Ctrl+C` (SIGINT) to trigger graceful shutdown:

1. Indexer completes current iteration
2. Updates last_block in database
3. Exits cleanly after 30 seconds max

---

## 🐛 Troubleshooting

### Issue: "No RPC provider available"

**Solution:** Check your RPC URLs and API keys in `.env`

```bash
# Test your RPC
curl https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### Issue: "Missing trie node" or "Archive required"

**Solution:** You're querying old blocks without an archive node.

Options:

1. Add `ARCHIVE_RPC_URL` to your `.env`
2. Start indexing from a more recent block
3. The indexer will skip gracefully if you don't have archive access

### Issue: Rate Limited

**Solution:** Reduce batch size and parallel requests:

```bash
BATCH_SIZE=500
MAX_PARALLEL_REQUESTS=1
POLLING_INTERVAL_MS=30000
```

### Issue: "Failed to update indexer state"

**Solution:** Check Supabase connection and ensure the `indexer_state` table exists:

```sql
SELECT * FROM indexer_state WHERE chain_id = 11155111;
```

### Issue: Indexer Stops Processing

**Symptoms:** Logs show "Already synced" repeatedly

**Solution:** Something is preventing new blocks. Check:

1. Is the chain producing blocks?
2. Is your last_block correct in database?
3. Try resetting to a recent block:

```sql
UPDATE indexer_state
SET last_block = (SELECT MAX(block_number) FROM activity) - 100
WHERE chain_id = 11155111;
```

---

## 📝 Best Practices

1. **Always use repositories** - Never call Supabase directly from handlers
2. **Keep handlers stateless** - No instance variables holding data
3. **Log structured data** - Use JSON objects, not string concatenation
4. **Handle errors gracefully** - Log and continue, don't crash
5. **Test with small batch sizes first** - Then scale up
6. **Monitor RPC usage** - Stay within free tier limits
7. **Use archive nodes sparingly** - They're expensive/rate-limited

---

## 🚦 Production Checklist

- [ ] Use production Supabase instance
- [ ] Set `LOG_LEVEL=info` or `LOG_LEVEL=warn`
- [ ] Configure multiple RPC providers for redundancy
- [ ] Set up monitoring/alerting on logs
- [ ] Configure restart policy (systemd, PM2, Docker, etc.)
- [ ] Set appropriate batch sizes for your RPC tier
- [ ] Test graceful shutdown behavior
- [ ] Monitor database growth and set up archival if needed

---

## 📄 License

MIT © HYPERMARKET

---

## 🤝 Contributing

1. Follow the existing architecture patterns
2. Add tests for new handlers
3. Update this README if adding new features
4. Use structured logging with appropriate emojis
5. Ensure TypeScript strict mode compliance

---

**Questions?** Check the codebase—it's heavily documented! Every class, method, and major logic block has clear comments explaining its purpose.

**Need help?** Open an issue or reach out to the team.

Happy indexing! 🚀
