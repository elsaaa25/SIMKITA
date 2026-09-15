import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { compare } from "bcryptjs"
import { z } from "zod"
import { db } from "@/lib/db"

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials)
        if (!parsed.success) return null
        const result = await db.query(
          `
    SELECT
      id::text,
      name,
      email,
      password_hash,
      role,
      email_verified_at,
      must_change_password,
      session_version
    FROM users
    WHERE LOWER(email) = LOWER($1)
      AND is_active = TRUE
      AND email_verified_at IS NOT NULL
    LIMIT 1
  `,
          [parsed.data.email],
        )
        const user = result.rows[0]

        if (
          !user ||
          !(await compare(
            parsed.data.password,
            user.password_hash,
          ))
        ) {
          return null
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: "ADMIN" as const,
          mustChangePassword: Boolean(
            user.must_change_password,
          ),
          sessionVersion: Number(user.session_version),
        }
      }
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.role = user.role
        token.mustChangePassword =
          user.mustChangePassword
        token.sessionVersion =
          user.sessionVersion
      }

      // Setiap request: validasi session_version dari DB agar
      // sesi lama otomatis invalid setelah password diubah.
      if (typeof token.sub === "string") {
        const result = await db.query<{
          name: string
          session_version: number
          must_change_password: boolean
        }>(
          `
            SELECT
              name,
              session_version,
              must_change_password
            FROM users
            WHERE id = $1
              AND is_active = TRUE
            LIMIT 1
          `,
          [token.sub],
        )

        const currentUser = result.rows[0]

        if (!currentUser) {
          // Akun tidak aktif — invalidate token.
          token.sessionVersion = -1
        } else if (
          Number(currentUser.session_version) !==
          Number(token.sessionVersion)
        ) {
          // session_version berubah (misal: setelah ganti password).
          // Invalidate token agar user wajib login ulang.
          token.sessionVersion = -1
        } else {
          // Refresh data terbaru.
          token.name = currentUser.name
          token.mustChangePassword = Boolean(
            currentUser.must_change_password,
          )
        }
      }

      return token
    },

    session({
  session,
  token,
}) {
  if (!session.user) {
    return session
  }

  // Sesi tidak valid jika sessionVersion = -1
  if (token.sessionVersion === -1) {
    session.user.id = ""
    return session
  }

  session.user.id =
    typeof token.sub === "string"
      ? token.sub
      : ""

  if (typeof token.name === "string") {
    session.user.name = token.name
  }

  if (typeof token.email === "string") {
    session.user.email = token.email
  }

  if (
    token.role === "ADMIN"
  ) {
    session.user.role = token.role
  }

  session.user.mustChangePassword = Boolean(
    token.mustChangePassword,
  )

  return session
},
authorized({ auth: session, request }) {
  const pathname = request.nextUrl.pathname

  const publicRoutes = [
   "/login",
  "/verifikasi-email",
  "/konfirmasi-password",
  "/api/account/verify-email",
  "/api/account/confirm-password",
  "/api/auth",
  ]

  const isPublicRoute = publicRoutes.some(
    route =>
      pathname === route ||
      pathname.startsWith(`${route}/`),
  )

  if (isPublicRoute) {
    return true
  }

  if (!session?.user) {
    return false
  }

  const passwordChangeRoutes = [
    "/ganti-password-pertama",
    "/api/account/change-first-password",
  ]

  const isPasswordChangeRoute =
    passwordChangeRoutes.some(
      route =>
        pathname === route ||
        pathname.startsWith(`${route}/`),
    )

  if (
    session.user.mustChangePassword &&
    !isPasswordChangeRoute
  ) {
    return Response.redirect(
      new URL(
        "/ganti-password-pertama",
        request.nextUrl,
      ),
    )
  }

  if (
    !session.user.mustChangePassword &&
    isPasswordChangeRoute
  ) {
    return Response.redirect(
      new URL("/", request.nextUrl),
    )
  }

  return true
},
  },
})
