import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { hash } from "bcryptjs"

// GET: Menampilkan form pembuatan admin jika database masih kosong
export async function GET() {
  try {
    // Cek apakah sudah ada user di database
    const userCountResult = await db.query("SELECT COUNT(*)::int as count FROM users")
    const userCount = userCountResult.rows[0].count

    if (userCount > 0) {
      return new NextResponse(
        `<html>
          <head>
            <title>Setup Selesai</title>
            <style>
              body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f8fafc; }
              .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
              h1 { color: #0f172a; margin-top: 0; }
              p { color: #64748b; }
              a { display: inline-block; margin-top: 1rem; background: #005a9c; color: white; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Setup Sudah Selesai</h1>
              <p>Database sudah memiliki pengguna terdaftar. Anda tidak dapat membuat admin baru melalui halaman setup ini demi keamanan.</p>
              <a href="/login">Ke Halaman Login</a>
            </div>
          </body>
        </html>`,
        { headers: { "Content-Type": "text/html" } }
      )
    }

    // Tampilkan form jika user masih kosong
    return new NextResponse(
      `<html>
        <head>
          <title>Setup Admin Utama</title>
          <style>
            body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f1f5f9; }
            .card { background: white; padding: 2.5rem; border-radius: 1.5rem; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); width: 100%; max-width: 400px; }
            h1 { color: #0f172a; font-size: 1.5rem; margin-bottom: 0.5rem; }
            p { color: #64748b; font-size: 0.875rem; margin-bottom: 1.5rem; }
            .field { margin-bottom: 1rem; }
            label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.5rem; color: #334155; }
            input { width: 100%; padding: 0.75rem; border: 1px solid #cbd5e1; border-radius: 0.5rem; box-sizing: border-box; font-size: 0.875rem; }
            button { width: 100%; background: #005a9c; color: white; padding: 0.75rem; border: none; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 600; cursor: pointer; margin-top: 1rem; }
            button:hover { background: #004579; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Buat Admin Pertama</h1>
            <p>Database Anda kosong. Silakan buat akun Administrator pertama untuk mengelola sistem monitoring.</p>
            <form action="/api/setup" method="POST">
              <div class="field">
                <label>Nama Lengkap</label>
                <input type="text" name="name" required placeholder="Administrator" />
              </div>
              <div class="field">
                <label>Email</label>
                <input type="email" name="email" required placeholder="admin@domain.com" />
              </div>
              <div class="field">
                <label>Password (Min. 8 karakter)</label>
                <input type="password" name="password" required minlength="8" placeholder="••••••••" />
              </div>
              <button type="submit">Buat Akun & Selesaikan Setup</button>
            </form>
          </div>
        </body>
      </html>`,
      { headers: { "Content-Type": "text/html" } }
    )
  } catch (error: any) {
    return new NextResponse(`Error: ${error.message}`, { status: 500 })
  }
}

// POST: Menerima input form dan menyimpannya ke database
export async function POST(request: Request) {
  try {
    // Cek apakah sudah ada user
    const userCountResult = await db.query("SELECT COUNT(*)::int as count FROM users")
    if (userCountResult.rows[0].count > 0) {
      return NextResponse.json({ error: "Setup sudah dikonfigurasi sebelumnya." }, { status: 400 })
    }

    // Baca data form
    const formData = await request.formData()
    const name = formData.get("name") as string
    const email = formData.get("email") as string
    const password = formData.get("password") as string

    if (!name || !email || !password || password.length < 8) {
      return NextResponse.json({ error: "Data input tidak valid atau password kurang dari 8 karakter." }, { status: 400 })
    }

    // Hash Password
    const passwordHash = await hash(password, 10)

    // Simpan Admin Utama
    await db.query(
      `INSERT INTO users (name, email, password_hash, role, is_active, email_verified_at, must_change_password)
       VALUES ($1, $2, $3, 'ADMIN', TRUE, NOW(), FALSE)`,
      [name, email, passwordHash]
    )

    // Tampilkan halaman sukses
    return new NextResponse(
      `<html>
        <head>
          <title>Sukses</title>
          <style>
            body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f8fafc; }
            .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
            h1 { color: #16a34a; margin-top: 0; }
            p { color: #64748b; margin-bottom: 1.5rem; }
            a { display: inline-block; background: #005a9c; color: white; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Setup Sukses!</h1>
            <p>Akun Administrator pertama berhasil dibuat. Anda sekarang dapat masuk ke sistem.</p>
            <a href="/login">Masuk ke Aplikasi</a>
          </div>
        </body>
      </html>`,
      { headers: { "Content-Type": "text/html" } }
    )
  } catch (error: any) {
    return NextResponse.json({ error: "Gagal membuat user admin", details: error.message }, { status: 500 })
  }
}
