import type { GalleryCard as GalleryCardModel } from "../api/gallery";
import { destinations } from "../routing";
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
    <Card className="group min-w-0 overflow-hidden rounded-2xl py-0 shadow-sm transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <a
        aria-label={`Open ${item.title}`}
        href={destinations.listing(item.slug)}
        className="block rounded-t-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <CardContent className="p-0">
          <AspectRatio ratio={16 / 10} className="overflow-hidden bg-muted">
          {item.cover.state === "ready" && item.cover.url ? (
            <img
              alt=""
              className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              src={item.cover.url}
            />
          ) : (
            <div
              aria-label={`No cover available for ${item.title}`}
              className="grid size-full place-items-center bg-muted"
              role="img"
            >
              <span aria-hidden="true" className="text-4xl font-semibold text-muted-foreground/30">
                {item.title.slice(0, 1).toUpperCase()}
              </span>
            </div>
          )}
          </AspectRatio>
        </CardContent>
        <CardHeader className="gap-1.5 border-t px-3.5 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="truncate text-sm font-semibold leading-snug tracking-[-0.01em]">
              {item.title}
            </h2>
            <time className="shrink-0 text-[11px] text-muted-foreground" dateTime={item.createdAt}>
              {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(item.createdAt))}
            </time>
          </div>
          <CardDescription className="truncate text-xs">
            by {item.creator.displayName}
          </CardDescription>
          {item.description ? (
            <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
              {item.description}
            </p>
          ) : null}
        </CardHeader>
      </a>
      <CardFooter className="flex min-h-11 flex-wrap gap-1.5 border-t bg-background px-3.5 py-2.5">
        {item.tags.map((tag) => (
          <Badge key={tag} variant="outline" render={<a href={destinations.browse({ mode: "tag", query: tag })} />}>
            {tag}
          </Badge>
        ))}
      </CardFooter>
    </Card>
  );
}
