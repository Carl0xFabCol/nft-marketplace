import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

// Validates env at boot. Imported by lib/supabase/{server,admin}.ts so any
// missing/malformed var fails fast instead of producing confusing runtime errors.
export const env = createEnv({
  server: {
    SUPABASE_SERVICE_ROLE_KEY: z.string(),
  },
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string(),
  },
  runtimeEnv: {
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
})
