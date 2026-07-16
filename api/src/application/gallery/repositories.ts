import type { GalleryCopyProjection, GalleryListingProjection } from "./domain.js";

export type GalleryProfileRecord = Readonly<{
  id: string;
  userId: string;
  opaqueSlug: string;
  displayName: string;
  biography: string | null;
  avatar: Readonly<{objectKey: string; contentType: "image/png" | "image/jpeg" | "image/webp"; width: number; height: number}> | null;
  revision: number;
  publicAt: Date | null;
  retiredAt: Date | null;
}>;

export type GalleryGrantEvidenceRecord = Readonly<{
  id: string;
  userId: string;
  listingId: string;
  grantVersion: string;
  grantTextDigest: string;
  acceptedAt: Date;
}>;

export interface GalleryListingRepository {
  findOwnerListing(ownerUserId: string, artifactId: string): Promise<GalleryListingProjection | null>;
  findByIdForUpdate(listingId: string): Promise<GalleryListingProjection | null>;
  findProfileByUser(userId: string): Promise<GalleryProfileRecord | null>;
  findGrantEvidence(listingId: string): Promise<GalleryGrantEvidenceRecord[]>;
  incrementEngagement(listingId: string, kind: "view" | "download" | "copy"): Promise<void>;
}

export interface GalleryCoverQueue {
  enqueue(versionId: string, rendererRevision: string): Promise<Readonly<{coverId: string; state: "pending" | "ready" | "failed"}>>;
}

export type GalleryDiscoveryCursor = Readonly<{ primary: string; listingId: string }>;
export type GalleryDiscoveryCard = Readonly<{
  listingId: string;
  opaqueSlug: string;
  title: string;
  description: string | null;
  tags: readonly string[];
  creatorSlug: string;
  creatorDisplayName: string;
  createdAt: Date;
}>;

export interface GalleryDiscoveryRepository {
  listEligible(input: Readonly<{
    mode: "default" | "newest" | "featured" | "search" | "tag" | "creator";
    query?: string;
    cursor?: GalleryDiscoveryCursor;
    limit: number;
  }>): Promise<GalleryDiscoveryCard[]>;
}

export type GalleryGovernanceCaseRecord = Readonly<{
  id: string;
  kind: string;
  state: "open" | "decided" | "moot";
  evidenceSnapshot: Readonly<Record<string, unknown>>;
  evidenceDigest: string;
}>;

export interface GalleryGovernanceRepository {
  findCase(caseId: string): Promise<GalleryGovernanceCaseRecord | null>;
  hasActiveAdministratorAuthority(userId: string): Promise<boolean>;
  hasEffectiveBlock(artifactId: string): Promise<boolean>;
}

export interface GalleryCopyRepository {
  findOperation(copierUserId: string, operationId: string): Promise<GalleryCopyProjection | null>;
  hasLiveSourceReference(versionId: string): Promise<boolean>;
  findRootProvenance(artifactId: string): Promise<Readonly<Record<string, unknown>> | null>;
}

export type GalleryNotificationRecord = Readonly<{
  id: string;
  category: string;
  ruleCode: string;
  currentEffect: string;
  createdAt: Date;
}>;

export interface GalleryNotificationRepository {
  listForRecipient(userId: string, limit: number): Promise<GalleryNotificationRecord[]>;
}

export interface GalleryRetentionRepository {
  hasLiveDownloadLease(versionId: string): Promise<boolean>;
  listExpiredPrivacyRecords(limit: number): Promise<readonly string[]>;
}
