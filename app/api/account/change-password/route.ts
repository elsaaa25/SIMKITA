import {
  compare,
  hash,
} from "bcryptjs"
import { z } from "zod"

import { auth } from "@/auth"
import {
  createPasswordConfirmationToken,
} from "@/lib/account-token"
import { db } from "@/lib/db"
import { sendEmail } from "@/lib/email"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const passwordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(
        1,
        "Password saat ini harus diisi.",
      ),

    newPassword: z
      .string()
      .min(
        12,
        "Password baru minimal 12 karakter.",
      )
      .max(
        128,
        "Password baru maksimal 128 karakter.",
      )
      .regex(
        /[A-Z]/,
        "Password baru harus memiliki huruf besar.",
      )
      .regex(
        /[a-z]/,
        "Password baru harus memiliki huruf kecil.",
      )
      .regex(
        /[0-9]/,
        "Password baru harus memiliki angka.",
      )
      .regex(
        /[^A-Za-z0-9]/,
        "Password baru harus memiliki karakter khusus.",
      ),

    confirmPassword: z.string(),
  })
  .refine(
    data =>
      data.newPassword ===
      data.confirmPassword,
    {
      message:
        "Konfirmasi password baru tidak sama.",
      path: ["confirmPassword"],
    },
  )

type DatabaseUser = {
  id: string
  name: string
  email: string
  password_hash: string
}

function escapeHtml(
  value: string,
): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function resolveAppUrl(request: Request): string {
  // Coba dari APP_URL dulu, lalu NEXTAUTH_URL, lalu dari host request.
  const fromEnv = (
    process.env.APP_URL ??
    process.env.NEXTAUTH_URL ??
    ""
  ).trim().replace(/\/+$/, "")

  if (fromEnv) return fromEnv

  // Fallback: bangun dari header host request.
  const host = request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "localhost:3000"
  const proto = request.headers.get("x-forwarded-proto") ?? "https"
  return `${proto}://${host}`
}

export async function POST(
  request: Request,
) {
  const session = await auth()
  const userId = session?.user?.id

  if (!userId) {
    return Response.json(
      {
        success: false,
        message:
          "Sesi login tidak ditemukan.",
      },
      {
        status: 401,
      },
    )
  }

  try {
    const body = await request
      .json()
      .catch(() => null)

    const parsed =
      passwordSchema.safeParse(body)

    if (!parsed.success) {
      return Response.json(
        {
          success: false,
          message:
            parsed.error.issues[0]
              ?.message ??
            "Data password tidak valid.",
        },
        {
          status: 400,
        },
      )
    }

    const client = await db.connect()

    try {
      await client.query("BEGIN")

      const userResult =
        await client.query<DatabaseUser>(
          `
            SELECT
              id::text,
              name,
              email,
              password_hash
            FROM users
            WHERE id = $1
              AND is_active = TRUE
              AND email_verified_at
                IS NOT NULL
            LIMIT 1
            FOR UPDATE
          `,
          [userId],
        )

      const user =
        userResult.rows[0]

      if (!user) {
        await client.query("ROLLBACK")

        return Response.json(
          {
            success: false,
            message:
              "Akun pengguna tidak ditemukan.",
          },
          {
            status: 404,
          },
        )
      }

      const currentPasswordValid =
        await compare(
          parsed.data.currentPassword,
          user.password_hash,
        )

      if (!currentPasswordValid) {
        await client.query("ROLLBACK")

        return Response.json(
          {
            success: false,
            message:
              "Password saat ini tidak sesuai.",
          },
          {
            status: 400,
          },
        )
      }

      const sameAsCurrentPassword =
        await compare(
          parsed.data.newPassword,
          user.password_hash,
        )

      if (sameAsCurrentPassword) {
        await client.query("ROLLBACK")

        return Response.json(
          {
            success: false,
            message:
              "Password baru tidak boleh sama dengan password saat ini.",
          },
          {
            status: 400,
          },
        )
      }

      const pendingPasswordHash =
        await hash(
          parsed.data.newPassword,
          12,
        )

      const {
        token,
        tokenHash,
        expiresAt,
      } =
        createPasswordConfirmationToken()

      await client.query(
        `
          UPDATE users
          SET
            pending_password_hash = $1,
            password_confirmation_token_hash = $2,
            password_confirmation_expires_at = $3,
            updated_at = NOW()
          WHERE id = $4
        `,
        [
          pendingPasswordHash,
          tokenHash,
          expiresAt,
          user.id,
        ],
      )

      const appUrl = resolveAppUrl(request)

      const confirmationUrl =
        `${appUrl}/konfirmasi-password` +
        `?token=${encodeURIComponent(
          token,
        )}`

      await sendEmail({
        to: user.email,
        subject:
          "Konfirmasi Perubahan Password Monitoring Room",
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
            <h2>
              Konfirmasi Perubahan Password
            </h2>

            <p>
              Halo ${escapeHtml(user.name)},
            </p>

            <p>
              Kami menerima permintaan
              perubahan password akun
              Monitoring Room Anda.
            </p>

            <p>
              Klik tombol berikut untuk
              mengaktifkan password baru:
            </p>

            <p style="margin: 28px 0;">
              <a
                href="${confirmationUrl}"
                style="
                  display: inline-block;
                  padding: 12px 20px;
                  border-radius: 8px;
                  background: #005a9c;
                  color: #ffffff;
                  text-decoration: none;
                  font-weight: 600;
                "
              >
                Konfirmasi Password Baru
              </a>
            </p>

            <p>
              Tautan berlaku selama
              <strong>30 menit</strong>
              dan hanya dapat digunakan
              satu kali.
            </p>

            <p
              style="
                color: #64748b;
                font-size: 13px;
              "
            >
              Abaikan email ini apabila
              Anda tidak meminta perubahan
              password.
            </p>
          </div>
        `,
      })

      await client.query("COMMIT")

      return Response.json({
        success: true,
        message:
          "Tautan konfirmasi telah dikirim ke email Anda.",
      })
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    console.error(
      "Gagal memproses perubahan password:",
      error,
    )

    return Response.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : (
                "Terjadi kesalahan saat " +
                "memproses perubahan password."
              ),
      },
      {
        status: 500,
      },
    )
  }
}