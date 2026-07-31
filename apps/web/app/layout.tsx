import "./globals.css"
import { Providers } from "./providers"
import { ThemeProvider } from "next-themes"
import { Space_Mono } from "next/font/google"

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
})

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={spaceMono.className + " h-screen"}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <div className="h-screen w-full flex flex-col relative overflow-hidden transition-colors duration-300">
            <Providers>{children}</Providers>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
