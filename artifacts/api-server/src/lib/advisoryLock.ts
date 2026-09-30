import { pool } from "@workspace/db";

/**
 * Session-scoped PostgreSQL advisory locks coordinate trade execution across
 * API instances. The returned release function must always be called.
 */
export async function acquireAdvisoryLock(
  namespace: number,
  key: number,
): Promise<(() => Promise<void>) | null> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS acquired",
      [namespace, key],
    );
    if (!result.rows[0]?.acquired) {
      client.release();
      return null;
    }

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      try {
        await client.query("SELECT pg_advisory_unlock($1, $2)", [namespace, key]);
      } finally {
        client.release();
      }
    };
  } catch (error) {
    client.release();
    throw error;
  }
}