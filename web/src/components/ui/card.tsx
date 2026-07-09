import type { HTMLAttributes } from "react";

export function Card(props: HTMLAttributes<HTMLDivElement>) {
  return <section {...props} className={["rounded-lg border border-neutral-200 bg-white shadow-sm", props.className ?? ""].join(" ")} />;
}

export function CardHeader(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={["space-y-1.5 p-6", props.className ?? ""].join(" ")} />;
}

export function CardTitle(props: HTMLAttributes<HTMLHeadingElement>) {
  return <h1 {...props} className={["text-2xl font-semibold tracking-normal text-neutral-950", props.className ?? ""].join(" ")} />;
}

export function CardDescription(props: HTMLAttributes<HTMLParagraphElement>) {
  return <p {...props} className={["text-sm text-neutral-500", props.className ?? ""].join(" ")} />;
}

export function CardContent(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={["space-y-4 p-6 pt-0", props.className ?? ""].join(" ")} />;
}
