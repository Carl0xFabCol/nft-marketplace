"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import ConnectWallet from "./ConnectWallet"
import ThemeToggle from "../app/ThemeToggle"
import { useEffect, useState } from "react"
import { useAccount } from "wagmi"

interface Props {
  openWalletModal: () => void
}
export default function Header({ openWalletModal }: Props) {
  const [menuCard, setMenuCard] = useState(false)
  const [mounted, setMounted] = useState<boolean>(false)

  const pathname = usePathname()
  const { address } = useAccount()
  useEffect(() => {
    setMounted(true)
  }, [])

  const switchMenuCard = (e: any) => {
    setMenuCard(!menuCard)
  }
  const closeMenuCard = (e: any) => {
    if (e.target.id === "menu-bg") {
      setMenuCard(false)
    }
  }

  const linkClass = (path: string) => {
    if (menuCard) {
      return `h-7 ${pathname == path ? " " : ""}`
    } else {
      return `h-7 ${pathname == path ? "text-(--accent)" : "text-(--text) hover:text-(--accent)"}`
    }
  }

  return (
    <header className=" flex justify-center items-center card z-100 relative">
      <div className="   py-2 px-4 card  w-full items-center fixed top-0 z-20">
        <div className="flex  w-full items-center">
          <h1 className="text-xl font-bold justify-center flex  ">HYPERMARKET</h1>

          <nav className="flex gap-4  ml-10 items-center text-sm  ">
            <Link href="/" className={linkClass("/")}>
              Home
            </Link>
            <Link href="/collections" className={linkClass("/collections")}>
              Collections
            </Link>
            {address && mounted && (
              <Link href={address ? `/user/${address.toLowerCase()}` : "/"} className={linkClass(`/user/${address.toLowerCase()}`)}>
                Portfolio
              </Link>
            )}
            <Link href="/launchpad" className={linkClass("/launchpad")}>
              Launchpad
            </Link>
          </nav>
          <div className="flex gap-4 items-center justify-end flex-1 ">
            <div className="flex">
              <ConnectWallet setWalletOptionsCard={openWalletModal} textMsg={"CONNECT WALLET"} />
            </div>
            <div>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
