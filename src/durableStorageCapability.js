/**
 * Describes the durable backend the application can actually instantiate.
 * DATABASE_URL is retained as a deployment declaration for migration tooling,
 * but the runtime repository currently has no Postgres adapter; it only has a
 * Supabase client and otherwise falls back to local JSON.
 */
export function isValidSupabaseConfiguration(env = process.env) {
  const url = String(env.SUPABASE_URL || "").trim();
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceRoleKey) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function durableStorageCapability(env = process.env) {
  if (isValidSupabaseConfiguration(env)) {
    return { backend: "supabase", configured: true };
  }
  return { backend: "json_fallback", configured: false };
}

