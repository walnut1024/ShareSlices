import { z } from "zod";

export class AccountInputError extends Error {
  constructor(public readonly code: string, message = code) {
    super(message);
    this.name = "AccountInputError";
  }
}

export function normalizeEmailForAccount(input: string): string {
  const trimmed = input.trim();
  const parts = trimmed.split("@");
  const local = parts[0];
  const domain = parts[1];

  if (parts.length !== 2 || !local || !domain) {
    throw new AccountInputError("invalid_email");
  }

  return `${local}@${domain}`.toLowerCase();
}

const accountEmailSchema = z
  .string()
  .max(320, "invalid_email")
  .transform((value, ctx) => {
    try {
      return normalizeEmailForAccount(value);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "invalid_email"
      });
      return z.NEVER;
    }
  })
  .pipe(z.string().email("invalid_email"));

export const registrationInputSchema = z
  .object({
    name: z.string().trim().min(1, "invalid_name").max(120, "invalid_name"),
    email: accountEmailSchema,
    password: z.string().min(8, "invalid_password").max(128, "invalid_password")
  })
  .strict();

export type RegistrationInput = z.infer<typeof registrationInputSchema>;

export const loginInputSchema = z
  .object({
    email: accountEmailSchema,
    password: z.string().min(1, "invalid_password").max(128, "invalid_password")
  })
  .strict();

export type LoginInput = z.infer<typeof loginInputSchema>;
