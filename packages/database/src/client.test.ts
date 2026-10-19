import { describe, expect, it, vi } from "vitest"

const mockCreateClient = vi.fn()
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => {
    mockCreateClient(...args)
    return { _called: true }
  },
}))

import { createAnonClient, createServiceClient } from "./client"

type TestClient = { _called: boolean }

describe("@marketplace/database client factories", () => {
  const url = "https://proj.supabase.co"
  const anonKey = "anon-key"
  const serviceKey = "service-role-key"

  it("createAnonClient calls createClient with anon auth options", () => {
    const client = createAnonClient(url, anonKey) as unknown as TestClient
    expect(client._called).toBe(true)
    expect(mockCreateClient).toHaveBeenCalledWith(url, anonKey, expect.objectContaining({
      auth: expect.objectContaining({
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      }),
      db: { schema: "public" },
      realtime: { params: { eventsPerSecond: 10 } },
    }))
  })

  it("createServiceClient calls createClient with service-role auth options", () => {
    const client = createServiceClient(url, serviceKey) as unknown as TestClient
    expect(client._called).toBe(true)
    expect(mockCreateClient).toHaveBeenCalledWith(url, serviceKey, expect.objectContaining({
      auth: expect.objectContaining({
        persistSession: false,
        autoRefreshToken: false,
      }),
      realtime: expect.any(Object),
    }))
  })
})
