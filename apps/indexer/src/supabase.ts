import "dotenv/config";
import { createServiceClient } from "@marketplace/database/client";

// ─────────────────────────────────────────────────────────────────────────────
// Service-role Supabase client for the indexer.
// Uses SERVICE_ROLE_KEY — never expose to the browser.
// ─────────────────────────────────────────────────────────────────────────────

export const supabase = createServiceClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
