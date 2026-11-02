import { randomUUID } from "node:crypto"
import { unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { NextResponse } from "next/server"
import type { QueryResult } from "pg"

import { db } from "@/lib/db"
import { uploadExcelFileToGoogleDrive } from "@/lib/google-drive"
import {
  createMonthlyExcelFile,
  type MonthlyDatabaseReading,
} from "@/lib/monthly-export"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0
export const maxDuration = 300

const DEPLOYMENT_VERSION = "monthly-streaming-v4"
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000
const DATABASE_PAGE_SIZE = 5_000

type MonthRange = {
  startUtc: Date
  endUtc: Date
}

/**
 * Mengambil bulan yang akan diekspor.
 *
 * Jika URL mempunyai:
 * ?month=2026-07
 *
 * maka bulan tersebut digunakan.
 *
 * Jika tidak ada parameter month, sistem otomatis
 * menggunakan bulan sebelumnya berdasarkan WIB.
 */
function getArchiveMonth(requestUrl: string): string {
  const url = new URL(requestUrl)
  const monthParam = url.searchParams.get("month")

  if (
    monthParam &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)
  ) {
    return monthParam
  }

  const now = new Date()

  // Mengubah waktu sekarang menjadi acuan WIB.
  const wibNow = new Date(
    now.getTime() + WIB_OFFSET_MS,
  )

  const currentYear = wibNow.getUTCFullYear()
  const currentMonthIndex = wibNow.getUTCMonth()

  /*
   * getUTCMonth():
   * Januari = 0
   * Februari = 1
   * ...
   * Desember = 11
   */
  const previousMonth =
    currentMonthIndex === 0
      ? 12
      : currentMonthIndex

  const previousYear =
    currentMonthIndex === 0
      ? currentYear - 1
      : currentYear

  return (
    `${previousYear}-` +
    `${String(previousMonth).padStart(2, "0")}`
  )
}

/**
 * Membuat rentang bulan berdasarkan WIB,
 * lalu dikonversi menjadi UTC untuk query database.
 *
 * Contoh bulan 2026-07:
 *
 * startUtc:
 * 2026-06-30T17:00:00.000Z
 * = 1 Juli 2026 pukul 00.00 WIB
 *
 * endUtc:
 * 2026-07-31T17:00:00.000Z
 * = 1 Agustus 2026 pukul 00.00 WIB
 */
function getMonthRangeUtc(
  archiveMonth: string,
): MonthRange {
  const [yearText, monthText] =
    archiveMonth.split("-")

  const year = Number(yearText)
  const month = Number(monthText)

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    throw new Error(
      "Format bulan arsip tidak valid.",
    )
  }

  const startUtc = new Date(
    Date.UTC(
      year,
      month - 1,
      1,
      0,
      0,
      0,
    ) - WIB_OFFSET_MS,
  )

  const endUtc = new Date(
    Date.UTC(
      year,
      month,
      1,
      0,
      0,
      0,
    ) - WIB_OFFSET_MS,
  )

  return {
    startUtc,
    endUtc,
  }
}

async function countDatabaseReadings({
  startUtc,
  endUtc,
}: MonthRange): Promise<number> {
  const result = await db.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM sensor_readings
      WHERE recorded_at >= $1
        AND recorded_at < $2
    `,
    [
      startUtc.toISOString(),
      endUtc.toISOString(),
    ],
  )

  const rowCount = Number(result.rows[0]?.count ?? 0)

  if (!Number.isSafeInteger(rowCount) || rowCount < 0) {
    throw new Error(
      "Jumlah data bulanan dari database tidak valid.",
    )
  }

  return rowCount
}

/**
 * Membaca database menggunakan keyset pagination.
 * Hanya satu halaman yang berada di memori pada satu waktu.
 */
async function* streamDatabaseReadings({
  startUtc,
  endUtc,
}: MonthRange): AsyncGenerator<MonthlyDatabaseReading> {
  let lastRecordedAt: Date | null = null
  let lastId = 0

  while (true) {
    let result: QueryResult<MonthlyDatabaseReading>

    if (lastRecordedAt) {
      result = await db.query<MonthlyDatabaseReading>(
        `
          SELECT
            id,
            sensor_id,
            temperature,
            voltage,
            current,
            recorded_at
          FROM sensor_readings
          WHERE recorded_at >= $1
            AND recorded_at < $2
            AND (
              recorded_at > $3
              OR (
                recorded_at = $3
                AND id > $4
              )
            )
          ORDER BY recorded_at ASC, id ASC
          LIMIT $5
        `,
        [
          startUtc.toISOString(),
          endUtc.toISOString(),
          lastRecordedAt.toISOString(),
          lastId,
          DATABASE_PAGE_SIZE,
        ],
      )
    } else {
      result = await db.query<MonthlyDatabaseReading>(
        `
          SELECT
            id,
            sensor_id,
            temperature,
            voltage,
            current,
            recorded_at
          FROM sensor_readings
          WHERE recorded_at >= $1
            AND recorded_at < $2
          ORDER BY recorded_at ASC, id ASC
          LIMIT $3
        `,
        [
          startUtc.toISOString(),
          endUtc.toISOString(),
          DATABASE_PAGE_SIZE,
        ],
      )
    }

    if (result.rows.length === 0) {
      break
    }

    for (const row of result.rows) {
      yield row
    }

    const lastRow: MonthlyDatabaseReading | undefined =
      result.rows.at(-1)

    if (!lastRow) {
      break
    }

    const nextRecordedAt =
      lastRow.recorded_at instanceof Date
        ? lastRow.recorded_at
        : new Date(lastRow.recorded_at)
    const nextId = Number(lastRow.id)

    if (
      Number.isNaN(nextRecordedAt.getTime()) ||
      !Number.isSafeInteger(nextId)
    ) {
      throw new Error(
        "Cursor pagination database tidak valid.",
      )
    }

    lastRecordedAt = nextRecordedAt
    lastId = nextId

    if (result.rows.length < DATABASE_PAGE_SIZE) {
      break
    }
  }
}

/**
 * Menghapus data yang sudah berhasil diekspor.
 *
 * Penghapusan menggunakan transaksi:
 *
 * BEGIN
 * DELETE
 * COMMIT
 *
 * Jika jumlah data yang terhapus tidak sama
 * dengan jumlah baris yang diekspor, transaksi
 * dibatalkan menggunakan ROLLBACK.
 */
async function deleteExportedReadings({
  startUtc,
  endUtc,
  expectedRowCount,
}: {
  startUtc: Date
  endUtc: Date
  expectedRowCount: number
}): Promise<number> {
  const client = await db.connect()

  try {
    await client.query("BEGIN")

    const deleteResult =
      await client.query(
        `
          DELETE FROM sensor_readings
          WHERE recorded_at >= $1
            AND recorded_at < $2
        `,
        [
          startUtc.toISOString(),
          endUtc.toISOString(),
        ],
      )

    const deletedRowCount =
      deleteResult.rowCount ?? 0

    /*
     * Pengamanan agar jumlah data yang dihapus
     * sama dengan jumlah baris sumber export.
     */
    if (
      deletedRowCount !==
      expectedRowCount
    ) {
      throw new Error(
        "Jumlah data yang terhapus berbeda " +
          "dengan jumlah data yang diekspor. " +
          `Export: ${expectedRowCount}, ` +
          `hapus: ${deletedRowCount}. ` +
          "Transaksi penghapusan dibatalkan.",
      )
    }

    await client.query("COMMIT")

    return deletedRowCount
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

export async function GET(
  request: Request,
) {
  const cronSecret =
    process.env.CRON_SECRET?.trim()

  const authHeader =
    request.headers.get(
      "authorization",
    )

  /*
   * Endpoint hanya dapat dijalankan menggunakan:
   *
   * Authorization: Bearer CRON_SECRET
   */
  if (
    !cronSecret ||
    authHeader !==
      `Bearer ${cronSecret}`
  ) {
    return NextResponse.json(
      {
        success: false,
        deploymentVersion:
          DEPLOYMENT_VERSION,
        error: "Unauthorized",
      },
      {
        status: 401,
      },
    )
  }

  try {
    const archiveMonth =
      getArchiveMonth(request.url)

    const {
      startUtc,
      endUtc,
    } = getMonthRangeUtc(
      archiveMonth,
    )

    /*
     * Nilai environment dibuat lebih tahan
     * terhadap spasi dan perbedaan huruf.
     *
     * Nilai berikut dianggap aktif:
     * true
     * TRUE
     * True
     * true dengan spasi
     */
    const deleteAfterExport =
      (
        process.env
          .DELETE_AFTER_MONTHLY_EXPORT ??
        ""
      )
        .trim()
        .toLowerCase() === "true"

    console.log(
      "[monthly-export] Version:",
      DEPLOYMENT_VERSION,
    )

    console.log(
      "[monthly-export] Archive month:",
      archiveMonth,
    )

    console.log(
      "[monthly-export] Period:",
      startUtc.toISOString(),
      "sampai",
      endUtc.toISOString(),
    )

    console.log(
      "[monthly-export] Delete enabled:",
      deleteAfterExport,
    )

    const rowCount =
      await countDatabaseReadings({
        startUtc,
        endUtc,
      })

    console.log(
      "[monthly-export] Database rows:",
      rowCount,
    )

    if (rowCount === 0) {
      return NextResponse.json({
        success: false,
        deploymentVersion:
          DEPLOYMENT_VERSION,
        message:
          `Tidak ada data untuk bulan ${archiveMonth}.`,
        archiveMonth,
        period: {
          startUtc:
            startUtc.toISOString(),
          endUtc:
            endUtc.toISOString(),
        },
        rowCount: 0,
        readingCount: 0,
        deleteAfterExport,
        deletedRowCount: 0,
      })
    }

    const fileName =
      `laporan-monitoring-${archiveMonth}.xlsx`
    const filePath = join(
      tmpdir(),
      `${randomUUID()}-${fileName}`,
    )

    try {
      /*
       * LANGKAH 1:
       * Database dibaca per halaman dan Excel ditulis
       * langsung ke file sementara. Tidak ada array atau
       * buffer laporan bulanan berukuran besar di memori.
       */
      const excelResult =
        await createMonthlyExcelFile({
          archiveMonth,
          databaseRows:
            streamDatabaseReadings({
              startUtc,
              endUtc,
            }),
          outputPath: filePath,
        })

      console.log(
        "[monthly-export] Streamed database rows:",
        excelResult.rowCount,
      )
      console.log(
        "[monthly-export] Excel readings:",
        excelResult.readingCount,
      )
      console.log(
        "[monthly-export] Excel measurement rows:",
        excelResult.measurementRowCount,
      )

      if (excelResult.rowCount !== rowCount) {
        throw new Error(
          "Jumlah data berubah selama proses export. " +
            `Awal: ${rowCount}, ` +
            `diproses: ${excelResult.rowCount}. ` +
            "Upload dan penghapusan dibatalkan.",
        )
      }

      if (excelResult.readingCount === 0) {
        return NextResponse.json(
          {
            success: false,
            deploymentVersion:
              DEPLOYMENT_VERSION,
            error:
              "Data ditemukan, tetapi tidak ada nilai valid untuk diekspor.",
            archiveMonth,
            period: {
              startUtc:
                startUtc.toISOString(),
              endUtc:
                endUtc.toISOString(),
            },
            rowCount,
            readingCount: 0,
            deleteAfterExport,
            deletedRowCount: 0,
          },
          {
            status: 422,
          },
        )
      }

      /*
       * LANGKAH 2:
       * File diunggah sebagai read stream. DELETE tidak
       * dijalankan apabila upload gagal atau tidak memberi ID.
       */
      const uploadResult =
        await uploadExcelFileToGoogleDrive({
          fileName,
          filePath,
        })

      if (!uploadResult.id) {
        throw new Error(
          "Google Drive tidak mengembalikan file ID. " +
            "Penghapusan data dibatalkan.",
        )
      }

      console.log(
        "[monthly-export] Google Drive file ID:",
        uploadResult.id,
      )

      /*
       * LANGKAH 3:
       * Penghapusan baru dilakukan setelah Google Drive
       * mengonfirmasi file berhasil dibuat.
       */
      let deletedRowCount = 0

      if (deleteAfterExport) {
        console.log(
          "[monthly-export] Memulai penghapusan data.",
        )

        deletedRowCount =
          await deleteExportedReadings({
            startUtc,
            endUtc,
            expectedRowCount:
              excelResult.rowCount,
          })

        console.log(
          "[monthly-export] Data terhapus:",
          deletedRowCount,
        )
      } else {
        console.log(
          "[monthly-export] Penghapusan dinonaktifkan.",
        )
      }

      return NextResponse.json({
        success: true,
        deploymentVersion:
          DEPLOYMENT_VERSION,
        message: deleteAfterExport
          ? (
              `Laporan ${archiveMonth} berhasil ` +
              `diunggah ke Google Drive dan ` +
              `${deletedRowCount} data lama ` +
              "berhasil dihapus."
            )
          : (
              `Laporan ${archiveMonth} berhasil ` +
              "diunggah ke Google Drive. " +
              "Penghapusan data masih dinonaktifkan."
            ),
        archiveMonth,
        period: {
          startUtc:
            startUtc.toISOString(),
          endUtc:
            endUtc.toISOString(),
        },
        rowCount: excelResult.rowCount,
        readingCount:
          excelResult.readingCount,
        measurementRowCount:
          excelResult.measurementRowCount,
        deleteAfterExport,
        deletedRowCount,
        file: {
          id: uploadResult.id,
          name: uploadResult.name,
          webViewLink:
            uploadResult.webViewLink,
        },
      })
    } finally {
      await unlink(filePath).catch((error) => {
        console.warn(
          "[monthly-export] Gagal menghapus file sementara:",
          error,
        )
      })
    }
  } catch (error) {
    console.error(
      "[monthly-export] Gagal:",
      error,
    )

    return NextResponse.json(
      {
        success: false,
        deploymentVersion:
          DEPLOYMENT_VERSION,
        error:
          error instanceof Error
            ? error.message
            : (
                "Terjadi kesalahan " +
                "yang tidak diketahui."
              ),
      },
      {
        status: 500,
      },
    )
  }
}
