export type ChallengeVerification = Readonly<{
  success: boolean;
  reasonCode: "verified" | "rejected" | "unavailable";
}>;
export interface ChallengeVerifier {
  verify(
    input: Readonly<{
      token: string;
      remoteIp: string;
      expectedAction: string;
    }>,
  ): Promise<ChallengeVerification>;
}
export class TurnstileChallengeVerifier implements ChallengeVerifier {
  constructor(
    private readonly secret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async verify(
    input: Readonly<{
      token: string;
      remoteIp: string;
      expectedAction: string;
    }>,
  ): Promise<ChallengeVerification> {
    try {
      const response = await this.fetcher(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            secret: this.secret,
            response: input.token,
            remoteip: input.remoteIp,
            idempotency_key: crypto.randomUUID(),
          }),
        },
      );
      if (!response.ok) return { success: false, reasonCode: "unavailable" };
      const result = (await response.json()) as {
        success?: boolean;
        action?: string;
      };
      return result.success === true && result.action === input.expectedAction
        ? { success: true, reasonCode: "verified" }
        : { success: false, reasonCode: "rejected" };
    } catch {
      return { success: false, reasonCode: "unavailable" };
    }
  }
}
export class DeterministicChallengeVerifier implements ChallengeVerifier {
  constructor(private readonly acceptedToken = "valid-test-challenge") {}
  async verify(
    input: Readonly<{ token: string }>,
  ): Promise<ChallengeVerification> {
    return input.token === this.acceptedToken
      ? { success: true, reasonCode: "verified" }
      : { success: false, reasonCode: "rejected" };
  }
}
