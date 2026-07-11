import type { ReactNode } from "react";
import { Card, CardContent } from "./ui/card";

function Brand() {
  return (
    <div className="flex items-center gap-2.5" aria-label="ShareSlices">
      <div className="flex flex-col gap-[3px]" aria-hidden="true">
        <span className="h-1 w-5 rounded-[1px] bg-neutral-950" />
        <span className="h-1 w-5 rounded-[1px] bg-neutral-950/50" />
        <span className="h-1 w-5 rounded-[1px] bg-neutral-950/20" />
      </div>
      <span className="text-base font-semibold tracking-[-0.01em]">ShareSlices</span>
    </div>
  );
}

export function AuthScreenLayout({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-8 py-8">
      <Card className="min-h-[640px] w-[880px] flex-row gap-0 overflow-hidden py-0">
        <CardContent className="flex min-w-0 flex-1 flex-col px-14 py-10">
          <Brand />
          <div className="my-auto w-full max-w-[320px] py-11">{children}</div>
          {footer ? <div className="text-xs text-neutral-400">{footer}</div> : null}
        </CardContent>
        <aside className="flex w-[340px] flex-none flex-col justify-center bg-neutral-950 px-10 py-14 text-neutral-50">
          <h2 className="m-0 text-2xl font-semibold leading-tight tracking-[-0.015em]">
            Give Every Idea An Audience
          </h2>
          <p className="mt-3.5 text-[13.5px] leading-[1.55] text-neutral-400">
            Bring your team’s best thinking together and keep sharing as it evolves.
          </p>
        </aside>
      </Card>
    </main>
  );
}
