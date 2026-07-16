import { Maximize, Minimize } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function ArtifactPlayer({
  contentUrl,
  className,
  fullscreenTargetRef,
  onFullscreenExit,
  onFullscreenError,
  sandbox,
  allowChildFullscreen = true,
  contentTitle = "Artifact content"
}: {
  contentUrl: string;
  className?: string;
  fullscreenTargetRef?: RefObject<HTMLElement | null>;
  onFullscreenExit?: () => void;
  onFullscreenError?: (message: string) => void;
  sandbox?: string;
  allowChildFullscreen?: boolean;
  contentTitle?: string;
}) {
  const playerRef = useRef<HTMLDivElement>(null);
  const targetRef = fullscreenTargetRef ?? playerRef;
  const onExitRef = useRef(onFullscreenExit);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasFullscreenRef = useRef(false);
  onExitRef.current = onFullscreenExit;

  useEffect(() => {
    function syncFullscreenState() {
      const target = targetRef.current;
      const active = document.fullscreenElement;
      const ownsFullscreen = Boolean(target && active && (active === target || target.contains(active)));
      setIsFullscreen(ownsFullscreen);
      if (wasFullscreenRef.current && !ownsFullscreen) onExitRef.current?.();
      wasFullscreenRef.current = ownsFullscreen;
    }

    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, [targetRef]);

  async function toggleFullscreen() {
    setError(null);
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      const target = targetRef.current;
      if (!target?.requestFullscreen) throw new TypeError("Fullscreen API unavailable");
      await target.requestFullscreen();
    } catch {
      const message = "Full screen could not be opened.";
      setError(message);
      onFullscreenError?.(message);
    }
  }

  const label = isFullscreen ? "Exit full screen" : "Enter full screen";
  const Icon = isFullscreen ? Minimize : Maximize;

  return (
    <div
      ref={playerRef}
      className={cn("relative size-full min-h-0 overflow-hidden bg-neutral-950", className)}
      data-testid="artifact-player"
    >
      <iframe
        allow={allowChildFullscreen ? "fullscreen" : undefined}
        className="block size-full border-0 bg-neutral-950"
        sandbox={sandbox}
        src={contentUrl}
        title={contentTitle}
      />
      <div className="absolute top-3 right-3 z-10">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={label}
                className="border-white/20 bg-neutral-900/90 text-white hover:bg-neutral-800 hover:text-white"
                size="icon"
                type="button"
                variant="outline"
                onClick={() => void toggleFullscreen()}
              />
            }
          >
            <Icon aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </div>
      {error ? (
        <Alert className="absolute top-14 right-3 z-10 w-auto max-w-sm" variant="destructive" role="status"><AlertDescription>{error}</AlertDescription></Alert>
      ) : null}
    </div>
  );
}
