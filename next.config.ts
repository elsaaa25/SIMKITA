import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Izinkan akses dari perangkat lain di jaringan lokal saat development
  allowedDevOrigins: ["192.168.1.49"],
};

export default nextConfig;
