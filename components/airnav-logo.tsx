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
      {/* Collapsed Sidebar Mode: Clean circular emblem crop */}
      <div className="relative size-8 shrink-0 overflow-hidden rounded-full group-data-[collapsible=icon]:flex hidden items-center justify-center">
        <img
          src="/airnav-logo.png"
          alt="AirNav Indonesia"
          className="absolute left-0 top-0 h-8 w-auto max-w-none object-cover object-left"
        />
      </div>

      {/* Expanded Sidebar Mode: Official Landscape Logo cleanly constrained */}
      <div className="flex items-center gap-2 min-w-0 group-data-[collapsible=icon]:hidden">
        <img
          src="/airnav-logo.png"
          alt="AirNav Indonesia"
          className="h-7 w-auto max-w-[145px] shrink-0 object-contain"
        />
      </div>
    </div>
  )
}
