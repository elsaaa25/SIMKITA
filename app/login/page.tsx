"use client"

import { FormEvent, useState } from "react"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"
import { Eye, EyeOff, Loader2, LockKeyhole, Mail, Server } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("")
    const result = await signIn("credentials", { email, password, redirect: false })
    setLoading(false)
    if (result?.error) { setError("Email atau password tidak sesuai."); return }
    router.push("/"); router.refresh()
  }

  return <main className="grid min-h-screen place-items-center p-4">
    <div className="w-full max-w-md">
      <div className="mb-6 flex justify-center"><div className="grid size-14 place-items-center rounded-2xl bg-[#005a9c] text-white shadow-lg shadow-blue-200"><Server className="size-7" /></div></div>
      <Card className="border-border shadow-xl shadow-slate-200/60 dark:shadow-black/30">
        <CardHeader className="text-center"><CardTitle className="text-2xl">Masuk ke Dashboard</CardTitle><CardDescription>Gunakan akun operator atau administrator</CardDescription></CardHeader>
        <CardContent><form onSubmit={submit} className="space-y-4">
          <label className="block"><span className="mb-2 block text-sm font-medium">Email</span><div className="flex h-11 items-center gap-2 rounded-xl border bg-background px-3 focus-within:ring-2 focus-within:ring-primary/30"><Mail className="size-4 text-muted-foreground" /><input type="email" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="email" placeholder="operator@example.com" className="min-w-0 flex-1 bg-transparent outline-none" /></div></label>
          <label className="block"><span className="mb-2 block text-sm font-medium">Password</span><div className="flex h-11 items-center gap-2 rounded-xl border bg-background px-3 focus-within:ring-2 focus-within:ring-primary/30"><LockKeyhole className="size-4 text-muted-foreground" /><input type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} required minLength={8} autoComplete="current-password" className="min-w-0 flex-1 bg-transparent outline-none" /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"} className="text-muted-foreground">{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div></label>
          {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full bg-[#005a9c] hover:bg-[#004579]">{loading ? <Loader2 className="animate-spin" /> : <LockKeyhole />}{loading ? "Memeriksa..." : "Masuk"}</Button>
        </form></CardContent>
      </Card>
      <p className="mt-5 text-center text-xs text-muted-foreground">SIMKITA • Akses terbatas untuk petugas berwenang</p>
    </div>
  </main>
}
