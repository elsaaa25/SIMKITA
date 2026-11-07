import { google } from "googleapis"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret =
      process.env.GOOGLE_CLIENT_SECRET
    const redirectUri = new URL(
      "/api/google/oauth/callback",
      request.url,
    ).toString()

    if (
      !clientId ||
      !clientSecret
    ) {
      return Response.json(
        {
          success: false,
          error:
            "Environment Google OAuth belum lengkap",
        },
        {
          status: 500,
        },
      )
    }

    const oauthClient =
      new google.auth.OAuth2(
        clientId,
        clientSecret,
        redirectUri,
      )

    const authorizationUrl =
      oauthClient.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: true,
        scope: [
          "https://www.googleapis.com/auth/drive.file",
        ],
      })

    return Response.redirect(
      authorizationUrl,
    )
  } catch (error) {
    console.error(
      "Gagal membuat URL Google OAuth:",
      error,
    )

    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Gagal memulai Google OAuth",
      },
      {
        status: 500,
      },
    )
  }
}
