import React from "react"

export function AirNavLogo({
  className = "h-8",
  showText = true,
}: {
  className?: string
  showText?: boolean
}) {
  return (
    <div className={`flex items-center gap-2 min-w-0 overflow-hidden ${className}`}>
      {/* Collapsed Sidebar Mode: Clean emblem display */}
      <div className="relative size-8 shrink-0 overflow-hidden rounded-md group-data-[collapsible=icon]:flex hidden items-center justify-center">
        <img
          src="/SIMKITA.png"
          alt="SIMKITA AirNav Indonesia"
          className="h-8 w-auto object-contain"
        />
      </div>

      {/* Expanded Sidebar Mode: Landscape SIMKITA Logo */}
      <div className="flex items-center gap-2 min-w-0 group-data-[collapsible=icon]:hidden">
        <img
          src="/SIMKITA.png"
          alt="SIMKITA AirNav Indonesia"
          className="h-8 w-auto max-w-[160px] shrink-0 object-contain"
        />
      </div>
    </div>
  )
}
