import type { Pool } from "pg";

export function createAccountQueries(databasePool: Pick<Pool, "query">) {
  return {
    async userExistsByEmail(email: string): Promise<boolean> {
      const result = await databasePool.query(
        'select 1 from "user" where email = $1 limit 1',
        [email],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async findUserByEmail(
      email: string,
    ): Promise<{ id: string; emailVerified: boolean } | null> {
      const result = await databasePool.query<{
        id: string;
        email_verified: boolean;
      }>('select id, email_verified from "user" where email = $1 limit 1', [
        email,
      ]);
      const value = result.rows[0];
      return value
        ? { id: value.id, emailVerified: value.email_verified }
        : null;
    },

    async findPasswordHashByEmail(email: string): Promise<string | null> {
      const result = await databasePool.query<{ password: string | null }>(
        `select a.password from account a
     join "user" u on u.id = a.user_id
     where u.email = $1 and a.provider_id = 'credential' limit 1`,
        [email],
      );
      return result.rows[0]?.password ?? null;
    },

    async userExistsById(userId: string): Promise<boolean> {
      const result = await databasePool.query(
        'select 1 from "user" where id = $1 limit 1',
        [userId],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}
