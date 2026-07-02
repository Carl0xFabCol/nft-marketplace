import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import WebSocket from "ws"

// ─────────────────────────────────────────────────────────────────────────────
// Supabase client factories.
// Use createAnonClient() in the browser (apps/web).
// Use createServiceClient() on the server / in apps/indexer.
//
// The Database generic is intentionally untyped here to avoid requiring
// the generated types as a hard dependency. Each consumer passes its own
// Database type via the generic parameter, or uses the re-export from this
// package once types are consolidated.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a browser-safe anonymous Supabase client.
 * Reads env vars injected at build time in apps/web.
 */
export function createAnonClient<T = unknown>(supabaseUrl: string, supabaseAnonKey: string): SupabaseClient<T> {
  return createClient<T>(supabaseUrl, supabaseAnonKey, {
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
export function createServiceClient<T = unknown>(supabaseUrl: string, supabaseServiceRoleKey: string): SupabaseClient<T> {
  return createClient<T>(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      transport: WebSocket as any,
    },
  })
}
