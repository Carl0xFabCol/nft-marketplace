import { useQuery } from "@tanstack/react-query";
import { UserService } from "@/services/user.service";
import { supabase } from "@/lib/supabase/client";
import { Address } from "viem";

export function useUserData(address: Address) {
  return useQuery({
    queryKey: ["user", address],
    queryFn: () => UserService.getUserData(supabase, address),
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });
}
