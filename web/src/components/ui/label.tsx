import type { LabelHTMLAttributes } from "react";

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={["text-sm font-medium text-neutral-950", props.className ?? ""].join(" ")} />;
}
