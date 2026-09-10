"use client"

import Link from "next/link"
import { signOut, useSession } from "next-auth/react"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  ChevronsUpDown,
  LogOut,
  UserRound,
  Settings,
  Bell,
  ShieldCheck,
} from "lucide-react"

export function NavUser() {
  const { isMobile } = useSidebar()
  const { data: session } = useSession()

  const name = session?.user?.name || "Admin AirNav BWX"
  const email = session?.user?.email || "admin@airnav.co.id"
  const role = (session?.user as { role?: string })?.role || "ADMIN"
  const userImage = (session?.user as { image?: string })?.image || ""

  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:justify-center"
            >
              <Avatar className="h-8 w-8 rounded-lg shrink-0 border border-slate-200 dark:border-slate-700">
                <AvatarImage src={userImage} alt={name} />
                <AvatarFallback className="rounded-lg bg-[#005A9C] text-white font-bold text-xs">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-xs leading-tight min-w-0 group-data-[collapsible=icon]:hidden">
                <span className="truncate font-semibold text-foreground">{name}</span>
                <span className="truncate text-[10px] text-muted-foreground">{email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[240px] rounded-xl"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2.5 px-2 py-2 text-left text-xs">
                <Avatar className="h-9 w-9 rounded-lg shrink-0">
                  <AvatarImage src={userImage} alt={name} />
                  <AvatarFallback className="rounded-lg bg-[#005A9C] text-white font-bold text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 min-w-0 leading-tight">
                  <span className="truncate font-bold text-foreground">{name}</span>
                  <span className="truncate text-[10px] text-muted-foreground">{email}</span>
                  <span className="mt-0.5 inline-flex w-fit items-center gap-1 rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-700 dark:text-slate-300">
                    <ShieldCheck className="size-2.5 text-[#005A9C]" />
                    {role}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild className="cursor-pointer text-xs">
                <Link href="/profil">
                  <UserRound className="mr-2 size-4 text-slate-500" />
                  Edit Profil
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="cursor-pointer text-xs">
                <Link href="/pengaturan">
                  <Settings className="mr-2 size-4 text-slate-500" />
                  Pengaturan Sistem
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="cursor-pointer text-xs">
                <Link href="/peringatan">
                  <Bell className="mr-2 size-4 text-slate-500" />
                  Log Peringatan
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="cursor-pointer text-xs text-red-600 focus:bg-red-50 focus:text-red-700 dark:focus:bg-red-950/40"
            >
              <LogOut className="mr-2 size-4" />
              Keluar / Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
