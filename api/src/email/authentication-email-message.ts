import type { AuthenticationEmailPayload } from "../application/accounts/authentication-email.js";

export type AuthenticationEmailMessage = Readonly<{
  subject: string;
  text: string;
  html: string;
}>;

export function renderAuthenticationEmailMessage(
  payload: AuthenticationEmailPayload,
): AuthenticationEmailMessage {
  if (payload.type === "password-changed") {
    return {
      subject: "Your ShareSlices password was changed",
      text: "Your ShareSlices password was changed. If you did not make this change, contact your administrator.",
      html: "<p>Your ShareSlices password was changed.</p><p>If you did not make this change, contact your administrator.</p>",
    };
  }

  if (payload.type !== "email-verification" && payload.type !== "forget-password") {
    throw new Error(`Unsupported authentication email type: ${payload.type}`);
  }
  const registration = payload.type === "email-verification";
  const subject = registration ? "Verify your ShareSlices email" : "Reset your ShareSlices password";
  const action = registration ? "verify your email" : "reset your password";
  const code = payload.otp ?? "";
  return {
    subject,
    text: `Use this code to ${action}: ${code}\n\nThis code expires in 10 minutes. If you did not request this, ignore this email.`,
    html: `<p>Use this code to ${action}:</p><p><strong>${code}</strong></p><p>This code expires in 10 minutes.</p><p>If you did not request this, ignore this email.</p>`,
  };
}
