import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// `pnpm --filter @marketplace/indexer test:localdb`
//
// Runs the real repositories against a LOCAL Supabase stack (never a remote
// one). Every suite is skipped unless INDEXER_TEST_SUPABASE_URL and
// INDEXER_TEST_SUPABASE_SERVICE_ROLE_KEY are exported in the shell, e.g. from
// `supabase status -o env` of a scratch project. `dotenv/config` is aliased to
// an empty module, so no .env file is ever read.
const url = process.env.INDEXER_TEST_SUPABASE_URL ?? "http://127.0.0.1:1"
const key = process.env.INDEXER_TEST_SUPABASE_SERVICE_ROLE_KEY ?? "localdb-unset"

export default defineConfig({
  resolve: {
    alias: { "dotenv/config": fileURLToPath(new URL("./src/__localdb__/empty-dotenv.ts", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.localdb.test.ts"],
    environment: "node",
    // One shared database: run files one at a time.
    fileParallelism: false,
    env: {
      CHAIN_ID: "99801",
      FAST_RPC_URL: "http://127.0.0.1:1",
      SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: key,
      LOG_LEVEL: "silent",
    },
  },
})
