import { createHash } from "node:crypto"

import { db } from "@/lib/db"
import { sendEmail } from "@/lib/email"

export const runtime = "nodejs"

function hashToken(token: string) {
  return createHash("sha256")
    .update(token)
    .digest("hex")
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

export async function POST(request: Request) {
  let client

  try {
    const body = await request.json().catch(() => null)

    const token =
      typeof body?.token === "string"
        ? body.token.trim()
        : ""

    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return Response.json(
        {
          success: false,
          message: "Token konfirmasi tidak valid.",
        },
        { status: 400 },
      )
    }

    const tokenHash = hashToken(token)

    client = await db.connect()

    await client.query("BEGIN")

    const result = await client.query(
      `
        UPDATE users
        SET
          password_hash = pending_password_hash,
          pending_password_hash = NULL,
          password_confirmation_token_hash = NULL,
          password_confirmation_expires_at = NULL,
          must_change_password = FALSE,
          password_changed_at = NOW(),
          session_version = session_version + 1,
          updated_at = NOW()
        WHERE password_confirmation_token_hash = $1
          AND password_confirmation_expires_at > NOW()
          AND pending_password_hash IS NOT NULL
          AND is_active = TRUE
          AND email_verified_at IS NOT NULL
        RETURNING
          id::text,
          name,
          email,
          password_changed_at,
          session_version
      `,
      [tokenHash],
    )

    if (result.rowCount === 0) {
      await client.query("ROLLBACK")

      return Response.json(
        {
          success: false,
          message:
            "Tautan konfirmasi tidak valid, sudah digunakan, atau kedaluwarsa.",
        },
        { status: 400 },
      )
    }

    const user = result.rows[0]

    await client.query("COMMIT")

    // Email pemberitahuan dikirim setelah perubahan database berhasil.
    try {
      await sendEmail({
        to: user.email,
        subject:
          "Password Monitoring Room Berhasil Diubah",
        html: `
          <div
            style="
              max-width: 600px;
              margin: 0 auto;
              padding: 24px;
              font-family: Arial, sans-serif;
              color: #0f172a;
              line-height: 1.6;
            "
          >
            <h2>Password Berhasil Diubah</h2>

            <p>Halo ${escapeHtml(user.name)},</p>

            <p>
              Password akun administrator Monitoring Room
              berhasil diubah.
            </p>

            <p>
              Silakan masuk kembali menggunakan password baru.
            </p>

            <p
              style="
                margin-top: 28px;
                color: #64748b;
                font-size: 13px;
              "
            >
              Apabila Anda tidak melakukan perubahan ini,
              segera hubungi pengelola sistem.
            </p>
          </div>
        `,
      })
    } catch (emailError) {
      // Password tetap dianggap berhasil diubah walaupun
      // email pemberitahuan mengalami gangguan.
      console.error(
        "Password berubah, tetapi email pemberitahuan gagal:",
        emailError,
      )
    }

    return Response.json({
      success: true,
      message:
        "Password baru berhasil diaktifkan. Silakan login kembali.",
    })
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK")
      } catch {
        // Transaksi mungkin sudah selesai.
      }
    }

    console.error(
      "Gagal mengonfirmasi password:",
      error,
    )

    return Response.json(
      {
        success: false,
        message:
          "Terjadi kesalahan saat mengaktifkan password baru.",
      },
      { status: 500 },
    )
  } finally {
    client?.release()
  }
}