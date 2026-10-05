"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { usePathname, useRouter } from "next/navigation"

import {
  playAlertSound,
  unlockAlertAudio,
} from "@/lib/alert-sound"

import {
  defaultMonitoringSettings,
  type MonitoringSettings,
} from "@/lib/monitoring-settings"

type ActiveAlert = {
  id: number
  level: "Waspada" | "Bahaya"
  status: "Aktif" | "Ditangani"
  temperature: number
  sensorId: string
  title: string
  detail: string
  createdAt: string
}

type DangerSoundState = {
  alertId: number
  playedAt: number
}

const SEEN_ALERTS_KEY =
  "server-room-seen-alert-ids-v3"

const DANGER_SOUND_STATE_KEY =
  "server-room-danger-sound-state-v1"

const MAX_SEEN_IDS = 100

// Alarm berbunyi ulang setiap 30 detik
// selama peringatan Bahaya masih aktif.
const DANGER_SOUND_REPEAT_MS = 30_000

function normalizeSettings(
  data: Partial<MonitoringSettings>,
): MonitoringSettings {
  return {
    ...defaultMonitoringSettings,
    ...data,

    warningTemperature: Number(
      data.warningTemperature ??
        defaultMonitoringSettings.warningTemperature,
    ),

    dangerTemperature: Number(
      data.dangerTemperature ??
        defaultMonitoringSettings.dangerTemperature,
    ),

    warningTemperatureL5: Number(
      data.warningTemperatureL5 ??
        defaultMonitoringSettings.warningTemperatureL5,
    ),

    dangerTemperatureL5: Number(
      data.dangerTemperatureL5 ??
        defaultMonitoringSettings.dangerTemperatureL5,
    ),

    refreshInterval: Number(
      data.refreshInterval ??
        defaultMonitoringSettings.refreshInterval,
    ),

    offlineTimeout: Number(
      data.offlineTimeout ??
        defaultMonitoringSettings.offlineTimeout,
    ),

    browserNotification: Boolean(
      data.browserNotification,
    ),

    soundAlert: Boolean(data.soundAlert),
  }
}

function readSeenAlertIds(): Set<number> {
  try {
    const stored =
      localStorage.getItem(SEEN_ALERTS_KEY)

    const parsed: unknown = stored
      ? JSON.parse(stored)
      : []

    if (!Array.isArray(parsed)) {
      return new Set<number>()
    }

    return new Set(
      parsed
        .map(Number)
        .filter(Number.isFinite),
    )
  } catch {
    return new Set<number>()
  }
}

function writeSeenAlertIds(
  ids: Set<number>,
) {
  const values = Array.from(ids).slice(
    -MAX_SEEN_IDS,
  )

  localStorage.setItem(
    SEEN_ALERTS_KEY,
    JSON.stringify(values),
  )
}

function readDangerSoundState():
  | DangerSoundState
  | null {
  try {
    const stored = localStorage.getItem(
      DANGER_SOUND_STATE_KEY,
    )

    if (!stored) {
      return null
    }

    const parsed = JSON.parse(
      stored,
    ) as Partial<DangerSoundState>

    const alertId = Number(parsed.alertId)
    const playedAt = Number(parsed.playedAt)

    if (
      !Number.isFinite(alertId) ||
      !Number.isFinite(playedAt)
    ) {
      return null
    }

    return {
      alertId,
      playedAt,
    }
  } catch {
    return null
  }
}

function writeDangerSoundState(
  state: DangerSoundState,
) {
  localStorage.setItem(
    DANGER_SOUND_STATE_KEY,
    JSON.stringify(state),
  )
}

function clearDangerSoundState() {
  localStorage.removeItem(
    DANGER_SOUND_STATE_KEY,
  )
}

function showBrowserNotification(
  alert: ActiveAlert,
  onNavigate?: () => void,
): boolean {
  if (
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return false
  }

  const notification = new Notification(
    alert.title,
    {
      body:
        `${alert.temperature.toFixed(2)}°C — ` +
        alert.detail,

      icon: "/favicon.ico",

      tag: `temperature-alert-${alert.id}`,
    },
  )

  notification.onclick = () => {
    window.focus()
    if (onNavigate) {
      onNavigate()
    } else {
      window.location.assign("/peringatan")
    }
    notification.close()
  }

  return true
}

export function AlertNotificationCenter() {
  const pathname = usePathname()
  const router = useRouter()

  const [settings, setSettings] =
    useState<MonitoringSettings>(
      defaultMonitoringSettings,
    )

  const [settingsReady, setSettingsReady] =
    useState(false)

  const checkingRef = useRef(false)

  const loadSettings =
    useCallback(async () => {
      try {
        const response = await fetch(
          "/api/settings",
          {
            cache: "no-store",
          },
        )

        const json = await response.json()

        if (!response.ok || !json.success) {
          throw new Error(
            json.error ??
              "Gagal mengambil pengaturan",
          )
        }

        setSettings(
          normalizeSettings(json.data),
        )

        setSettingsReady(true)
      } catch (error) {
        console.error(
          "Gagal mengambil pengaturan notifikasi:",
          error,
        )
      }
    }, [])

  const checkActiveAlerts =
    useCallback(async () => {
      if (
        !settingsReady ||
        checkingRef.current
      ) {
        return
      }

      checkingRef.current = true

      try {
        const response = await fetch(
          "/api/alerts?status=Aktif&limit=20",
          {
            cache: "no-store",
          },
        )

        if (response.status === 401) {
          return
        }

        const json = await response.json()

        if (!response.ok || !json.success) {
          throw new Error(
            json.error ??
              "Gagal mengambil peringatan",
          )
        }

        const alerts: ActiveAlert[] = (
          json.data ?? []
        )
          .map((item: ActiveAlert) => ({
            ...item,

            id: Number(item.id),

            temperature: Number(
              item.temperature,
            ),
          }))
          .filter(
            (item: ActiveAlert) =>
              item.status === "Aktif" &&
              Number.isFinite(item.id) &&
              Number.isFinite(
                item.temperature,
              ),
          )

        /*
         * BAGIAN NOTIFIKASI BROWSER
         *
         * Notifikasi hanya muncul satu kali
         * untuk setiap ID peringatan.
         */
        const activeIds = new Set(
          alerts.map(alert => alert.id),
        )

        const seenIds =
          readSeenAlertIds()

        // Hapus ID yang sudah tidak aktif.
        for (const id of seenIds) {
          if (!activeIds.has(id)) {
            seenIds.delete(id)
          }
        }

        const newAlerts = alerts
          .filter(
            alert =>
              !seenIds.has(alert.id),
          )
          .reverse()

        for (const alert of newAlerts) {
          if (
            settings.browserNotification
          ) {
            showBrowserNotification(alert, () => router.push("/peringatan"))
          }

          /*
           * Setelah diperiksa, tandai ID
           * supaya notifikasi browser tidak
           * muncul terus-menerus.
           */
          seenIds.add(alert.id)
        }

        writeSeenAlertIds(seenIds)

        /*
         * BAGIAN ALARM SUARA
         *
         * Ambil peringatan Bahaya aktif terbaru.
         */
        const activeDanger = alerts.find(
          alert =>
            alert.level === "Bahaya" &&
            alert.status === "Aktif",
        )

        if (
          settings.soundAlert &&
          activeDanger
        ) {
          const currentTime = Date.now()

          const previousState =
            readDangerSoundState()

          const isDifferentAlert =
            previousState?.alertId !==
            activeDanger.id

          const repeatTimeReached =
            !previousState ||
            currentTime -
              previousState.playedAt >=
              DANGER_SOUND_REPEAT_MS

          /*
           * Bahaya baru langsung berbunyi.
           * Bahaya yang masih aktif berbunyi
           * kembali setiap 30 detik.
           */
          if (
            isDifferentAlert ||
            repeatTimeReached
          ) {
            try {
              await playAlertSound(
                "danger",
              )

              writeDangerSoundState({
                alertId: activeDanger.id,
                playedAt: currentTime,
              })
            } catch (error) {
              console.warn(
                "Alarm suara diblokir browser:",
                error,
              )
            }
          }
        } else {
          /*
           * Ketika tidak ada Bahaya aktif,
           * reset timer alarm.
           *
           * Bahaya berikutnya akan langsung
           * berbunyi lagi.
           */
          clearDangerSoundState()
        }
      } catch (error) {
        console.error(
          "Gagal memeriksa peringatan aktif:",
          error,
        )
      } finally {
        checkingRef.current = false
      }
    }, [
      settings.browserNotification,
      settings.soundAlert,
      settingsReady,
    ])

  /*
   * Membuka akses Web Audio setelah pengguna
   * melakukan klik atau menekan tombol.
   *
   * Tidak membunyikan suara ketika membuka akses.
   */
  useEffect(() => {
    if (pathname === "/login") {
      return
    }

    const unlockAudio = () => {
      void unlockAlertAudio().catch(
        error => {
          console.warn(
            "Belum dapat membuka akses audio:",
            error,
          )
        },
      )
    }

    window.addEventListener(
      "pointerdown",
      unlockAudio,
      { once: true },
    )

    window.addEventListener(
      "keydown",
      unlockAudio,
      { once: true },
    )

    return () => {
      window.removeEventListener(
        "pointerdown",
        unlockAudio,
      )

      window.removeEventListener(
        "keydown",
        unlockAudio,
      )
    }
  }, [pathname])

  /*
   * Mengambil pengaturan dari database.
   */
  useEffect(() => {
    if (pathname === "/login") {
      return
    }

    void loadSettings()

    const settingsTimer =
      window.setInterval(
        () => void loadSettings(),
        30_000,
      )

    const handleSettingsChanged = (
      event: Event,
    ) => {
      const customEvent =
        event as CustomEvent<
          MonitoringSettings
        >

      if (customEvent.detail) {
        setSettings(
          normalizeSettings(
            customEvent.detail,
          ),
        )

        setSettingsReady(true)
      } else {
        void loadSettings()
      }
    }

    window.addEventListener(
      "monitoring-settings-changed",
      handleSettingsChanged,
    )

    const channel =
      typeof BroadcastChannel !==
      "undefined"
        ? new BroadcastChannel(
            "server-room-monitoring-settings",
          )
        : null

    channel?.addEventListener(
      "message",
      () => {
        void loadSettings()
      },
    )

    return () => {
      window.clearInterval(
        settingsTimer,
      )

      window.removeEventListener(
        "monitoring-settings-changed",
        handleSettingsChanged,
      )

      channel?.close()
    }
  }, [loadSettings, pathname])

  /*
   * Memeriksa peringatan secara berkala.
   */
  useEffect(() => {
    if (
      pathname === "/login" ||
      !settingsReady
    ) {
      return
    }

    void checkActiveAlerts()

    const intervalSeconds = Math.min(
      Math.max(
        Number(
          settings.refreshInterval,
        ) || 5,
        3,
      ),
      60,
    )

    const alertTimer =
      window.setInterval(
        () => {
          void checkActiveAlerts()
        },
        intervalSeconds * 1000,
      )

    return () => {
      window.clearInterval(alertTimer)
    }
  }, [
    checkActiveAlerts,
    pathname,
    settings.refreshInterval,
    settingsReady,
  ])

  return null
}