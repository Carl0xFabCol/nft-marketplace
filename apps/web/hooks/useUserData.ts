import { useQuery } from "@tanstack/react-query"
import { UserService } from "@/services/user.service"
import { Address } from "viem"

export function useUserData(address: Address) {
  return useQuery({
    queryKey: ["user", address],
    queryFn: () => UserService.getUserData(address),
    staleTime: 30000,
    refetchOnWindowFocus: true,
  })
}
