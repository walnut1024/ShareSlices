import { AccountApiError } from "./account";

export type CliAuthorization = {
  userCode: string;
  status: "pending" | "approved" | "denied";
};

async function errorFrom(response: Response): Promise<AccountApiError> {
  const body = (await response.json()) as { error: { code: string; message: string } };
  return new AccountApiError(body.error.message, body.error.code);
}

export async function getCliAuthorization(userCode: string): Promise<CliAuthorization> {
  const response = await fetch(`/api/cli-authorizations/${encodeURIComponent(userCode)}`, {
    credentials: "include"
  });
  if (!response.ok) throw await errorFrom(response);
  const body = (await response.json()) as { authorization: CliAuthorization };
  return body.authorization;
}

async function decide(userCode: string, action: "approve" | "deny"): Promise<void> {
  const response = await fetch(
    `/api/cli-authorizations/${encodeURIComponent(userCode)}:${action}`,
    { method: "POST", credentials: "include" }
  );
  if (!response.ok) throw await errorFrom(response);
}

export async function approveCliAuthorization(userCode: string): Promise<void> {
  await decide(userCode, "approve");
}

export async function denyCliAuthorization(userCode: string): Promise<void> {
  await decide(userCode, "deny");
}
