"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

/**
 * Supabase client in the browser, used only to put a photo or voice note straight into Storage.
 * Everything else goes through this app's own endpoints. Uploading from the phone keeps the bytes
 * off the server and lets the upload fail on its own without taking an SOS down with it.
 *
 * It acts as the signed-in person, or as a visitor for an anonymous SOS: the storage policies in
 * the A4 migration decide what may be written (nothing in these buckets is public).
 */
export function createClient() {
  const { url, key } = supabaseEnv();
  return createBrowserClient(url, key);
}
