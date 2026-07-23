import { createAccountQueries } from "./account-queries.js";
import { pool } from "./client.js";

export const {
  userExistsByEmail,
  findUserByEmail,
  findPasswordHashByEmail,
  userExistsById,
} = createAccountQueries(pool);
