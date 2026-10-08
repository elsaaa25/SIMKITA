"use client"

import { motion } from "motion/react"
import { cn } from "@/lib/utils"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export type TabItem = {
  value: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
}

export function AnimatedTabs({
  tabs,
  value,
  onValueChange,
  className,
  indicatorId = "tabs-08-indicator",
}: {
  tabs: TabItem[]
  value: string
  onValueChange: (value: string) => void
  className?: string
  indicatorId?: string
}) {
  return (
    <Tabs value={value} onValueChange={onValueChange} className={cn("w-full sm:w-auto", className)}>
      <TabsList className="no-scrollbar h-auto! w-full gap-1 overflow-x-auto rounded-2xl border border-slate-200/80 bg-slate-100/80 p-1 dark:border-slate-800 dark:bg-slate-900/80 sm:w-fit">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = tab.value === value
          return (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className={cn(
                "relative z-0 shrink-0 cursor-pointer border-none bg-transparent px-3.5 py-2 text-xs font-semibold shadow-none outline-none transition-colors after:hidden h-8.5 rounded-xl flex items-center gap-1.5",
                isActive
                  ? "text-[#005A9C] dark:text-blue-400 font-bold"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              )}
            >
              {isActive && (
                <motion.span
                  layoutId={indicatorId}
                  className="absolute inset-0 -z-10 rounded-xl bg-white dark:bg-slate-800 shadow-sm ring-1 ring-slate-200/90 dark:ring-slate-700/80"
                  transition={{ type: "spring", stiffness: 450, damping: 30 }}
                />
              )}
              {Icon && <Icon className="size-3.5 shrink-0" />}
              <span>{tab.label}</span>
            </TabsTrigger>
          )
        })}
      </TabsList>
    </Tabs>
  )
}

export { AnimatedTabs as AnimatedTabsNoIcon }
export default AnimatedTabs