import { useEffect, useState } from "react";
import { ImagePlus } from "lucide-react";
import { getOwnGalleryProfile, updateOwnGalleryProfile, uploadGalleryAvatar, type GalleryProfile } from "../api/gallery";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Checkbox } from "../components/ui/checkbox";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Spinner } from "../components/ui/spinner";
import { Textarea } from "../components/ui/textarea";

type Feedback = { kind: "success" | "error"; message: string } | null;

export function GalleryProfilePage() {
  const [profile, setProfile] = useState<GalleryProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [biography, setBiography] = useState("");
  const [avatar, setAvatar] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    void getOwnGalleryProfile()
      .then((value) => {
        setProfile(value);
        setDisplayName(value?.displayName ?? "");
        setBiography(value?.biography ?? "");
      })
      .catch((error: unknown) => setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Gallery profile could not be loaded." }))
      .finally(() => setLoaded(true));
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!profile) return;
    setPending(true);
    setFeedback(null);
    try {
      const uploaded = avatar ? await uploadGalleryAvatar(avatar) : null;
      const updated = await updateOwnGalleryProfile({
        displayName,
        biography: biography.trim() || null,
        expectedRevision: profile.revision,
        ...(uploaded ? { avatarUploadId: uploaded.avatarUploadId } : removeAvatar ? { avatarUploadId: null } : {}),
      });
      setProfile(updated);
      setAvatar(null);
      setRemoveAvatar(false);
      setFeedback({ kind: "success", message: "Gallery profile updated." });
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Gallery profile could not be updated." });
    } finally {
      setPending(false);
    }
  }

  if (!loaded) return <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />Loading Gallery profile…</div>;
  if (!profile) return <Empty className="border"><EmptyHeader><EmptyTitle>No Creator profile yet</EmptyTitle><EmptyDescription>Confirm a display name when you first share an Artifact to Gallery. ShareSlices does not use your email as a public identity.</EmptyDescription></EmptyHeader></Empty>;

  const initials = profile.displayName.slice(0, 2).toUpperCase();
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Creator profile</h1>
        <p className="mt-2 text-sm text-muted-foreground">This public identity is used only in Gallery. It is never derived from your email.</p>
      </header>
      {feedback ? <Alert variant={feedback.kind === "error" ? "destructive" : "default"}><AlertTitle>{feedback.kind === "error" ? "Profile could not be updated" : "Profile updated"}</AlertTitle><AlertDescription>{feedback.message}</AlertDescription></Alert> : null}
      <Card>
        <CardHeader>
          <CardTitle>Public Creator identity</CardTitle>
          <CardDescription>Only the display name, biography, and safe avatar below appear in Gallery.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save}>
            <FieldGroup>
              <div className="flex items-center gap-4">
                <Avatar className="size-20">
                  {profile.avatar ? <AvatarImage src={`/gallery-media/avatar/${encodeURIComponent(profile.opaqueSlug)}`} alt="" /> : null}
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0"><p className="font-medium">{profile.displayName}</p><p className="text-sm text-muted-foreground">Current public identity</p></div>
              </div>
              <Field>
                <FieldLabel htmlFor="gallery-profile-name">Display name</FieldLabel>
                <Input id="gallery-profile-name" maxLength={80} required value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="gallery-profile-biography">Biography</FieldLabel>
                <Textarea id="gallery-profile-biography" maxLength={500} value={biography} onChange={(event) => setBiography(event.target.value)} />
                <FieldDescription>Plain text shown on your public Creator page.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="gallery-profile-avatar">Safe avatar</FieldLabel>
                <Input id="gallery-profile-avatar" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setAvatar(event.target.files?.[0] ?? null); setRemoveAvatar(false); }} />
                <FieldDescription>PNG, JPEG, or WebP; up to 2 MB and 4096 × 4096.</FieldDescription>
              </Field>
              {profile.avatar ? <Field orientation="horizontal"><Checkbox id="gallery-profile-remove-avatar" checked={removeAvatar} onCheckedChange={(value) => { setRemoveAvatar(value === true); if (value === true) setAvatar(null); }} /><FieldLabel htmlFor="gallery-profile-remove-avatar">Remove current avatar</FieldLabel></Field> : null}
              <Button type="submit" disabled={pending || !displayName.trim()}>{pending ? <Spinner data-icon="inline-start" /> : <ImagePlus data-icon="inline-start" />}Save Creator profile</Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
