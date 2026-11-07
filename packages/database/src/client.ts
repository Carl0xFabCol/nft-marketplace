import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import WebSocket from "ws"

// ─────────────────────────────────────────────────────────────────────────────
// Supabase client factories.
// Use createAnonClient() in the browser (apps/web).
// Use createServiceClient() on the server / in apps/indexer.
//
// The clients are intentionally untyped (no Database generic) to avoid requiring
// the generated types as a hard dependency. A generic parameter used to be
// accepted here, but no caller passed one and it did not typecheck against
// supabase-js 2.9x. Re-add a typed variant once types are consolidated.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a browser-safe anonymous Supabase client.
 * Reads env vars injected at build time in apps/web.
 */
export function createAnonClient(supabaseUrl: string, supabaseAnonKey: string): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      headers: {
        "x-application-name": "nft-marketplace",
      },
    },
    db: { schema: "public" },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  })
}

/**
 * Creates a server-side service-role Supabase client.
 * Uses the SERVICE_ROLE_KEY — NEVER expose this to the browser.
 * Used by apps/indexer and Next.js server actions / route handlers.
 */
export function createServiceClient(supabaseUrl: string, supabaseServiceRoleKey: string): SupabaseClient {
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      transport: WebSocket as any,
    },
  })
}
