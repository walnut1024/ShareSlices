import type { ButtonHTMLAttributes } from "react";

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={[
        "inline-flex h-10 items-center justify-center rounded-md bg-neutral-950 px-4 text-sm font-medium text-white",
        "transition-colors hover:bg-neutral-800 disabled:pointer-events-none disabled:opacity-50",
        props.className ?? ""
      ].join(" ")}
    />
  );
}
