import { ExternalLinkIcon, InfoIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getOwnerGalleryListing,
  type OwnerGalleryListing,
} from "../api/gallery";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";

type PendingShare = {
  artifactId: string;
  artifactName: string;
  listingId: string;
  listingRevision: number;
  submittedAt: number;
  attempt: number;
};

type GalleryNotice = {
  artifactId: string;
  artifactName: string;
  listingId: string;
  listingRevision: number;
  kind: "live" | "review" | "attention";
  publicUrl: string | null;
};

type StoredFeedback = {pending: PendingShare[]; notices: GalleryNotice[]};

type RegisterShare = (
  artifact: {id: string; name: string},
  listing: OwnerGalleryListing,
) => void;

const FeedbackContext = createContext<RegisterShare>(() => undefined);
const DELAYS = [2_000, 4_000, 8_000, 15_000, 30_000] as const;
const CONTINUOUS_MONITOR_MS = 5 * 60_000;

export function useGalleryShareFeedback(): RegisterShare {
  return useContext(FeedbackContext);
}

export function GalleryShareFeedbackProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const storageKey = useMemo(
    () => `shareslices.gallery-share-feedback.v1:${userId}`,
    [userId],
  );
  const initial = useMemo(() => readStoredFeedback(storageKey), [storageKey]);
  const [pending, setPending] = useState<PendingShare[]>(initial.pending);
  const [notices, setNotices] = useState<GalleryNotice[]>(initial.notices);
  const pendingRef = useRef(pending);
  const noticesRef = useRef(notices);
  const timers = useRef(new Map<string, number>());
  const inFlight = useRef(new Set<string>());

  const persist = useCallback((nextPending: PendingShare[], nextNotices: GalleryNotice[]) => {
    pendingRef.current = nextPending;
    noticesRef.current = nextNotices;
    setPending(nextPending);
    setNotices(nextNotices);
    writeStoredFeedback(storageKey, {pending: nextPending, notices: nextNotices});
  }, [storageKey]);

  const clearTimer = useCallback((artifactId: string) => {
    const timer = timers.current.get(artifactId);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(artifactId);
  }, []);

  const applyProjection = useCallback((record: PendingShare, listing: OwnerGalleryListing | null) => {
    if (!listing || listing.id !== record.listingId) {
      clearTimer(record.artifactId);
      persist(
        pendingRef.current.filter((item) => item.artifactId !== record.artifactId),
        noticesRef.current,
      );
      return "terminal" as const;
    }

    const nextRecord = {
      ...record,
      listingRevision: listing.listingRevision,
      attempt: record.attempt + 1,
    };
    const kind = noticeKind(listing);
    if (!kind) {
      persist(
        pendingRef.current.map((item) => item.artifactId === record.artifactId ? nextRecord : item),
        noticesRef.current,
      );
      return "pending" as const;
    }

    const notice: GalleryNotice = {
      artifactId: record.artifactId,
      artifactName: record.artifactName,
      listingId: listing.id,
      listingRevision: listing.listingRevision,
      kind,
      publicUrl: kind === "live" ? listing.publicUrl : null,
    };
    const nextNotices = [
      ...noticesRef.current.filter((item) => item.artifactId !== record.artifactId),
      notice,
    ];
    const terminal = kind !== "review";
    persist(
      terminal
        ? pendingRef.current.filter((item) => item.artifactId !== record.artifactId)
        : pendingRef.current.map((item) => item.artifactId === record.artifactId ? nextRecord : item),
      nextNotices,
    );
    if (terminal) clearTimer(record.artifactId);
    return terminal ? "terminal" as const : "pending" as const;
  }, [clearTimer, persist]);

  const check = useCallback(async (artifactId: string) => {
    const record = pendingRef.current.find((item) => item.artifactId === artifactId);
    if (!record || document.visibilityState === "hidden" || inFlight.current.has(artifactId)) return;
    inFlight.current.add(artifactId);
    try {
      const listing = await getOwnerGalleryListing(artifactId);
      applyProjection(record, listing);
    } catch {
      // A temporary read failure is retried within the same bounded schedule.
    } finally {
      inFlight.current.delete(artifactId);
    }
  }, [applyProjection]);

  const schedule = useCallback((record: PendingShare) => {
    clearTimer(record.artifactId);
    if (Date.now() - record.submittedAt >= CONTINUOUS_MONITOR_MS) return;
    const delay = DELAYS[Math.min(record.attempt, DELAYS.length - 1)];
    const timer = window.setTimeout(async () => {
      await check(record.artifactId);
      const current = pendingRef.current.find((item) => item.artifactId === record.artifactId);
      if (current) schedule(current);
    }, delay);
    timers.current.set(record.artifactId, timer);
  }, [check, clearTimer]);

  const register = useCallback<RegisterShare>((artifact, listing) => {
    const record: PendingShare = {
      artifactId: artifact.id,
      artifactName: artifact.name,
      listingId: listing.id,
      listingRevision: listing.listingRevision,
      submittedAt: Date.now(),
      attempt: -1,
    };
    const withoutArtifact = pendingRef.current.filter((item) => item.artifactId !== artifact.id);
    persist([...withoutArtifact, record], noticesRef.current.filter((item) => item.artifactId !== artifact.id));
    const state = applyProjection(record, listing);
    if (state === "pending") {
      const current = pendingRef.current.find((item) => item.artifactId === artifact.id);
      if (current) schedule(current);
    }
  }, [applyProjection, persist, schedule]);

  const recover = useCallback(() => {
    if (document.visibilityState === "hidden") return;
    for (const record of pendingRef.current) {
      void check(record.artifactId).finally(() => {
        const current = pendingRef.current.find((item) => item.artifactId === record.artifactId);
        if (current && Date.now() - current.submittedAt < CONTINUOUS_MONITOR_MS) schedule(current);
      });
    }
  }, [check, schedule]);

  useEffect(() => {
    recover();
    const onFocus = () => recover();
    const onVisibility = () => document.visibilityState === "visible" && recover();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
    };
  }, [recover]);

  const dismiss = (artifactId: string) => {
    persist(pendingRef.current, noticesRef.current.filter((notice) => notice.artifactId !== artifactId));
  };

  return (
    <FeedbackContext.Provider value={register}>
      {notices.length ? (
        <section aria-label="Gallery sharing updates" className="mb-5 grid gap-3">
          {notices.map((notice) => (
            <GalleryFeedbackAlert key={`${notice.listingId}:${notice.listingRevision}:${notice.kind}`} notice={notice} onDismiss={() => dismiss(notice.artifactId)} />
          ))}
        </section>
      ) : null}
      {children}
    </FeedbackContext.Provider>
  );
}

function GalleryFeedbackAlert({notice, onDismiss}: {notice: GalleryNotice; onDismiss: () => void}) {
  const live = notice.kind === "live";
  return (
    <Alert variant={notice.kind === "attention" ? "destructive" : "default"}>
      {notice.kind === "attention" ? <TriangleAlertIcon /> : <InfoIcon />}
      <AlertTitle>{live ? "Now live in Gallery" : notice.kind === "review" ? "Gallery submission is under review." : "Gallery submission needs attention."}</AlertTitle>
      <AlertDescription>
        {live ? `“${notice.artifactName}” is now visible to everyone in Gallery.` : null}
        <span className={live ? "ml-2" : ""}>
          {live && notice.publicUrl ? (
            <a href={notice.publicUrl} target="_blank" rel="noopener noreferrer" onClick={onDismiss}>
              View in Gallery <ExternalLinkIcon aria-hidden="true" className="inline size-3" />
            </a>
          ) : (
            <a href={`/artifacts/${encodeURIComponent(notice.artifactId)}?gallery=manage`} onClick={onDismiss}>Manage Gallery</a>
          )}
        </span>
      </AlertDescription>
      <AlertAction>
        <Button aria-label="Dismiss Gallery update" size="icon-sm" variant="ghost" onClick={onDismiss}><XIcon /></Button>
      </AlertAction>
    </Alert>
  );
}

function noticeKind(listing: OwnerGalleryListing): GalleryNotice["kind"] | null {
  if (listing.lifecycle === "listed" && listing.effectiveAccess.accessible && listing.publicUrl) return "live";
  if (listing.lifecycle === "pending" && listing.reviewState === "reviewing") return "review";
  if (listing.lifecycle === "withdrawn" || listing.lifecycle === "removed" || listing.reviewState === "restricted" || listing.lifecycle === "listed") return "attention";
  return null;
}

function readStoredFeedback(key: string): StoredFeedback {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "null") as StoredFeedback | null;
    return {pending: Array.isArray(value?.pending) ? value.pending : [], notices: Array.isArray(value?.notices) ? value.notices : []};
  } catch {
    return {pending: [], notices: []};
  }
}

function writeStoredFeedback(key: string, value: StoredFeedback) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Feedback persistence is best effort; Server state remains authoritative.
  }
}
