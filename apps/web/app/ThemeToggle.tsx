"use client"
import { useState, useEffect } from "react"
import { FaSun, FaMoon } from "react-icons/fa"

export default function ThemeToggle() {
  const [theme, setTheme] = useState("light")

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme")

    if (savedTheme) {
      setTheme(savedTheme)
      document.body.classList.add(savedTheme)
    }
  }, [])

  const toggleTheme = () => {
    if (theme === "light") {
      document.body.classList.add("dark")
      setTheme("dark")
      localStorage.setItem("theme", "dark")
    } else {
      document.body.classList.remove("dark")
      setTheme("light")
      localStorage.setItem("theme", "light")
    }
  }

  return (
    <button onClick={toggleTheme} className="p-3 h-full rounded-[10px] border-2 bg-transparent! border-(--bg) text-(--text)/70! w-full flex justify-center">
      {theme === "dark" ? <FaSun /> : <FaMoon />}
    </button>
  )
}
