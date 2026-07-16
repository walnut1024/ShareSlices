import { Readable } from "node:stream";
import type { Pool } from "pg";
import type { GalleryContentBinding } from "../application/gallery/content-credentials.js";
import type { ObjectStorage } from "../storage/object-storage.js";

export type BoundGalleryAsset = Readonly<{objectKey:string;contentType:string;sizeBytes:number}>;

export class PostgresGalleryContentLookup {
  constructor(private readonly pool:Pool){}
  async resolve(binding:unknown,path:string):Promise<BoundGalleryAsset|null>{const versionId=(binding as GalleryContentBinding).versionId;const requested=path||null;const {rows}=await this.pool.query(`select asset.object_key,asset.content_type,asset.size_bytes
    from artifact_version version join content_bundle_manifest manifest on manifest.bundle_id=version.content_bundle_id
    join content_bundle_asset asset on asset.bundle_id=manifest.bundle_id and asset.owner_user_id=manifest.owner_user_id and asset.path=coalesce($2,manifest.entry_path)
    where version.id=$1 and version.state='ready'`,[versionId,requested]);const row=rows[0];return row?{objectKey:row.object_key,contentType:row.content_type,sizeBytes:Number(row.size_bytes)}:null;}
}

export class GalleryContentObjectStorage {
  constructor(private readonly storage:ObjectStorage){}
  async stream(asset:unknown):Promise<Response>{const bound=asset as BoundGalleryAsset;const object=await this.storage.readCommittedObject(bound.objectKey);const body=Readable.toWeb(Readable.from(object.body)) as ReadableStream<Uint8Array>;return new Response(body,{headers:{"Content-Type":bound.contentType,"Content-Length":String(bound.sizeBytes)}});}
}
