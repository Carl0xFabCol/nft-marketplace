import { supabase } from "@/lib/supabase/client"
import { useEffect } from "react"
import { Address } from "viem"

// hooks/useRealtimeListings.ts
export function useRealtimeListings(userAddress: Address) {
  useEffect(() => {
    const channel = supabase
      .channel("listings")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "listings",
          filter: `seller_wallet=eq.${userAddress}`,
        },
        (payload) => {
          // Update state
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userAddress])
}
