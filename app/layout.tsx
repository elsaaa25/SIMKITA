import type { Metadata } from "next"
import { Roboto, Geist_Mono } from "next/font/google"
import { SessionProvider } from "next-auth/react"

import { AlertNotificationCenter } from "@/components/alert-notification-center"
import { DangerAlertOverlay } from "@/components/danger-alert-overlay"
import { TooltipProvider } from "@/components/ui/tooltip"

import "./globals.css"

const roboto = Roboto({
  weight: ["300", "400", "500", "700", "900"],
  subsets: ["latin"],
  variable: "--font-roboto",
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Server Room Monitoring - AirNav Indonesia",
  description:
    "Dashboard pemantauan suhu ruang server & ATC Bandara Banyuwangi",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="id" className="scroll-smooth">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.documentElement.classList.add('dark')
                } else {
                  document.documentElement.classList.remove('dark')
                }
              } catch (_) {}
            `,
          }}
        />
      </head>
      <body
        className={`${roboto.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <SessionProvider>
          <TooltipProvider>
            <AlertNotificationCenter />
            <DangerAlertOverlay />
            {children}
          </TooltipProvider>
        </SessionProvider>
      </body>
    </html>
  )
}