"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { useSession } from "next-auth/react"
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  Save,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react"

import { AppShell } from "@/components/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type ProfileData = {
  id: string
  name: string
  email: string
  role: string
}

type ApiResponse = {
  success?: boolean
  message?: string
  data?: ProfileData
}

type Feedback = {
  type: "success" | "error"
  message: string
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

function PasswordInput({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
}) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-semibold text-foreground">
        {label}
      </label>
      <div className="relative">
        <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={event => onChange(event.target.value)}
          autoComplete={autoComplete}
          required
          maxLength={128}
          className="rounded-xl px-9"
        />
        <button
          type="button"
          onClick={() => setVisible(current => !current)}
          className="absolute right-3 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={visible ? `Sembunyikan ${label.toLowerCase()}` : `Tampilkan ${label.toLowerCase()}`}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
  )
}

export function ProfilePage() {
  const { update: updateSession } = useSession()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  useEffect(() => {
    let active = true

    async function loadProfile() {
      try {
        const response = await fetch("/api/account/profile", { cache: "no-store" })
        const result = (await response.json()) as ApiResponse

        if (!active) return

        if (response.ok && result.success && result.data) {
          setProfile(result.data)
          setName(result.data.name)
        } else {
          setFeedback({
            type: "error",
            message: result.message ?? "Gagal mengambil data profil.",
          })
        }
      } catch {
        if (active) {
          setFeedback({
            type: "error",
            message: "Koneksi terputus. Gagal mengambil profil.",
          })
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadProfile()
    return () => {
      active = false
    }
  }, [])

  const normalizedName = name.replace(/\s+/g, " ").trim()
  const profileChanged = Boolean(profile && normalizedName !== profile.name)
  const passwordChecks = useMemo(
    () => [
      { label: "Minimal 12 karakter", valid: newPassword.length >= 12 },
      {
        label: "Huruf besar dan kecil",
        valid: /[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword),
      },
      { label: "Angka", valid: /[0-9]/.test(newPassword) },
      { label: "Karakter khusus", valid: /[^A-Za-z0-9]/.test(newPassword) },
    ],
    [newPassword],
  )
  const passwordValid =
    currentPassword.length > 0 &&
    passwordChecks.every(check => check.valid) &&
    newPassword === confirmPassword

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (normalizedName.length < 2 || !profileChanged) return

    setSaving(true)
    setFeedback(null)

    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: normalizedName }),
      })
      const result = (await response.json()) as ApiResponse

      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.message ?? "Gagal memperbarui profil.")
      }

      setProfile(result.data)
      setName(result.data.name)
      await updateSession({})
      setFeedback({
        type: "success",
        message: result.message ?? "Profil berhasil disimpan.",
      })
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error
          ? error.message
          : "Gagal terhubung ke server untuk menyimpan profil.",
      })
    } finally {
      setSaving(false)
    }
  }

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!passwordValid) return

    setChangingPassword(true)
    setFeedback(null)

    try {
      const response = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      })
      const result = (await response.json()) as ApiResponse

      if (!response.ok || !result.success) {
        throw new Error(result.message ?? "Gagal memproses perubahan password.")
      }

      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setFeedback({
        type: "success",
        message: result.message ?? "Tautan konfirmasi telah dikirim ke email Anda.",
      })
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error
          ? error.message
          : "Gagal terhubung ke server untuk mengubah password.",
      })
    } finally {
      setChangingPassword(false)
    }
  }

  return (
    <AppShell
      title="Profil Pengguna"
      description="Kelola identitas dan keamanan akun monitoring Anda."
    >
      {feedback && (
        <div
          role="status"
          className={`flex items-start justify-between gap-4 rounded-2xl border p-4 text-sm shadow-sm ${
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300"
              : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300"
          }`}
        >
          <div className="flex items-start gap-3">
            {feedback.type === "success" ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
            ) : (
              <X className="mt-0.5 size-5 shrink-0" />
            )}
            <p className="font-medium leading-relaxed">{feedback.message}</p>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="grid size-7 shrink-0 place-items-center rounded-lg transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/30 dark:hover:bg-white/10"
            aria-label="Tutup pemberitahuan"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="grid min-h-[45vh] place-items-center text-sm text-muted-foreground">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-7 animate-spin text-primary" />
            <span>Memuat informasi profil...</span>
          </div>
        </div>
      ) : profile ? (
        <div className="grid max-w-6xl gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
          <div className="space-y-6">
            <Card className="overflow-hidden rounded-2xl border-border/70 bg-card shadow-sm">
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
                <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-[#005A9C] text-xl font-extrabold text-white shadow-sm">
                  {getInitials(profile.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xl font-bold tracking-tight text-foreground">
                    {profile.name}
                  </p>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {profile.email}
                  </p>
                  <Badge
                    variant="outline"
                    className="mt-3 border-blue-200 bg-blue-50 text-[10px] font-bold uppercase text-[#005A9C] dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300"
                  >
                    <ShieldCheck className="mr-1 size-3" />
                    {profile.role}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-border/70 bg-card shadow-sm">
              <CardHeader className="border-b border-border/60">
                <div className="flex items-start gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <UserRound className="size-5" />
                  </div>
                  <div>
                    <CardTitle>Informasi Profil</CardTitle>
                    <CardDescription className="mt-1">
                      Nama digunakan pada dashboard, aktivitas, dan laporan.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-5 sm:p-6">
                <form onSubmit={handleSave} className="space-y-5">
                  <div className="space-y-2">
                    <label htmlFor="name" className="block text-sm font-semibold text-foreground">
                      Nama Pengguna
                    </label>
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="name"
                        value={name}
                        onChange={event => setName(event.target.value)}
                        placeholder="Masukkan nama lengkap Anda"
                        required
                        minLength={2}
                        maxLength={100}
                        className="rounded-xl pl-9"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Gunakan 2–100 karakter. Spasi berlebih akan dirapikan otomatis.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="email" className="block text-sm font-semibold text-foreground">
                      Alamat Email
                    </label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="email"
                        value={profile.email}
                        readOnly
                        className="cursor-not-allowed rounded-xl bg-muted/50 pl-9 text-muted-foreground"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Email merupakan identitas login dan tidak dapat diubah dari halaman ini.
                    </p>
                  </div>

                  <div className="flex justify-end border-t border-border/60 pt-5">
                    <Button
                      type="submit"
                      disabled={saving || !profileChanged || normalizedName.length < 2}
                      className="gap-2 rounded-xl font-semibold"
                    >
                      {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                      Simpan Perubahan
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>

          <Card className="h-fit rounded-2xl border-border/70 bg-card shadow-sm">
            <CardHeader className="border-b border-border/60">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <KeyRound className="size-5" />
                </div>
                <div>
                  <CardTitle>Keamanan Akun</CardTitle>
                  <CardDescription className="mt-1">
                    Ganti password dengan konfirmasi melalui email.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5 sm:p-6">
              <form onSubmit={handlePasswordChange} className="space-y-5">
                <PasswordInput
                  id="currentPassword"
                  label="Password Saat Ini"
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  autoComplete="current-password"
                />
                <PasswordInput
                  id="newPassword"
                  label="Password Baru"
                  value={newPassword}
                  onChange={setNewPassword}
                  autoComplete="new-password"
                />
                <PasswordInput
                  id="confirmPassword"
                  label="Konfirmasi Password Baru"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  autoComplete="new-password"
                />

                <div className="grid grid-cols-1 gap-2 rounded-xl border border-border/60 bg-muted/30 p-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  {passwordChecks.map(check => (
                    <div
                      key={check.label}
                      className={`flex items-center gap-2 text-xs ${
                        check.valid
                          ? "font-medium text-emerald-600 dark:text-emerald-400"
                          : "text-muted-foreground"
                      }`}
                    >
                      <CheckCircle2 className="size-3.5 shrink-0" />
                      {check.label}
                    </div>
                  ))}
                </div>

                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                    Konfirmasi password belum sama.
                  </p>
                )}

                <div className="space-y-3 border-t border-border/60 pt-5">
                  <Button
                    type="submit"
                    disabled={changingPassword || !passwordValid}
                    className="w-full gap-2 rounded-xl font-semibold"
                  >
                    {changingPassword ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                    Kirim Tautan Konfirmasi
                  </Button>
                  <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                    Password baru aktif setelah tautan pada email dikonfirmasi dalam 30 menit.
                  </p>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="rounded-2xl border-rose-200 bg-rose-50/70 shadow-sm dark:border-rose-900/70 dark:bg-rose-950/20">
          <CardContent className="p-8 text-center text-sm font-semibold text-rose-600 dark:text-rose-400">
            Pengguna tidak ditemukan atau sesi Anda telah berakhir.
          </CardContent>
        </Card>
      )}
    </AppShell>
  )
}
