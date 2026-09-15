-- Migration: Perbaiki akun admin lama yang dibuat via /api/setup
-- yang belum memiliki email_verified_at.
--
-- Kondisi: Hanya update user ADMIN yang aktif, belum memiliki
-- email_verified_at, dan memiliki password_hash (artinya dibuat
-- via setup langsung, bukan via undangan email).
--
-- Jalankan sekali di Supabase SQL Editor.

UPDATE users
SET
  email_verified_at = created_at,
  must_change_password = FALSE,
  updated_at = NOW()
WHERE
  email_verified_at IS NULL
  AND is_active = TRUE
  AND password_hash IS NOT NULL;
