export type User = {
  id: string;
  name: string;
  email: string;
};

export type CreateUserInput = {
  name: string;
  email: string;
  password: string;
};

export type CreateSessionInput = {
  email: string;
  password: string;
};

export type CreateSessionResult = {
  signedIn: true;
  user: User;
};

export type VerificationState = {
  verification: {
    id: string;
    destination: string;
    expiresIn: number;
    resendAvailableIn: number;
  };
};

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    requestId: string;
    fields?: Array<{ path: string; code: string; message: string }>;
  };
};

export class AccountApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly fields: NonNullable<ErrorResponse["error"]["fields"]> = []
  ) {
    super(message);
    this.name = "AccountApiError";
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function responseError(response: Response): Promise<AccountApiError> {
  const error = await parseJson<ErrorResponse>(response);
  return new AccountApiError(error.error.message, error.error.code, error.error.fields);
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method: body === undefined ? "GET" : "POST",
    credentials: "include"
  };

  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }

  const response = await fetch(path, {
    ...init
  });

  if (!response.ok) {
    throw await responseError(response);
  }

  return parseJson<T>(response);
}

export async function createUser(input: CreateUserInput): Promise<{ user: User } | VerificationState> {
  return request<{ user: User } | VerificationState>("/api/users", input);
}

export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult | VerificationState> {
  return request<CreateSessionResult | VerificationState>("/api/sessions", input);
}

export async function verifyRegistrationEmail(verificationId: string, code: string): Promise<void> {
  await request(`/api/email-verifications/${encodeURIComponent(verificationId)}/verify`, { code });
}

export async function resendRegistrationEmail(verificationId: string): Promise<VerificationState> {
  return request(`/api/email-verifications/${encodeURIComponent(verificationId)}/deliveries`, {});
}

export async function requestPasswordReset(email: string): Promise<VerificationState> {
  return request("/api/password-reset-attempts", { email });
}

export async function verifyPasswordResetCode(attemptId: string, code: string): Promise<{ resetGrant: string; expiresIn: number }> {
  return request(`/api/password-reset-attempts/${encodeURIComponent(attemptId)}/verify`, { code });
}

export async function resetPassword(input: {
  resetGrant: string;
  password: string;
  confirmPassword: string;
}): Promise<void> {
  await request("/api/password-resets", input);
}

export async function deleteCurrentSession(): Promise<void> {
  const response = await fetch("/api/sessions/current", {
    method: "DELETE",
    credentials: "include"
  });

  if (!response.ok) {
    throw await responseError(response);
  }
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    const response = await request<{ user: User }>("/api/users/me");
    return response.user;
  } catch (error) {
    if (error instanceof AccountApiError && error.code === "unauthenticated") {
      return null;
    }
    throw error;
  }
}
