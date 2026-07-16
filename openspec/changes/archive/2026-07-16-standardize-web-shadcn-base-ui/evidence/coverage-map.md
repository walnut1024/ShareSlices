# Web interface behavior coverage map

| Surface or boundary | Existing coverage | Missing lock added by this change |
| --- | --- | --- |
| Management navigation | `artifact-management.test.tsx` | Direct Gallery administration access and continued absence of Admin navigation |
| Gallery administration | `gallery-pages.test.tsx`, Gallery API tests | Loaded, empty, authorization failure, decision payload, revision, and request count |
| Creator profile | `GalleryProfilePage.test.tsx`, Gallery API tests | Upload-before-update order, removal, success versus error, revision conflict, and request count |
| Public Gallery listing/detail/Creator | `gallery-pages.test.tsx`, `gallery-isolated.spec.ts` | Presentation-only assertions remain covered by visual matrix; security and behavior coverage already exists |
| Account entry | `account-entry.test.tsx`, account API tests | Native-action replacement preserves resend timer, change-email, return-to-login, and request order |
| CLI device authorization | `device-authorization.test.tsx`, `cli-browser-auth.spec.ts`, CLI auth API tests | Presentation states retain claimed, expired, unavailable, approve, deny, and terminal outcomes |
| Artifact grid/list/actions | `artifact-management.test.tsx`, `artifact-card-layout.spec.ts` | Transparent selection target, nested actions, and distinct Share with link versus Share to Gallery controls |
| Artifact detail/Preview/Player | `artifact-management.test.tsx`, `ArtifactPlayer.test.tsx`, `first-share-flow.spec.ts` | Semantic status and feedback preserve iframe URL, sandbox, sizing, and Full-screen controls |
| Gallery Player | `GalleryArtifactPlayer.test.tsx`, `gallery-isolated.spec.ts` | Existing sandbox and trusted-parent coverage is sufficient |
| Upload Dropzone | archive preflight and upload preparation tests, `first-share-flow.spec.ts` | Existing accepted-input and preflight coverage is sufficient |

Only gaps listed in the final column require new assertions. Existing API, route, and product-contract tests are not duplicated.
