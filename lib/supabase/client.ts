"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/**
 * Browser client. `createBrowserClient` is a singleton by default, so calling
 * this from several components still shares one session and one refresh timer.
 */
export const supabaseBrowser = () => createBrowserClient(SUPABASE_URL(), SUPABASE_ANON_KEY());
