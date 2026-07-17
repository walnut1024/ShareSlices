import type { GalleryCard as GalleryCardModel } from "../api/gallery";
import { AspectRatio } from "./ui/aspect-ratio";
import { Badge } from "./ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "./ui/card";

export function GalleryCard({ item }: { item: GalleryCardModel }) {
  return (
    <Card className="group min-w-0 overflow-hidden py-0 transition-shadow hover:shadow-md">
      <a href={`/gallery/${encodeURIComponent(item.slug)}`} className="block">
        <CardContent className="p-0">
          <AspectRatio ratio={16 / 9} className="overflow-hidden bg-muted">
          {item.cover.state === "ready" && item.cover.url ? (
            <img
              alt=""
              className="size-full object-cover transition-transform group-hover:scale-[1.02]"
              src={item.cover.url}
            />
          ) : (
            <div className="grid size-full place-items-center bg-muted">
              <span className="text-4xl font-semibold text-muted-foreground/30">
                {item.title.slice(0, 1).toUpperCase()}
              </span>
            </div>
          )}
          </AspectRatio>
        </CardContent>
        <CardHeader className="gap-1.5 border-t px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <h2 className="truncate text-sm font-medium leading-snug">
              {item.title}
            </h2>
            <time className="shrink-0 text-xs text-muted-foreground" dateTime={item.createdAt}>
              {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(item.createdAt))}
            </time>
          </div>
          <CardDescription className="truncate">
            by {item.creator.displayName}
          </CardDescription>
          {item.description ? (
            <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
              {item.description}
            </p>
          ) : null}
        </CardHeader>
      </a>
      <CardFooter className="flex min-h-11 flex-wrap gap-1.5 border-t px-3 py-2">
        {item.tags.map((tag) => (
          <Badge key={tag} variant="secondary" render={<a href={`/?tag=${encodeURIComponent(tag)}`} />}>
            {tag}
          </Badge>
        ))}
      </CardFooter>
    </Card>
  );
}
