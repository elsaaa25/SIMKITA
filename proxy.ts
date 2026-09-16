export { auth as proxy } from "@/auth"

export const config = {
  matcher: [
    /*
     * Jalankan autentikasi hanya untuk halaman.
     * Semua endpoint /api dilewati oleh proxy.
     */
    "/((?!api|_next/static|_next/image|SIMKITA.png|robots.txt|sitemap.xml).*)",
  ],
}