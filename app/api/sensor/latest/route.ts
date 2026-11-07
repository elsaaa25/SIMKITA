import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db } from "@/lib/db"

export const runtime = "nodejs"

export async function GET() {
  try {
    const session = await auth()

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      )
    }

    const result = await db.query(
      `SELECT
         ('latest-' || sensor_id) AS id,
         sensor_id AS "sensorId",
         temperature::float8 AS temperature,
         voltage::float8 AS voltage,
         current::float8 AS current,
         last_seen AS "recordedAt"
       FROM sensor_latest_state
       ORDER BY last_seen DESC`,
    )

    return NextResponse.json(
      { success: true, data: result.rows },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    console.error("Gagal mengambil state sensor terbaru:", error)

    return NextResponse.json(
      {
        success: false,
        error: "Gagal mengambil data sensor terbaru",
      },
      { status: 500 },
    )
  }
}
