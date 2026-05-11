import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  // Check if environment variables are defined. Provide a fallback to avoid crashing during local UI dev without keys.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder-url.supabase.co";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
