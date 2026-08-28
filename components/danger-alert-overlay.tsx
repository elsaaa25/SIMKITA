"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { usePathname } from "next/navigation"
import { AlertTriangle, X } from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

type AlertLevel = "Waspada" | "Bahaya"

type ActiveAlert = {
  id: number
  level: AlertLevel
  status: "Aktif" | "Ditangani"
  temperature: number
  sensorId: string
  title: string
  detail: string
  createdAt: string
}

type PopupNotification = {
  /** Unique key for React rendering — separate from alert DB id */
  key: string
  alertId: number
  level: AlertLevel
  title: string
  description: string
  /** Timestamp when the popup was created (for auto-dismiss countdown) */
  createdAt: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** How long (ms) before a popup auto-dismisses */
const AUTO_DISMISS_MS = 6_000

/** LocalStorage key that stores which alert IDs have already shown a popup */
const POPUP_SEEN_KEY = "server-room-danger-popup-seen-v1"

/** Max IDs to store in localStorage */
const MAX_POPUP_SEEN_IDS = 200

/** Pages where the overlay should be suppressed */
const SUPPRESSED_PATHS = ["/login", "/verifikasi-email", "/konfirmasi-password", "/ganti-password-pertama"]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readPopupSeenIds(): Set<number> {
  try {
    const raw = localStorage.getItem(POPUP_SEEN_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.map(Number).filter(Number.isFinite))
  } catch {
    return new Set()
  }
}

function writePopupSeenIds(ids: Set<number>) {
  const values = Array.from(ids).slice(-MAX_POPUP_SEEN_IDS)
  try {
    localStorage.setItem(POPUP_SEEN_KEY, JSON.stringify(values))
  } catch {
    // storage might be full; ignore
  }
}

function readDangerSoundState(): { alertId: number; playedAt: number } | null {
  try {
    const raw = localStorage.getItem("server-room-danger-sound-state-v1")
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const alertId = Number(parsed.alertId)
    const playedAt = Number(parsed.playedAt)
    if (!Number.isFinite(alertId) || !Number.isFinite(playedAt)) return null
    return { alertId, playedAt }
  } catch {
    return null
  }
}

function getSensorLabel(sensorId: string): string {
  if (sensorId === "TEMP-L4") return "Lantai 4 (Ruang Server)"
  if (sensorId === "TEMP-L5") return "Lantai 5 (Ruang ATC)"
  return sensorId
}

// ─── Sub-component: single popup card ────────────────────────────────────────

function PopupCard({
  notification,
  onClose,
}: {
  notification: PopupNotification
  onClose: (key: string) => void
}) {
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismiss = useCallback(() => {
    if (exiting) return
    setExiting(true)
    setTimeout(() => onClose(notification.key), 400)
  }, [exiting, notification.key, onClose])

  /* Slide-in on mount */
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  /* Auto-dismiss */
  useEffect(() => {
    timerRef.current = setTimeout(dismiss, AUTO_DISMISS_MS)
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [dismiss])

  const isDanger = notification.level === "Bahaya"

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      style={{
        transform: visible && !exiting ? "translateY(0)" : "translateY(-120%)",
        opacity: visible && !exiting ? 1 : 0,
        transition: "transform 0.4s cubic-bezier(0.34,1.56,0.64,1), opacity 0.35s ease",
        willChange: "transform, opacity",
      }}
      className={[
        "pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded-2xl p-4 shadow-2xl",
        "border backdrop-blur-xl",
        isDanger
          ? "border-rose-500/45 bg-rose-950/95 text-rose-50 dark:border-rose-500/50 dark:bg-slate-950/95"
          : "border-amber-500/45 bg-amber-950/95 text-amber-50 dark:border-amber-500/50 dark:bg-slate-950/95",
      ].join(" ")}
    >
      {/* Flashing warning icon */}
      <div
        className={[
          "grid size-10 shrink-0 place-items-center rounded-xl",
          isDanger
            ? "bg-rose-500/20 text-rose-400"
            : "bg-amber-500/20 text-amber-400",
        ].join(" ")}
        style={{ animation: "danger-icon-blink 1s ease-in-out infinite" }}
      >
        <AlertTriangle className="size-5" />
      </div>

      {/* Text content */}
      <div className="min-w-0 flex-1">
        <p
          className={[
            "text-sm font-bold tracking-wide",
            isDanger ? "text-rose-400 dark:text-rose-300" : "text-amber-500 dark:text-amber-400",
          ].join(" ")}
        >
          {notification.title}
        </p>
        <p
          className="mt-1 text-xs leading-relaxed text-slate-300 dark:text-slate-400"
        >
          {notification.description}
        </p>
      </div>

      {/* Close button */}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Tutup notifikasi"
        className={[
          "grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors",
          isDanger
            ? "text-rose-400 hover:bg-rose-500/10 hover:text-rose-200"
            : "text-amber-400 hover:bg-amber-500/10 hover:text-amber-200",
        ].join(" ")}
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * DangerAlertOverlay
 *
 * Provides two simultaneous visual signals when a "Bahaya" alert is active:
 *
 * 1. **Slide-down popup** — appears from the top of the viewport, auto-dismisses
 *    after `AUTO_DISMISS_MS` ms, can be closed manually.
 *
 * 2. **Viewport red border glow** — a soft inset `box-shadow` on a fixed overlay
 *    that pulses slowly while any Bahaya alert is active.
 *
 * Mount this component once, at the root layout level (next to
 * `AlertNotificationCenter`).
 */
export function DangerAlertOverlay() {
  const pathname = usePathname()

  const [popups, setPopups] = useState<PopupNotification[]>([])
  const [hasDanger, setHasDanger] = useState(false)

  const checkingRef = useRef(false)

  const isSuppressed = SUPPRESSED_PATHS.some(
    p => pathname === p || pathname.startsWith(p + "/"),
  )

  const [isGlowActive, setIsGlowActive] = useState(false)

  // Sync border glow with warning sound playback timing
  useEffect(() => {
    if (!hasDanger || isSuppressed) {
      setIsGlowActive(false)
      return
    }

    const updateGlowStatus = () => {
      const soundState = readDangerSoundState()
      if (!soundState) {
        setIsGlowActive(false)
        return
      }

      const elapsed = Date.now() - soundState.playedAt
      // Sirene berbunyi selama ~10 detik
      const isSoundPlaying = elapsed >= 0 && elapsed < 10000

      setIsGlowActive(isSoundPlaying)
    }

    updateGlowStatus()
    const interval = window.setInterval(updateGlowStatus, 200)

    return () => window.clearInterval(interval)
  }, [hasDanger, isSuppressed])

  const checkAlerts = useCallback(async () => {
    if (isSuppressed || checkingRef.current) return
    checkingRef.current = true

    try {
      const res = await fetch("/api/alerts?status=Aktif&limit=20", {
        cache: "no-store",
      })

      if (res.status === 401) return

      const json = await res.json()

      if (!res.ok || !json.success) return

      const alerts: ActiveAlert[] = (json.data ?? [])
        .map((item: ActiveAlert) => ({
          ...item,
          id: Number(item.id),
          temperature: Number(item.temperature),
        }))
        .filter(
          (item: ActiveAlert) =>
            item.status === "Aktif" &&
            Number.isFinite(item.id) &&
            Number.isFinite(item.temperature),
        )

      // ── Viewport glow: active if any Bahaya alert exists ──────────────
      const dangerAlerts = alerts.filter(a => a.level === "Bahaya")
      setHasDanger(dangerAlerts.length > 0)

      // ── Popups: show once per alert id ────────────────────────────────
      const seenIds = readPopupSeenIds()

      const unseen = alerts.filter(a => !seenIds.has(a.id))

      if (unseen.length > 0) {
        const newPopups: PopupNotification[] = unseen.map(alert => {
          const sensorLabel = getSensorLabel(alert.sensorId)
          const tempStr = Number.isFinite(alert.temperature)
            ? ` (${alert.temperature.toFixed(1)}°C)`
            : ""

          return {
            key: `${alert.id}-${Date.now()}`,
            alertId: alert.id,
            level: alert.level,
            title: alert.title || `⚠️ ${alert.level} Terdeteksi`,
            description:
              alert.detail ||
              `${sensorLabel}${tempStr} — Segera periksa kondisi ruangan.`,
            createdAt: Date.now(),
          }
        })

        // Mark as seen (so popup won't reappear on next poll)
        for (const alert of unseen) seenIds.add(alert.id)

        // Remove IDs for alerts that are no longer active
        const activeIds = new Set(alerts.map(a => a.id))
        for (const id of seenIds) {
          if (!activeIds.has(id)) seenIds.delete(id)
        }

        writePopupSeenIds(seenIds)

        setPopups(prev => [...prev, ...newPopups])
      } else {
        // Prune seenIds for non-active alerts even when there are no unseen ones
        const activeIds = new Set(alerts.map(a => a.id))
        let changed = false
        for (const id of seenIds) {
          if (!activeIds.has(id)) {
            seenIds.delete(id)
            changed = true
          }
        }
        if (changed) writePopupSeenIds(seenIds)
      }
    } catch (err) {
      console.error("DangerAlertOverlay: gagal mengambil peringatan:", err)
    } finally {
      checkingRef.current = false
    }
  }, [isSuppressed])

  const closePopup = useCallback((key: string) => {
    setPopups(prev => prev.filter(p => p.key !== key))
  }, [])

  useEffect(() => {
    if (isSuppressed) return

    void checkAlerts()

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void checkAlerts()
      }
    }, 5_000)

    return () => window.clearInterval(timer)
  }, [checkAlerts, isSuppressed])

  if (isSuppressed) return null

  return (
    <>
      {/* ── Viewport red glow border ──────────────────────────────────── */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[9998]"
        style={{
          border: isGlowActive
            ? "6px solid rgba(239, 68, 68, 0.65)"
            : "6px solid transparent",
          boxShadow: isGlowActive
            ? "inset 0 0 100px 30px rgba(239, 68, 68, 0.55)"
            : "none",
          transition: "border-color 0.8s ease, box-shadow 0.8s ease",
          animation: isGlowActive ? "danger-border-pulse 2.2s ease-in-out infinite" : "none",
        }}
      />

      {/* ── Popup stack ────────────────────────────────────────────────── */}
      {popups.length > 0 && (
        <div
          aria-label="Notifikasi peringatan bahaya"
          className="pointer-events-none fixed inset-x-0 top-6 z-[9999] flex flex-col items-center gap-2 px-4"
        >
          {popups.map(notification => (
            <PopupCard
              key={notification.key}
              notification={notification}
              onClose={closePopup}
            />
          ))}
        </div>
      )}
    </>
  )
}



