import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={[
        "inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium",
        variant === "primary"
          ? "bg-neutral-950 text-white hover:bg-neutral-800"
          : "bg-white text-neutral-900 ring-1 ring-neutral-200 hover:bg-neutral-50",
        "transition-colors disabled:pointer-events-none disabled:opacity-50",
        className ?? ""
      ].join(" ")}
    />
  );
}
