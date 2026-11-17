import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { db } from "@/lib/db"

export const runtime = "nodejs"

const acknowledgeSchema = z.union([
  z.object({
    id: z.number().int().positive(),
    type: z.enum(["temperature", "voltage"]).optional(),
  }),
  z.object({
    all: z.literal(true),
  }),
])

export async function GET(request: Request) {
  try {
    const session = await auth()

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      )
    }

    const url = new URL(request.url)
    const requestedLimit = Number(url.searchParams.get("limit") ?? 200)
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 500)
      : 200

    const status = url.searchParams.get("status")
    const level = url.searchParams.get("level")
    const type = url.searchParams.get("type")

    const values: Array<string | number> = []
    const conditions: string[] = []

    if (status === "Aktif" || status === "Ditangani") {
      values.push(status)
      conditions.push(`status = $${values.length}`)
    }

    if (level === "Waspada" || level === "Bahaya") {
      values.push(level)
      conditions.push(`level = $${values.length}`)
    }

    if (type === "temperature" || type === "voltage") {
      values.push(type)
      conditions.push(`type = $${values.length}`)
    }

    values.push(limit)

    const where =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : ""

    const result = await db.query(
      `
        WITH combined_alerts AS (
          SELECT
            a.id,
            'temperature'::text AS "type",
            a.sensor_id AS "sensorId",
            a.level,
            a.status,
            a.temperature::float8 AS temperature,
            NULL::float8 AS voltage,
            a.title,
            a.detail,
            a.created_at AS "createdAt",
            a.acknowledged_at AS "acknowledgedAt",
            a.resolved_at AS "resolvedAt",
            u.name AS "handledByName"
          FROM temperature_alerts a
          LEFT JOIN users u
            ON u.id = a.handled_by

          UNION ALL

          SELECT
            v.id,
            'voltage'::text AS "type",
            v.sensor_id AS "sensorId",
            v.level,
            v.status,
            NULL::float8 AS temperature,
            v.voltage::float8 AS voltage,
            v.title,
            v.detail,
            v.created_at AS "createdAt",
            v.acknowledged_at AS "acknowledgedAt",
            v.resolved_at AS "resolvedAt",
            u.name AS "handledByName"
          FROM voltage_alerts v
          LEFT JOIN users u
            ON u.id = v.handled_by
        )
        SELECT
          id,
          "type",
          "sensorId",
          level,
          status,
          temperature,
          voltage,
          title,
          detail,
          "createdAt",
          "acknowledgedAt",
          "resolvedAt",
          "handledByName"
        FROM combined_alerts
        ${where}
        ORDER BY "createdAt" DESC, id DESC
        LIMIT $${values.length}
      `,
      values,
    )

    return NextResponse.json(
      {
        success: true,
        data: result.rows,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    )
  } catch (error) {
    console.error("Gagal mengambil data peringatan:", error)

    return NextResponse.json(
      {
        success: false,
        error: "Gagal mengambil data peringatan",
      },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      )
    }

    const body: unknown = await request.json()
    const parsed = acknowledgeSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Permintaan tidak valid",
          details: parsed.error.flatten(),
        },
        { status: 400 },
      )
    }

    const userId = session.user.id
    let updatedCount = 0

    if ("id" in parsed.data) {
      const { id, type } = parsed.data

      if (type === "voltage") {
        const result = await db.query(
          `
            UPDATE voltage_alerts
            SET
              status = 'Ditangani',
              acknowledged_at = COALESCE(acknowledged_at, NOW()),
              handled_by = COALESCE(handled_by, $2::uuid)
            WHERE id = $1
              AND status = 'Aktif'
            RETURNING id
          `,
          [id, userId],
        )
        updatedCount = result.rowCount ?? 0
      } else if (type === "temperature") {
        const result = await db.query(
          `
            UPDATE temperature_alerts
            SET
              status = 'Ditangani',
              acknowledged_at = COALESCE(acknowledged_at, NOW()),
              handled_by = COALESCE(handled_by, $2::uuid)
            WHERE id = $1
              AND status = 'Aktif'
            RETURNING id
          `,
          [id, userId],
        )
        updatedCount = result.rowCount ?? 0
      } else {
        // Jika type tidak disertakan, coba update suhu terlebih dahulu, lalu tegangan
        const tempResult = await db.query(
          `
            UPDATE temperature_alerts
            SET
              status = 'Ditangani',
              acknowledged_at = COALESCE(acknowledged_at, NOW()),
              handled_by = COALESCE(handled_by, $2::uuid)
            WHERE id = $1
              AND status = 'Aktif'
            RETURNING id
          `,
          [id, userId],
        )

        if ((tempResult.rowCount ?? 0) > 0) {
          updatedCount = tempResult.rowCount ?? 0
        } else {
          const voltResult = await db.query(
            `
              UPDATE voltage_alerts
              SET
                status = 'Ditangani',
                acknowledged_at = COALESCE(acknowledged_at, NOW()),
                handled_by = COALESCE(handled_by, $2::uuid)
              WHERE id = $1
                AND status = 'Aktif'
              RETURNING id
            `,
            [id, userId],
          )
          updatedCount = voltResult.rowCount ?? 0
        }
      }
    } else {
      // Tandai semua peringatan (suhu dan tegangan) sebagai ditangani
      const [tempRes, voltRes] = await Promise.all([
        db.query(
          `
            UPDATE temperature_alerts
            SET
              status = 'Ditangani',
              acknowledged_at = COALESCE(acknowledged_at, NOW()),
              handled_by = COALESCE(handled_by, $1::uuid)
            WHERE status = 'Aktif'
            RETURNING id
          `,
          [userId],
        ),
        db.query(
          `
            UPDATE voltage_alerts
            SET
              status = 'Ditangani',
              acknowledged_at = COALESCE(acknowledged_at, NOW()),
              handled_by = COALESCE(handled_by, $1::uuid)
            WHERE status = 'Aktif'
            RETURNING id
          `,
          [userId],
        ),
      ])

      updatedCount = (tempRes.rowCount ?? 0) + (voltRes.rowCount ?? 0)
    }

    return NextResponse.json({
      success: true,
      message:
        updatedCount === 0
          ? "Tidak ada peringatan aktif yang perlu ditangani."
          : `${updatedCount} peringatan berhasil ditandai sebagai ditangani.`,
      updated: updatedCount,
    })
  } catch (error) {
    console.error("Gagal menangani peringatan:", error)

    return NextResponse.json(
      {
        success: false,
        error: "Gagal memperbarui peringatan",
      },
      { status: 500 },
    )
  }
}