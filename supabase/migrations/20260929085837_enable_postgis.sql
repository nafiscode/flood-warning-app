-- A0: enable PostGIS. Geometry is stored as EPSG:4326; distance queries use geography (CLAUDE.md).
-- Installed in the "extensions" schema, as Supabase recommends, to keep "public" for app tables.
create extension if not exists postgis with schema extensions;
