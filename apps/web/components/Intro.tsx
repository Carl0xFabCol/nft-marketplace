"use client"
import { motion, AnimatePresence } from "framer-motion"
import { useState, useEffect } from "react"
import { IoIosArrowDown } from "react-icons/io"
export default function Intro() {
  const [mounted, setMounted] = useState<boolean>(false)
  const [firstTime, setFirstTime] = useState<boolean>(false)
  useEffect(() => {
    setMounted(true)
    setFirstTime(!localStorage.getItem("firstTime"))
  }, [])

  return (
    <AnimatePresence>
      {firstTime && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
          className="absolute z-100 top-0 left-0 pt-20 bg-linear-to-b from-(--bg-secondary) to-transparent w-full flex items-center justify-center flex-col gap-2 pb-120"
        >
          {
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.2 }} className="mt-10">
              <h2 className="text-xl font-semibold mb-4">Thanks for reaching my dApp!</h2>

              <p className="max-w-2xl">
                This project was built as a production-like <strong className="text-(--accent)/70">NFT Marketplace</strong>. Its <strong className="text-(--accent)/70">goal</strong> is to showcase
                best practices in modern <strong className="text-(--accent)/70">Web3</strong> development.
              </p>
            </motion.div>
          }
          {mounted && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col gap-2 justify-center items-center"
            >
              <button
                onClick={() => {
                  localStorage.setItem("firstTime", "false")
                  setFirstTime(false)
                }}
                className="py-2 items-center justify-center bg-transparent! flex-col text-(--accent)! px-4 rounded-4xl mt-3 w-fit flex gap-2 hover:opacity-85  "
              >
                <span>Go to marketplace</span>
                <IoIosArrowDown />
              </button>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
