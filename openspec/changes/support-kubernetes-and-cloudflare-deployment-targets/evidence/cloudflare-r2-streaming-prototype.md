# Cloudflare R2 streaming prototype evidence

## Scope

On 2026-07-20, a disposable private R2 bucket and two route-free Workers tested
bounded streaming through a production Service Binding. The storage Worker had
only an R2 binding and a probe Secret. The verifier had only a Service Binding,
the same probe Secret, and a temporary one-minute Cron trigger. Neither Worker
used `workers.dev`, a route, a custom domain, `r2.dev`, or a public bucket
domain.

The test generated payloads into `FixedLengthStream` instances in 64 KiB
chunks. The storage Worker passed request bodies directly to `R2Bucket.put()` or
`R2MultipartUpload.uploadPart()` and returned `R2ObjectBody.body` directly in
the response. It did not call `arrayBuffer()`, `blob()`, `text()`, or otherwise
materialize a complete accepted payload in isolate memory.

## Passing result

The scheduled edge verifier emitted:

```json
{"event":"r2_streaming_verified","evidence":{"upload":{"bytes":6291475,"streaming":"passed"},"download":{"bytes":6291475,"maximumObservedChunk":4096},"export":{"bytes":6291475,"maximumObservedChunk":4096},"range":{"offset":3145739,"bytes":4096,"status":206},"multipart":{"bytes":6291463,"parts":2,"maximumObservedChunk":4096},"bucketExposure":"binding_only"}}
```

This proves the disposable implementation could:

- upload 6 MiB plus 19 bytes through a bounded request stream;
- stream the complete private object back through Download and attachment
  Export responses;
- return a 4 KiB R2 range with status `206` and `Content-Range`;
- create, resume, upload, and complete a two-part private R2 multipart upload,
  including a 5 MiB non-final part;
- stream and validate the completed multipart object; and
- delete test-owned objects by exact key and clean an isolated test prefix.

The maximum response chunk observed by the verifier was 4 KiB. This is an
observation, not a promised Cloudflare chunk size; the contract is that the
implementation consumes each supplied chunk without accumulating the complete
object.

## Runtime findings

The first Service Binding attempt used a generic `ReadableStream` plus a
`Content-Length` header. Cloudflare rejected it with:

```text
Provided readable stream must have a known length (request/response body or readable half of FixedLengthStream)
```

The passing implementation uses the readable half of `FixedLengthStream`.
Therefore a Cloudflare request Adapter that knows the accepted length must
preserve it in the stream primitive rather than only copying the HTTP header.

The first integrity verifier also exceeded the account's Worker CPU limit
because test code generated and compared every byte across repeated multi-MiB
transfers. The passing verifier uses native chunk fill, total-byte accounting,
and samples at response-chunk and 64 KiB payload boundaries. This changes only
the disposable verifier's CPU cost; the storage Worker still streams every
byte.

An R2 full-object response exposed `R2ObjectBody.range` even though the request
was not a Range request. The response Adapter must decide `200` versus `206`
from validated request intent, not merely from the presence of that property.

Official Workers API reference:
<https://developers.cloudflare.com/r2/api/workers/workers-api-reference/>.

## Cleanup and boundary

After the passing result, both Workers, the Cron trigger, all test objects, and
the disposable bucket were deleted. A final bucket listing was empty. An
earlier CPU-terminated verifier had skipped its `finally` cleanup and left an
object, so final cleanup explicitly listed and deleted the isolated
`feasibility/` prefix before deleting the bucket. Deployment automation must
likewise treat termination-safe cleanup as a separate resumable operation.

This evidence completes task 1.5. It does not prove the configured Upload limit
against the account request limit, generated Static Assets limits, production
authorization, or release automation assigned to later tasks.
