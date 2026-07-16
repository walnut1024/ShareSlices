import { ArtifactPlayer } from "./ArtifactPlayer";

export function GalleryArtifactPlayer({contentUrl, className}: {contentUrl: string; className?: string}) {
  return (
    <ArtifactPlayer
      allowChildFullscreen={false}
      {...(className ? {className} : {})}
      contentTitle="Gallery Artifact content"
      contentUrl={contentUrl}
      sandbox="allow-scripts"
    />
  );
}
