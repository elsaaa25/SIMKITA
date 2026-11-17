"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  Clock3,
  Filter,
  Radio,
  Search,
  ShieldAlert,
  Thermometer,
  Zap,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  defaultMonitoringSettings,
  type MonitoringSettings,
} from "@/lib/monitoring-settings"
import { AppShell } from "@/components/app-shell"
import { AnimatedTabsNoIcon } from "@/components/shadcn-space/tabs/tabs-08"

type Level = "Waspada" | "Bahaya"
type AlertStatus = "Aktif" | "Ditangani"
type SensorFilter = "Semua" | "Lantai 4" | "Lantai 5"

type AlertItem = {
  id: number
  type?: "temperature" | "voltage"
  level: Level
  status: AlertStatus
  temperature: number | null
  voltage: number | null
  sensorId: string
  createdAt: string
  acknowledgedAt: string | null
  resolvedAt: string | null
  handledByName: string | null
  title: string
  detail: string
}

const SENSOR_L4 = "TEMP-L4"
const SENSOR_L5 = "TEMP-L5"

const dateTime = (value: string) => {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date)
}

const sensorLabel = (sensorId: string) => {
  if (sensorId === SENSOR_L4) {
    return "Lantai 4 (Ruang Server)"
  }

  if (sensorId === SENSOR_L5) {
    return "Lantai 5"
  }

  return sensorId
}

const sensorShortLabel = (sensorId: string) => {
  if (sensorId === SENSOR_L4) {
    return "Lantai 4"
  }

  if (sensorId === SENSOR_L5) {
    return "Lantai 5"
  }

  return sensorId
}

export function AlertsPage() {
  const [settings, setSettings] =
    useState<MonitoringSettings>(
      defaultMonitoringSettings,
    )
  const [alerts, setAlerts] =
    useState<AlertItem[]>([])
  const [level, setLevel] =
    useState<"Semua" | Level>("Semua")
  const [status, setStatus] =
    useState<"Semua" | AlertStatus>("Semua")
  const [sensor, setSensor] =
    useState<SensorFilter>("Semua")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] =
    useState<string | null>(null)
  const [actionId, setActionId] =
    useState<number | "all" | null>(null)

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch("/api/settings", {
        cache: "no-store",
      })

      const json = await response.json()

      if (response.ok && json.success) {
        setSettings(json.data)
      }
    } catch (fetchError) {
      console.error(
        "Gagal mengambil pengaturan:",
        fetchError,
      )
    }
  }, [])

  const fetchAlerts = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true)
      }

      try {
        const response = await fetch(
          "/api/alerts?limit=200",
          {
            cache: "no-store",
          },
        )
        const json = await response.json()

        if (!response.ok || !json.success) {
          throw new Error(
            json.error ??
              "Gagal mengambil data peringatan",
          )
        }

        const normalized: AlertItem[] = (
          json.data ?? []
        ).map((item: AlertItem) => ({
          ...item,
          id: Number(item.id),
          type: item.type === "voltage" ? "voltage" : "temperature",
          temperature:
            item.temperature !== null && item.temperature !== undefined
              ? Number(item.temperature)
              : null,
          voltage:
            item.voltage !== null && item.voltage !== undefined
              ? Number(item.voltage)
              : null,
        }))

        setAlerts(normalized)
        setError(null)
      } catch (fetchError) {
        console.error(
          "Gagal mengambil peringatan:",
          fetchError,
        )
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Gagal mengambil data peringatan",
        )
      } finally {
        if (!silent) {
          setLoading(false)
        }
      }
    },
    [],
  )

  useEffect(() => {
    const timerId = window.setTimeout(
      () => {
        void fetchSettings()
        void fetchAlerts()
      },
      0,
    )

    return () => {
      window.clearTimeout(timerId)
    }
  }, [fetchAlerts, fetchSettings])

  useEffect(() => {
    const intervalSeconds = Math.max(
      Number(settings.refreshInterval) || 5,
      5,
    )

    const timer = window.setInterval(() => {
      void fetchAlerts(true)
    }, intervalSeconds * 1000)

    return () => window.clearInterval(timer)
  }, [fetchAlerts, settings.refreshInterval])

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()

    return alerts.filter(item => {
      const matchesLevel =
        level === "Semua" || item.level === level
      const matchesStatus =
        status === "Semua" ||
        item.status === status
      const matchesSensor =
        sensor === "Semua" ||
        (sensor === "Lantai 4" &&
          item.sensorId === SENSOR_L4) ||
        (sensor === "Lantai 5" &&
          item.sensorId === SENSOR_L5)
      const searchableText = [
        item.title,
        item.detail,
        item.sensorId,
        item.type === "voltage" ? "tegangan" : "suhu",
        sensorLabel(item.sensorId),
        sensorShortLabel(item.sensorId),
      ]
        .join(" ")
        .toLowerCase()

      return (
        matchesLevel &&
        matchesStatus &&
        matchesSensor &&
        searchableText.includes(keyword)
      )
    })
  }, [alerts, level, search, sensor, status])

  const active = alerts.filter(
    item => item.status === "Aktif",
  ).length
  const danger = alerts.filter(
    item =>
      item.level === "Bahaya" &&
      item.status === "Aktif",
  ).length
  const activeL4 = alerts.filter(
    item =>
      item.sensorId === SENSOR_L4 &&
      item.status === "Aktif",
  ).length
  const activeL5 = alerts.filter(
    item =>
      item.sensorId === SENSOR_L5 &&
      item.status === "Aktif",
  ).length
  const handled = alerts.filter(
    item => item.status === "Ditangani",
  ).length

  const acknowledge = async (id: number, type?: "temperature" | "voltage") => {
    setActionId(id)

    try {
      const response = await fetch("/api/alerts", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id, type }),
      })
      const json = await response.json()

      if (!response.ok || !json.success) {
        throw new Error(
          json.error ??
            "Gagal menangani peringatan",
        )
      }

      await fetchAlerts(true)
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Gagal menangani peringatan",
      )
    } finally {
      setActionId(null)
    }
  }

  const acknowledgeAll = async () => {
    setActionId("all")

    try {
      const response = await fetch("/api/alerts", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ all: true }),
      })
      const json = await response.json()

      if (!response.ok || !json.success) {
        throw new Error(
          json.error ??
            "Gagal menangani semua peringatan",
        )
      }

      await fetchAlerts(true)
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Gagal menangani semua peringatan",
      )
    } finally {
      setActionId(null)
    }
  }

  return (
    <AppShell
      title="Peringatan"
      description="Pantau dan tindak lanjuti peringatan suhu dan tegangan Lantai 4 dan Lantai 5"
      actions={
        <Button
          variant="outline"
          disabled={
            active === 0 || actionId !== null
          }
          onClick={() => void acknowledgeAll()}
        >
          <Check />
          {actionId === "all"
            ? "Memproses..."
            : "Tandai Semua Ditangani"}
        </Button>
      }
    >
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <Summary
            icon={Bell}
            label="Peringatan Aktif"
            value={active}
            color="amber"
          />
          <Summary
            icon={ShieldAlert}
            label="Bahaya Aktif"
            value={danger}
            color="rose"
          />
          <Summary
            icon={Radio}
            label="Aktif Lantai 4"
            value={activeL4}
            color="green"
          />
          <Summary
            icon={Radio}
            label="Aktif Lantai 5"
            value={activeL5}
            color="blue"
          />
          <Summary
            icon={CheckCircle2}
            label="Sudah Ditangani"
            value={handled}
            color="green"
          />
          <Summary
            icon={Thermometer}
            label="Batas Parameter"
            value={`L4: ${Number(settings.warningTemperature)}°C | Volt: ${Number(settings.voltageMin ?? 200)}–${Number(settings.voltageMax ?? 240)}V`}
            color="blue"
          />
        </section>

        <Card className="mt-6">
          <CardHeader className="gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-sm font-semibold">
                Daftar Peringatan
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {filtered.length} kejadian
              </span>
            </div>

            <div className="grid gap-3 2xl:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
              <label className="flex h-10 min-w-0 items-center gap-2 rounded-xl border border-border bg-card px-3 transition-shadow focus-within:ring-2 focus-within:ring-primary/20">
                <Search className="size-4 text-muted-foreground" />
                <input
                  value={search}
                  onChange={event =>
                    setSearch(event.target.value)
                  }
                  placeholder="Cari peringatan atau sensor..."
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
              </label>

              <FilterGroup
                showIcon
                indicatorId="alert-status-tabs"
                values={[
                  "Semua",
                  "Aktif",
                  "Ditangani",
                ]}
                active={status}
                onChange={value =>
                  setStatus(
                    value as
                      | "Semua"
                      | AlertStatus,
                  )
                }
              />
              <FilterGroup
                indicatorId="alert-level-tabs"
                values={[
                  "Semua",
                  "Waspada",
                  "Bahaya",
                ]}
                active={level}
                onChange={value =>
                  setLevel(
                    value as "Semua" | Level,
                  )
                }
              />
              <FilterGroup
                indicatorId="alert-sensor-tabs"
                values={[
                  "Semua",
                  "Lantai 4",
                  "Lantai 5",
                ]}
                active={sensor}
                onChange={value =>
                  setSensor(
                    value as SensorFilter,
                  )
                }
              />
            </div>
          </CardHeader>

          <CardContent className="space-y-3">
            {error && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
                <span>{error}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void fetchAlerts()
                  }
                >
                  Coba Lagi
                </Button>
              </div>
            )}

            {loading ? (
              <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">
                Mengambil data peringatan...
              </div>
            ) : filtered.length > 0 ? (
              filtered.map(item => (
                <AlertRow
                  key={`${item.type ?? "temp"}-${item.id}`}
                  item={item}
                  processing={actionId === item.id}
                  onAcknowledge={() =>
                    void acknowledge(item.id, item.type)
                  }
                />
              ))
            ) : (
              <div className="grid min-h-48 place-items-center rounded-xl border border-dashed text-center text-sm text-muted-foreground">
                Tidak ada peringatan yang sesuai.
              </div>
            )}
          </CardContent>
        </Card>
    </AppShell>
  )
}

function AlertRow({
  item,
  processing,
  onAcknowledge,
}: {
  item: AlertItem
  processing: boolean
  onAcknowledge: () => void
}) {
  const visual = {
    Bahaya: {
      icon: ShieldAlert,
      box: "border-rose-200 bg-rose-50/40 dark:border-rose-900/60 dark:bg-rose-950/20",
      bubble: "bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400",
      badge: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
    },
    Waspada: {
      icon: AlertTriangle,
      box: "border-amber-200 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20",
      bubble: "bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400",
      badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
    },
  }[item.level]

  const Icon = visual.icon

  return (
    <div
      className={`rounded-2xl border p-4 ${visual.box}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div
          className={`grid size-11 shrink-0 place-items-center rounded-full ${visual.bubble}`}
        >
          <Icon className="size-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-foreground">
              {item.title}
            </h3>
            <Badge
              variant="secondary"
              className={visual.badge}
            >
              {item.level}
            </Badge>
            <Badge
              variant="secondary"
              className={
                item.sensorId === SENSOR_L5
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
              }
            >
              {sensorShortLabel(item.sensorId)}
            </Badge>
            {item.type === "voltage" && (
              <Badge
                variant="secondary"
                className="bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300/60 dark:border-amber-800"
              >
                Tegangan Listrik
              </Badge>
            )}
            {item.status === "Ditangani" && (
              <Badge
                variant="secondary"
                className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
              >
                Ditangani
              </Badge>
            )}
          </div>

          <p className="mt-1 text-sm text-muted-foreground">
            {item.detail}
          </p>

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            {item.type === "voltage" || (item.voltage !== null && Number.isFinite(item.voltage)) ? (
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <Zap className="size-3.5 text-amber-500" />
                {item.voltage != null ? item.voltage.toFixed(1) : "-"} V AC
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Thermometer className="size-3.5" />
                {item.temperature != null ? item.temperature.toFixed(2) : "-"}°C
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Radio className="size-3.5" />
              {sensorLabel(item.sensorId)} ({item.sensorId})
            </span>
            <span className="flex items-center gap-1.5">
              <Clock3 className="size-3.5" />
              {dateTime(item.createdAt)} WIB
            </span>
          </div>

          {item.status === "Ditangani" &&
            item.handledByName && (
              <p className="mt-2 text-xs text-muted-foreground">
                Ditangani oleh {item.handledByName}
              </p>
            )}

          {item.resolvedAt && (
            <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
              {item.type === "voltage"
                ? `Tegangan kembali normal pada ${dateTime(item.resolvedAt)} WIB`
                : `Suhu kembali normal pada ${dateTime(item.resolvedAt)} WIB`}
            </p>
          )}
        </div>

        {item.status === "Aktif" && (
          <Button
            size="sm"
            disabled={processing}
            onClick={onAcknowledge}
          >
            <Check />
            {processing
              ? "Memproses..."
              : "Tangani"}
          </Button>
        )}
      </div>
    </div>
  )
}

function Summary({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Bell
  label: string
  value: number | string
  color:
    | "amber"
    | "rose"
    | "green"
    | "blue"
}) {
  const styles = {
    amber: "bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400",
    rose: "bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400",
    green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400",
    blue: "bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400",
  }

  return (
    <Card>
      <CardContent className="flex min-h-28 items-center gap-4 p-5">
        <span
          className={`grid size-12 place-items-center rounded-full ${styles[color]}`}
        >
          <Icon className="size-5" />
        </span>
        <span>
          <small className="block text-xs text-muted-foreground">
            {label}
          </small>
          <b className="text-xl text-foreground">
            {value}
          </b>
        </span>
      </CardContent>
    </Card>
  )
}

function FilterGroup({
  values,
  active,
  onChange,
  showIcon = false,
  indicatorId = "alert-filter-group",
}: {
  values: string[]
  active: string
  onChange: (value: string) => void
  showIcon?: boolean
  indicatorId?: string
}) {
  const tabs = values.map((val) => ({ value: val, label: val }))
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {showIcon && (
        <Filter className="ml-1 size-4 shrink-0 text-muted-foreground" />
      )}
      <AnimatedTabsNoIcon
        tabs={tabs}
        value={active}
        onValueChange={onChange}
        indicatorId={indicatorId}
      />
    </div>
  )
}