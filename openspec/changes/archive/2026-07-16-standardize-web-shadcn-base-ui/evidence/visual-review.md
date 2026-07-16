# Web interface visual review

All screenshots use deterministic mocked fixtures. Paths are under ignored `output/playwright/`. Review fields are shell boundary, hierarchy, typography, control scale, spacing rhythm, card density, state presentation, navigation-boundary difference, and overflow.

| State | Route | Viewport | Before | After | Overflow | Initial finding | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Artifact grid loaded | `/artifacts` | 1440×900, 1280×720 | unavailable; source audit | `artifact-grid-loaded-after-*` | none | Target management card language | pass |
| Artifact detail loaded | `/artifacts/{id}` | 1440×900, 1280×720 | unavailable; source audit | `artifact-detail-loaded-after-*` | none | Raw metadata palette replaced with semantic tokens | pass |
| Gallery listing loaded | `/gallery` | 1440×900, 1280×720 | unavailable; already-aligned source audit | `gallery-listing-loaded-after-*` | none | Public shell and card density preserved | pass |
| Gallery detail loaded | `/gallery/{slug}` | 1440×900, 1280×720 | unavailable; already-aligned source audit | `gallery-detail-loaded-after-*` | none | Trusted controls remain outside isolated content | pass |
| Public Creator loaded | `/creators/{slug}` | 1440×900, 1280×720 | unavailable; already-aligned source audit | `public-creator-loaded-after-*` | none | Public identity and navigation boundary preserved | pass |
| Gallery administration loaded | `/admin/gallery` | 1440×900, 1280×720 | unavailable; source audit | `gallery-admin-loaded-after-*` | none | Management shell, Cards, Fields, states, typography, and spacing now align with Artifact management | pass |
| Creator profile loaded | `/settings/gallery-profile` | 1440×900, 1280×720 | unavailable; source audit | `gallery-profile-loaded-after-*` | none | Avatar, Field help, pending, empty, and feedback composition aligned | pass |
| Account login | `/?view=login` | 1440×900 | unavailable; source audit | `account-login-after-1440x900.png` | none | Semantic shell and control scale aligned | pass |
| Account verification | verification state | 1440×900 | unavailable; source audit | `account-verification-after-1440x900.png` | none | shadcn actions preserve countdown and form hierarchy | pass |
| Device authorization confirmation | `/device?user_code=...` | 1440×900 | unavailable; source audit | `device-authorization-confirmation-after-1440x900.png` | none | Card, Avatar, Badge, and semantic state presentation aligned | pass |

The public Gallery intentionally retains public navigation while management pages retain `ManagementShell`. This difference is required and is not a visual-consistency failure. Across the matrix, shell boundary, hierarchy, typography, control scale, spacing rhythm, card density, and state presentation were reviewed. Before screenshots and browser timings do not exist because the harness was added after editing began; the pre-change evidence is the file-and-rule source audit in `interface-audit.md`.
