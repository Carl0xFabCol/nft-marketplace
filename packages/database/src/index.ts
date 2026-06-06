// @marketplace/database — Supabase client factories and repository classes.
//
// Usage (browser — apps/web):
//   import { createAnonClient } from "@marketplace/database/client"
//
// Usage (server / indexer — apps/indexer):
//   import { createServiceClient } from "@marketplace/database/client"
//
// Usage (repositories):
//   import { ListingsRepository } from "@marketplace/database/repositories"
//
// NOTE: Supabase generated types live in apps/web/lib/supabase/types.ts
// and are not yet moved here. That migration is tracked as Phase 6.

export { createAnonClient, createServiceClient } from "./client";
export {
  ListingsRepository,
  CollectionsRepository,
  ActivityRepository,
} from "./repositories/index";
