import "server-only"
import { Pool } from "pg"

const {
  DB_HOST,
  DB_PORT,
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
} = process.env

if (
  typeof DB_HOST !== "string" ||
  typeof DB_PORT !== "string" ||
  typeof DB_NAME !== "string" ||
  typeof DB_USER !== "string" ||
  typeof DB_PASSWORD !== "string" ||
  DB_HOST.trim() === "" ||
  DB_PORT.trim() === "" ||
  DB_NAME.trim() === "" ||
  DB_USER.trim() === "" ||
  DB_PASSWORD.trim() === ""
) {
  console.error("Status environment database:", {
    DB_HOST: typeof DB_HOST === "string" && DB_HOST.length > 0,
    DB_PORT: typeof DB_PORT === "string" && DB_PORT.length > 0,
    DB_NAME: typeof DB_NAME === "string" && DB_NAME.length > 0,
    DB_USER: typeof DB_USER === "string" && DB_USER.length > 0,
    DB_PASSWORD:
      typeof DB_PASSWORD === "string" &&
      DB_PASSWORD.length > 0,
  })

  throw new Error(
    "Konfigurasi database belum lengkap di .env.local"
  )
}

console.log("db.ts berhasil dimuat:", {
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  passwordType: typeof DB_PASSWORD,
  passwordLoaded: DB_PASSWORD.length > 0,
})

const globalForDatabase = globalThis as unknown as {
  db?: Pool
}

export const db =
  globalForDatabase.db ??
  new Pool({
    host: DB_HOST,
    port: Number(DB_PORT),
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    max: 5,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 10000,
    ssl: {
      rejectUnauthorized: false,
    },
  })

// Cache pool di semua environment (termasuk production)
// agar serverless function tidak membuat pool baru setiap request.
globalForDatabase.db = db