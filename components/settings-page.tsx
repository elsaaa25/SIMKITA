"use client"

import {
  useEffect,
  useMemo,
  useState,
} from "react"
import {
  Bell,
  Check,
  Clock3,
  Radio,
  RotateCcw,
  Save,
  Server,
  Thermometer,
  Volume2,
  Zap,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { playAlertSound } from "@/lib/alert-sound"
import {
  defaultMonitoringSettings as defaults,
  type MonitoringSettings as Settings,
} from "@/lib/monitoring-settings"
import { AppShell } from "@/components/app-shell"

type PermissionState =
  | NotificationPermission
  | "unsupported"

export function SettingsPage() {
  const [settings, setSettings] =
    useState<Settings>(defaults)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] =
    useState<{
      type: "success" | "error" | "info"
      message: string
    } | null>(null)
  const [permission, setPermission] = useState<PermissionState>(() => {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
      return "unsupported"
    }
    return Notification.permission
  })

  useEffect(() => {

    const loadSettings = async () => {
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
            "Gagal memuat pengaturan",
          )
        }

        setSettings({
          ...defaults,
          ...json.data,
          warningTemperature: Number(
            json.data.warningTemperature,
          ),
          dangerTemperature: Number(
            json.data.dangerTemperature,
          ),
          warningTemperatureL5: Number(
            json.data.warningTemperatureL5 ?? json.data.warningTemperature ?? defaults.warningTemperatureL5,
          ),
          dangerTemperatureL5: Number(
            json.data.dangerTemperatureL5 ?? json.data.dangerTemperature ?? defaults.dangerTemperatureL5,
          ),
          refreshInterval: Number(
            json.data.refreshInterval,
          ),
          offlineTimeout: Number(
            json.data.offlineTimeout,
          ),
          voltageMin: Number(
            json.data.voltageMin ?? defaults.voltageMin,
          ),
          voltageMax: Number(
            json.data.voltageMax ?? defaults.voltageMax,
          ),
          browserNotification: Boolean(
            json.data.browserNotification,
          ),
          soundAlert: Boolean(
            json.data.soundAlert,
          ),
        })
      } catch (error) {
        console.error(
          "Gagal memuat pengaturan:",
          error,
        )
        setFeedback({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Gagal memuat pengaturan.",
        })
      } finally {
        setLoading(false)
      }
    }

    void loadSettings()
  }, [])

  const update = <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) =>
    setSettings(current => ({
      ...current,
      [key]: value,
    }))

  const valid =
    Number.isFinite(settings.warningTemperature) &&
    Number.isFinite(settings.dangerTemperature) &&
    settings.warningTemperature <
    settings.dangerTemperature &&
    Number.isFinite(settings.warningTemperatureL5) &&
    Number.isFinite(settings.dangerTemperatureL5) &&
    settings.warningTemperatureL5 <
    settings.dangerTemperatureL5 &&
    Number.isFinite(settings.voltageMin) &&
    Number.isFinite(settings.voltageMax) &&
    settings.voltageMin <
    settings.voltageMax

  const permissionLabel = useMemo(() => {
    switch (permission) {
      case "granted":
        return {
          text: "Diizinkan browser",
          className:
            "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
        }
      case "denied":
        return {
          text: "Diblokir browser",
          className:
            "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
        }
      case "unsupported":
        return {
          text: "Tidak didukung",
          className:
            "bg-muted text-muted-foreground",
        }
      default:
        return {
          text: "Belum diizinkan",
          className:
            "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
        }
    }
  }, [permission])

  const requestBrowserNotification =
    async (enabled: boolean) => {
      if (!enabled) {
        update("browserNotification", false)
        return
      }

      if (typeof Notification === "undefined") {
        update("browserNotification", false)
        setPermission("unsupported")
        setFeedback({
          type: "error",
          message:
            "Browser ini tidak mendukung notifikasi desktop.",
        })
        return
      }

      let nextPermission =
        Notification.permission

      if (nextPermission === "default") {
        nextPermission =
          await Notification.requestPermission()
      }

      setPermission(nextPermission)

      if (nextPermission !== "granted") {
        update("browserNotification", false)
        setFeedback({
          type: "error",
          message:
            nextPermission === "denied"
              ? "Izin notifikasi diblokir. Aktifkan kembali melalui ikon izin di sebelah kiri alamat website."
              : "Izin notifikasi belum diberikan.",
        })
        return
      }

      update("browserNotification", true)

      new Notification(
        "Notifikasi monitoring aktif",
        {
          body:
            "Browser akan memberi tahu ketika ada peringatan suhu baru.",
          icon: "/favicon.ico",
          tag: "notification-test",
        },
      )

      setFeedback({
        type: "success",
        message:
          "Tes notifikasi berhasil. Klik Simpan agar pengaturan diterapkan.",
      })
    }

  const toggleSound = async (
    enabled: boolean,
  ) => {
    if (!enabled) {
      update("soundAlert", false)
      return
    }

    try {
      await playAlertSound("preview")
      update("soundAlert", true)
      setFeedback({
        type: "success",
        message:
          "Tes suara berhasil. Alarm akan berbunyi saat ada peringatan Bahaya baru.",
      })
    } catch (error) {
      update("soundAlert", false)
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Browser tidak mengizinkan pemutaran suara.",
      })
    }
  }

  const save = async () => {
    if (!valid || saving) {
      return
    }

    setSaving(true)
    setSaved(false)
    setFeedback(null)

    try {
      const response = await fetch(
        "/api/settings",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(settings),
        },
      )

      const json = await response.json()

      if (!response.ok || !json.success) {
        throw new Error(
          json.error ??
          "Gagal menyimpan pengaturan",
        )
      }

      setSaved(true)
      setFeedback({
        type: "success",
        message:
          "Pengaturan berhasil disimpan ke database PostgreSQL.",
      })

      window.dispatchEvent(
        new CustomEvent(
          "monitoring-settings-changed",
          {
            detail: settings,
          },
        ),
      )

      if (
        typeof BroadcastChannel !== "undefined"
      ) {
        const channel = new BroadcastChannel(
          "server-room-monitoring-settings",
        )
        channel.postMessage({
          type: "settings-updated",
        })
        channel.close()
      }

      window.setTimeout(
        () => setSaved(false),
        2500,
      )
    } catch (error) {
      console.error(
        "Gagal menyimpan pengaturan:",
        error,
      )
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Terjadi kesalahan jaringan.",
      })
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    setSettings(defaults)
    setFeedback({
      type: "info",
      message:
        "Nilai dikembalikan ke bawaan. Klik Simpan untuk menerapkannya.",
    })
  }

  return (
    <AppShell
      title="Pengaturan Sistem"
      description="Konfigurasi batas alarm suhu, interval refresh, dan notifikasi"
      actions={
        <>
          <Button
            variant="outline"
            onClick={reset}
            disabled={loading || saving}
          >
            <RotateCcw className="mr-1 size-4" />
            <span className="hidden sm:inline">
              Reset
            </span>
          </Button>

          <Button
            onClick={() => void save()}
            disabled={!valid || loading || saving}
            className="bg-[#005a9c] hover:bg-[#004579]"
          >
            {saved ? (
              <Check className="mr-1 size-4" />
            ) : (
              <Save className="mr-1 size-4" />
            )}
            {saving
              ? "Menyimpan..."
              : saved
                ? "Tersimpan"
                : "Simpan"}
          </Button>
        </>
      }
    >
      {feedback && (
        <div
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${feedback.type === "success"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
            : feedback.type === "error"
              ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300"
              : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300"
            }`}
        >
          {feedback.message}
        </div>
      )}

      {loading ? (
        <div className="grid min-h-[50vh] place-items-center text-sm text-muted-foreground">
          Memuat konfigurasi sistem dari
          database...
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <SettingsCard
            icon={Thermometer}
            title="Batas Alarm Suhu Lantai 4 (Ruang Server)"
            description="Tentukan ambang batas suhu waspada dan bahaya untuk memicu alarm."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Batas Waspada"
                hint="Status waspada dimulai di atas nilai ini"
              >
                <NumberInput
                  value={
                    settings.warningTemperature
                  }
                  onChange={value =>
                    update(
                      "warningTemperature",
                      value,
                    )
                  }
                  suffix="°C"
                  min={20}
                  max={40}
                />
              </Field>

              <Field
                label="Batas Bahaya"
                hint="Status bahaya dimulai pada nilai ini"
              >
                <NumberInput
                  value={
                    settings.dangerTemperature
                  }
                  onChange={value =>
                    update(
                      "dangerTemperature",
                      value,
                    )
                  }
                  suffix="°C"
                  min={20}
                  max={50}
                />
              </Field>
            </div>

            {!valid && (
              <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">
                Batas bahaya harus lebih
                tinggi dari batas waspada.
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-3 text-xs">
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-950/60">
                Normal ≤{" "}
                {Number(
                  settings.warningTemperature,
                )}
                °C
              </Badge>
              <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-950/60">
                Waspada{" "}
                {Number(
                  settings.warningTemperature,
                )}
                –
                {Number(
                  settings.dangerTemperature,
                )}
                °C
              </Badge>
              <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/60 dark:text-rose-300 dark:hover:bg-rose-950/60">
                Bahaya ≥{" "}
                {Number(
                  settings.dangerTemperature,
                )}
                °C
              </Badge>
            </div>
          </SettingsCard>

          <SettingsCard
            icon={Thermometer}
            title="Batas Alarm Suhu Lantai 5 (Ruang ATC)"
            description="Tentukan ambang batas suhu waspada dan bahaya untuk memicu alarm."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Batas Waspada L5"
                hint="Status waspada L5 dimulai di atas nilai ini"
              >
                <NumberInput
                  value={
                    settings.warningTemperatureL5
                  }
                  onChange={value =>
                    update(
                      "warningTemperatureL5",
                      value,
                    )
                  }
                  suffix="°C"
                  min={20}
                  max={40}
                />
              </Field>

              <Field
                label="Batas Bahaya L5"
                hint="Status bahaya L5 dimulai pada nilai ini"
              >
                <NumberInput
                  value={
                    settings.dangerTemperatureL5
                  }
                  onChange={value =>
                    update(
                      "dangerTemperatureL5",
                      value,
                    )
                  }
                  suffix="°C"
                  min={20}
                  max={50}
                />
              </Field>
            </div>

            {settings.warningTemperatureL5 >= settings.dangerTemperatureL5 && (
              <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">
                Batas bahaya L5 harus lebih
                tinggi dari batas waspada L5.
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-3 text-xs">
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-950/60">
                Normal ≤{" "}
                {Number(
                  settings.warningTemperatureL5,
                )}
                °C
              </Badge>
              <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-950/60">
                Waspada{" "}
                {Number(
                  settings.warningTemperatureL5,
                )}
                –
                {Number(
                  settings.dangerTemperatureL5,
                )}
                °C
              </Badge>
              <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/60 dark:text-rose-300 dark:hover:bg-rose-950/60">
                Bahaya ≥{" "}
                {Number(
                  settings.dangerTemperatureL5,
                )}
                °C
              </Badge>
            </div>
          </SettingsCard>

          <SettingsCard
            icon={Zap}
            title="Batas Pengawasan Tegangan Lantai 4"
            description="Tentukan rentang operasional tegangan listrik AC yang aman untuk memicu status bahaya."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Batas Minimum Tegangan"
                hint="Tegangan di bawah nilai ini statusnya LOW"
              >
                <NumberInput
                  value={settings.voltageMin}
                  onChange={value =>
                    update(
                      "voltageMin",
                      value,
                    )
                  }
                  suffix="V"
                  min={100}
                  max={220}
                />
              </Field>

              <Field
                label="Batas Maksimum Tegangan"
                hint="Tegangan di atas nilai ini statusnya HIGH"
              >
                <NumberInput
                  value={settings.voltageMax}
                  onChange={value =>
                    update(
                      "voltageMax",
                      value,
                    )
                  }
                  suffix="V"
                  min={220}
                  max={300}
                />
              </Field>
            </div>

            {settings.voltageMin >= settings.voltageMax && (
              <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">
                Batas minimum tegangan harus lebih kecil dari batas maksimum.
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-3 text-xs">
              <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-950/60">
                Low &lt; {Number(settings.voltageMin)} V
              </Badge>
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-950/60">
                Normal {Number(settings.voltageMin)} – {Number(settings.voltageMax)} V
              </Badge>
              <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/60 dark:text-rose-300 dark:hover:bg-rose-950/60">
                High &gt; {Number(settings.voltageMax)} V
              </Badge>
            </div>
          </SettingsCard>

          <SettingsCard
            icon={Clock3}
            title="Pembaruan Data & Offline"
            description="Atur kecepatan refresh dashboard dan batas toleransi sensor sebelum dianggap mati."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Interval Refresh Dashboard"
                hint="Disarankan antara 3–5 detik"
              >
                <NumberInput
                  value={settings.refreshInterval}
                  onChange={value =>
                    update(
                      "refreshInterval",
                      value,
                    )
                  }
                  suffix="detik"
                  min={3}
                  max={60}
                />
              </Field>

              <Field
                label="Batas Offline Sensor"
                hint="Dianggap mati jika tidak ada data baru dalam durasi ini"
              >
                <NumberInput
                  value={settings.offlineTimeout}
                  onChange={value =>
                    update(
                      "offlineTimeout",
                      value,
                    )
                  }
                  suffix="detik"
                  min={10}
                  max={300}
                />
              </Field>
            </div>
          </SettingsCard>

          <SettingsCard
            icon={Radio}
            title="Perangkat Sensor ESP32"
            description="Pengaturan identitas sensor utama untuk validasi payload."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nama Perangkat">
                <TextInput
                  value={settings.sensorName}
                  onChange={value =>
                    update("sensorName", value)
                  }
                />
              </Field>

              <Field
                label="Sensor ID Utama"
                hint="Harus sama dengan nama ID sensor di hardware ESP32"
              >
                <TextInput
                  value={settings.sensorId}
                  onChange={value =>
                    update("sensorId", value)
                  }
                  mono
                />
              </Field>
            </div>

            <Separator className="my-5" />

            <div className="flex items-center">
              <div className="grid size-10 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                <Server className="size-5" />
              </div>
              <div className="ml-3">
                <b className="block text-sm text-foreground">
                  Koneksi Database Cloud
                </b>
                <span className="text-xs text-muted-foreground">
                  Penyimpanan Terpusat
                  Supabase
                </span>
              </div>
              <Badge className="ml-auto bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-950/60">
                Aktif
              </Badge>
            </div>
          </SettingsCard>

          <SettingsCard
            icon={Bell}
            title="Pusat Peringatan & Suara"
            description="Aktifkan notifikasi browser atau alarm suara saat ada kejadian suhu baru."
          >
            <Toggle
              icon={Bell}
              label="Notifikasi Desktop/Browser"
              description="Notifikasi muncul ketika ada kejadian Waspada atau Bahaya baru."
              checked={
                settings.browserNotification
              }
              onChange={value =>
                void requestBrowserNotification(
                  value,
                )
              }
              disabled={
                permission === "unsupported" ||
                permission === "denied"
              }
              status={
                <Badge
                  className={
                    permissionLabel.className
                  }
                >
                  {permissionLabel.text}
                </Badge>
              }
            />

            <Separator className="my-2" />

            <Toggle
              icon={Volume2}
              label="Alarm Suara Peringatan"
              description="Alarm berbunyi satu kali ketika peringatan baru mencapai level Bahaya."
              checked={settings.soundAlert}
              onChange={value =>
                void toggleSound(value)
              }
              status={
                <Badge
                  className={
                    settings.soundAlert
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                      : "bg-muted text-muted-foreground"
                  }
                >
                  {settings.soundAlert
                    ? "Aktif"
                    : "Nonaktif"}
                </Badge>
              }
            />
          </SettingsCard>
        </div>
      )}

      <p className="mt-5 text-center text-xs text-muted-foreground">
        Setelah mengubah toggle, klik
        Simpan. Notifikasi dan suara bekerja
        selama website monitoring terbuka di
        browser.
      </p>
    </AppShell>
  )
}

function SettingsCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Card className="border-border/60 bg-card shadow-sm">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Icon className="size-5" />
          </div>
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription className="mt-1">
              {description}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-foreground">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1.5 block text-[11px] leading-tight text-muted-foreground/80">
          {hint}
        </span>
      )}
    </label>
  )
}

function NumberInput({
  value,
  onChange,
  suffix,
  min,
  max,
}: {
  value: number
  onChange: (value: number) => void
  suffix: string
  min: number
  max: number
}) {
  return (
    <div className="flex h-10 overflow-hidden rounded-xl border border-border bg-card focus-within:ring-2 focus-within:ring-primary/20">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={event =>
          onChange(Number(event.target.value))
        }
        className="min-w-0 flex-1 bg-transparent px-3 font-medium text-foreground outline-none"
      />
      <span className="grid place-items-center border-l border-border bg-muted px-3 text-xs font-medium text-muted-foreground">
        {suffix}
      </span>
    </div>
  )
}

function TextInput({
  mono = false,
  value,
  onChange,
}: {
  mono?: boolean
  value: string
  onChange: (value: string) => void
}) {
  return (
    <input
      value={value}
      onChange={event =>
        onChange(event.target.value)
      }
      className={`h-10 w-full rounded-xl border border-border bg-card px-3 font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/20 ${mono ? "font-mono text-sm" : ""
        }`}
    />
  )
}

function Toggle({
  icon: Icon,
  label,
  description,
  checked,
  onChange,
  disabled = false,
  status,
}: {
  icon: React.ElementType
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  status?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-4 py-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 ${checked
          ? "bg-primary"
          : "bg-muted"
          }`}
      >
        <span
          className={`absolute top-1 size-4 rounded-full bg-background dark:bg-foreground shadow transition-all ${checked ? "left-6" : "left-1"
            }`}
        />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <b className="text-sm text-foreground">
            {label}
          </b>
          {status}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  )
}
