import type { HTMLAttributes } from "react";

export function Alert(props: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="alert"
      {...props}
      className={["rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700", props.className ?? ""].join(" ")}
    />
  );
}
