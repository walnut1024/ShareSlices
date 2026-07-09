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
    const error = await parseJson<ErrorResponse>(response);
    throw new AccountApiError(error.error.message, error.error.code, error.error.fields);
  }

  return parseJson<T>(response);
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const response = await request<{ user: User }>("/api/users", input);
  return response.user;
}

export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
  return request<CreateSessionResult>("/api/sessions", input);
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
