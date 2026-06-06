/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class", // importante
  content: ["./app/*.{js,ts,jsx,tsx}", "./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Light
        lightBg: "#F5F7FF",
        lightBgSecondary: "#E9ECFF",
        lightText: "#1F1F1F",
        lightTextSecondary: "#4B4B4B",
        lightAccent: "#6366F1",
        lightBorder: "#D1D5DB",

        // Dark
        darkBg: "#12121B",
        darkBgSecondary: "#1C1C2A",
        darkText: "#F5F5F5",
        darkTextSecondary: "#C5C5C5",
        darkAccent: "#818CF8",
        darkBorder: "#2C2C3D",
      },
    },
  },
  safelist: ["bg-red-800", "dark:bg-blue-800", "text-black", "dark:text-white"],

  plugins: [],
}
