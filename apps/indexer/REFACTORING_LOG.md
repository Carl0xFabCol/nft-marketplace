# Indexer Refactoring Log

## ✅ Step 3.1: Scaffold Structure & Interfaces (COMPLETE)

**Date**: 2026-07-01  
**Status**: ✅ Complete

### Files Created

#### Type Definitions

- `src/types/indexer.types.ts` - Core types (RawContractEvent, ParsedEvent, ContractConfig, BlockRange, RPC types)

#### Interfaces

- `src/providers/IRpcProvider.ts` - RPC provider abstraction
- `src/fetchers/IEventFetcher.ts` - Event fetching interface
- `src/parsers/IEventParser.ts` - Event parsing interface
- `src/handlers/IEventHandler.ts` - Event handling interface (stateless, queue-ready)
- `src/persistence/IRepository.ts` - Generic repository interface

#### Utilities

- `src/utils/logger.ts` - Structured logging with pino + pino-pretty
- `src/utils/retry.ts` - Exponential backoff retry logic
- `src/utils/BlockRange.ts` - Block range chunking and archive detection

#### Configuration

- `src/config/env.ts` - Centralized environment variable loading with validation
- `src/config/contracts.config.ts` - Contract definitions (migrated from inline array)
- `.env.example` - Comprehensive environment variable documentation

### Dependencies Added

- `pino@10.3.1` - Structured logging
- `pino-pretty@13.1.3` - Pretty-print logs for development
- `p-map@7.0.5` - Parallel async operations
- `@marketplace/database` - Added as workspace dependency

### Configuration Updates

- `apps/indexer/tsconfig.json` - Added ES2020 target and esModuleInterop
- `apps/indexer/package.json` - Added new dependencies

### Validation

✅ TypeScript compiles successfully with `tsx`  
✅ Environment validation works correctly  
✅ All interfaces compile without errors  
✅ Logger and utilities are ready for use

### Next Steps

- **Step 3.2**: Extract RPC Layer (ProviderFactory, ProviderPool, ViemRpcProvider)
- **Step 3.3**: Refactor event fetching with parallelization
- **Step 3.4**: Migrate parsers & handlers
- **Step 3.5**: Introduce structured logging throughout
- **Step 3.6**: Extract persistence layer

---

## ✅ Step 3.2: Extract RPC Layer (COMPLETE)

**Date**: 2026-07-01  
**Status**: ✅ Complete

### Files Created

- `src/providers/ViemRpcProvider.ts` - Concrete Viem implementation of IRpcProvider
- `src/providers/ProviderFactory.ts` - Smart provider selection (fast vs archive)
- `src/providers/ProviderPool.ts` - Fallback & retry orchestration
- `src/providers/index.ts` - Barrel export

### Key Features Implemented

#### ViemRpcProvider

- Wraps Viem's PublicClient into our standardized interface
- Supports custom headers for authentication (archive RPC tokens)
- 30s timeout for all requests
- Detailed logging with performance metrics
- **Archive error detection**: Automatically detects when archive access is required

#### ProviderFactory

- **Smart provider selection**: Automatically selects archive provider for blocks older than 128 blocks
- Initializes providers from environment configuration
- Supports optional archive and fallback providers
- Graceful degradation when archive provider is not configured

#### ProviderPool

- **Automatic fallback**: If primary fails, tries fallback, then archive
- **Retry logic**: 2 retries per provider with exponential backoff
- **Graceful degradation mode**: Returns null instead of throwing when archive isn't available
- Health check for all providers

### Resilience Strategy

1. **Primary Provider** (fast RPC) → 2 retries with 500ms initial backoff
2. **Fallback Provider** (if configured) → 2 retries with 500ms initial backoff
3. **Archive Provider** (if needed and configured) → 2 retries
4. **Graceful Degradation**: Skip historical ranges if archive unavailable (configurable)

### Validation

✅ Compiles and runs with `tsx`  
✅ Environment configuration loads correctly  
✅ Pino structured logging works beautifully  
✅ No TypeScript errors

### Example Log Output

```
[2026-07-01 15:19:44.304 +0200] INFO: ⚙️  Configuration loaded
    fastRpcUrl: "https://ethereum-sepolia-rpc.publicnode.com"
    hasArchiveRpc: false
    hasFallbackRpc: false
```

### Next Steps

- **Step 3.3**: Refactor event fetching with parallelization (BatchEventFetcher)

---

## ✅ Step 3.3: Refactor Event Fetching (COMPLETE)

**Date**: 2026-07-01  
**Status**: ✅ Complete

### Files Created

- `src/fetchers/BatchEventFetcher.ts` - High-performance parallel event fetcher
- `src/fetchers/MetadataFetcher.ts` - NFT & collection metadata fetcher
- `src/fetchers/index.ts` - Barrel export

### Key Features Implemented

#### BatchEventFetcher

- **Automatic chunking**: Splits large block ranges into configurable batch sizes (env: BATCH_SIZE)
- **Parallel execution**: Fetches multiple contracts simultaneously (env: MAX_PARALLEL_REQUESTS)
- **Event parsing**: Decodes raw logs into typed ParsedEvent objects
- **Chronological sorting**: Events sorted by block number, then log index
- **Performance metrics**: Logs events/second, duration, chunk count
- **Error handling**: Gracefully skips unparseable events

#### MetadataFetcher

- Separated metadata fetching from event processing
- **NFT data**: tokenURI, metadata JSON, image URLs
- **Collection data**: name, symbol from ERC721 contracts
- **IPFS support**: Automatically converts ipfs:// to HTTP gateway
- **Timeout handling**: 10s timeout for IPFS requests

### Performance Improvements

**Before** (sequential):

```typescript
for (const contract of CONTRACTS_TO_INDEX) {
  const events = await client.getContractEvents(...)  // Sequential
}
```

**After** (parallel):

```typescript
await pMap(
  contracts,
  (contract) => fetchContractEvents(contract),
  { concurrency: MAX_PARALLEL_REQUESTS }, // Parallel!
)
```

**Expected speedup**: 3x faster with MAX_PARALLEL_REQUESTS=3

### Validation

✅ Compiles successfully with `tsx`  
✅ No TypeScript errors  
✅ Properly typed with strict types  
✅ Integrates with provider layer

### Next Steps

- **Step 3.4**: Migrate parsers & handlers (extract event handling logic)
- **Step 3.5**: Introduce structured logging throughout (already partially done)
- **Step 3.6**: Extract persistence layer (repositories)

---

## ⏳ Step 3.4: Migrate Parsers & Handlers (PENDING)

To be implemented next...
