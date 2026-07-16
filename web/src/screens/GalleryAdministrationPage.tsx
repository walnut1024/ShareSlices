import { useEffect, useState } from "react";
import {
  decideGalleryCase,
  listGalleryGovernanceCases,
  listGalleryNotifications,
  type GalleryGovernanceCase,
} from "../api/gallery";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "../components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Separator } from "../components/ui/separator";
import { Spinner } from "../components/ui/spinner";
import { Textarea } from "../components/ui/textarea";

type GalleryNotification = {
  id: string;
  category: string;
  rule: string;
  currentEffect: string;
  appeal: { deadlineAt: string } | null;
  createdAt: string;
};

export function GalleryAdministrationPage() {
  const [cases, setCases] = useState<GalleryGovernanceCase[]>([]);
  const [notifications, setNotifications] = useState<GalleryNotification[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ruleCode, setRuleCode] = useState("gallery_policy");
  const [rationale, setRationale] = useState("");
  const [decidingId, setDecidingId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listGalleryGovernanceCases(), listGalleryNotifications()])
      .then(([nextCases, nextNotifications]) => {
        setCases(nextCases);
        setNotifications(nextNotifications);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Gallery administration is unavailable."))
      .finally(() => setLoaded(true));
  }, []);

  async function decide(item: GalleryGovernanceCase, decision: string) {
    setDecidingId(item.id);
    try {
      await decideGalleryCase(item.id, {
        decision,
        expectedListingRevision: item.listingRevision,
        ruleCode,
        rationale,
      }, crypto.randomUUID());
      setCases((current) => current.filter((entry) => entry.id !== item.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Decision failed.");
    } finally {
      setDecidingId(null);
    }
  }

  return (
    <div className="grid gap-8">
      <header>
        <h1 className="text-2xl font-semibold">Gallery administration</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review durable proposals, reports, Appeals, restrictions, and takedowns.</p>
      </header>

      {error ? <Alert variant="destructive"><AlertTitle>Authorization or dependency failure</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

      <section className="grid gap-4" aria-labelledby="decision-queue-heading">
        <div>
          <h2 id="decision-queue-heading" className="text-lg font-medium">Decision queue</h2>
          <p className="text-sm text-muted-foreground">Apply one rule and rationale to the next reviewed case.</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Decision evidence</CardTitle>
            <CardDescription>These values are submitted unchanged with the selected case decision.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="gallery-admin-rule">Rule code</FieldLabel>
                <Input id="gallery-admin-rule" value={ruleCode} maxLength={200} onChange={(event) => setRuleCode(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="gallery-admin-rationale">Administrative rationale</FieldLabel>
                <Textarea id="gallery-admin-rationale" value={rationale} maxLength={8000} onChange={(event) => setRationale(event.target.value)} />
                <FieldDescription>Required before a governance decision can be submitted.</FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        {!loaded ? (
          <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />Loading decision queue…</div>
        ) : cases.length === 0 ? (
          <Empty className="border"><EmptyHeader><EmptyTitle>No open cases</EmptyTitle><EmptyDescription>The governance queue has no work awaiting a decision.</EmptyDescription></EmptyHeader></Empty>
        ) : cases.map((item) => (
          <GovernanceCaseCard
            key={item.id}
            item={item}
            pending={decidingId === item.id}
            canDecide={Boolean(rationale.trim())}
            onDecide={(decision) => void decide(item, decision)}
          />
        ))}
      </section>

      <Separator />

      <section className="grid gap-4" aria-labelledby="notification-inbox-heading">
        <div>
          <h2 id="notification-inbox-heading" className="text-lg font-medium">Notification inbox</h2>
          <p className="text-sm text-muted-foreground">Durable Gallery governance notices for this administrator.</p>
        </div>
        {loaded && notifications.length === 0 ? (
          <Empty className="border"><EmptyHeader><EmptyTitle>No notifications</EmptyTitle><EmptyDescription>No Gallery governance notice needs attention.</EmptyDescription></EmptyHeader></Empty>
        ) : notifications.map((item) => <NotificationCard key={item.id} item={item} />)}
      </section>
    </div>
  );
}

function GovernanceCaseCard({ item, pending, canDecide, onDecide }: {
  item: GalleryGovernanceCase;
  pending: boolean;
  canDecide: boolean;
  onDecide: (decision: string) => void;
}) {
  return (
    <Card aria-busy={pending}>
      <CardHeader>
        <CardTitle>{item.queue.replaceAll("_", " ")}</CardTitle>
        <CardDescription>Listing revision {item.listingRevision}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.plainTextEvidence ?? "Evidence is available in the case-bound review."}</p>
      </CardContent>
      <CardFooter className="flex-wrap gap-2">
        {pending ? <Spinner /> : null}
        {item.allowedDecisions.map((kind) => <Button key={kind} size="sm" variant="outline" disabled={!canDecide} onClick={() => onDecide(kind)}>{kind.replaceAll("_", " ")}</Button>)}
      </CardFooter>
    </Card>
  );
}

function NotificationCard({ item }: { item: GalleryNotification }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{item.category.replaceAll("_", " ")}</CardTitle>
        <CardDescription>{new Date(item.createdAt).toLocaleString()}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Badge variant="outline">{item.rule}</Badge>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.currentEffect}</p>
      </CardContent>
      {item.appeal ? <CardFooter><span className="text-xs text-muted-foreground">Appeal by {new Date(item.appeal.deadlineAt).toLocaleString()}</span></CardFooter> : null}
    </Card>
  );
}
