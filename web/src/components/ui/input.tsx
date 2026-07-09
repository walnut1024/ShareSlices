import type { InputHTMLAttributes } from "react";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm outline-none",
        "focus:border-neutral-950 focus:ring-2 focus:ring-neutral-950/10",
        props.className ?? ""
      ].join(" ")}
    />
  );
}
