# Web interface audit baseline

## Project configuration

- shadcn style: `base-nova`
- primitive base: `base`
- framework: Vite, React, TypeScript
- Tailwind: v4 with CSS-first configuration in `web/src/styles.css`
- icon library: Lucide
- primitive dependency: `@base-ui/react@^1.6.0`
- second primitive stack: none
- preset or component overwrite required: no
- runtime dependency required: no

The installed local inventory is Alert, Aspect Ratio, Avatar, Badge, Button, Calendar, Card, Checkbox, Dialog, Dropdown Menu, Empty, Field, Input Group, Input, Label, Popover, Progress, Select, Separator, Skeleton, Sonner, Spinner, Table, Textarea, Toggle Group, Toggle, and Tooltip.

## Baseline findings

The complete machine-readable finding list is `output/playwright/interface-conformance-before.json`. The report contains 90 occurrences; repeated line numbers indicate multiple non-semantic tokens on the same line.

| File | Rule | Lines |
| --- | --- | --- |
| `src/App.tsx` | raw palette | 145, 165 |
| `src/components/ArtifactPlayer.tsx` | raw palette | 102 (two tokens) |
| `src/components/ArtifactStatus.tsx` | raw palette | 18–19 (six tokens) |
| `src/components/AuthLayout.tsx` | raw palette | 8–10, 19, 24, 26, 30 |
| `src/components/VerificationCodeForm.tsx` | raw button | 88, 91 |
| `src/components/VerificationCodeForm.tsx` | raw palette | 67, 88, 91 |
| `src/screens/ArtifactGalleryDialog.tsx` | Select grouping | 309 |
| `src/screens/ArtifactPage.tsx` | raw palette | 350, 358, 363, 441, 468, 501–502, 507–508, 518–519, 529 |
| `src/screens/ArtifactPreviewPage.tsx` | equal dimensions | 6 |
| `src/screens/ArtifactsPage.tsx` | conditional class | 809 |
| `src/screens/ArtifactsPage.tsx` | raw button | 794 |
| `src/screens/DeviceAuthorizationPage.tsx` | conditional class | 29 |
| `src/screens/DeviceAuthorizationPage.tsx` | equal dimensions | 117, 150, 167 |
| `src/screens/DeviceAuthorizationPage.tsx` | raw palette | 17–19, 28, 38–39, 109, 117, 123–124, 126, 133, 142, 149–150, 153, 155, 165, 167–170 |
| `src/screens/GalleryProfilePage.tsx` | space utility | 56 |
| `src/screens/LoginPage.tsx` | raw button | 18 |
| `src/screens/LoginPage.tsx` | raw palette | 17, 34, 37, 42–44 |
| `src/screens/PasswordResetPage.tsx` | raw palette | 78, 86 |
| `src/screens/SignUpPage.tsx` | raw palette | 79, 103, 125–127, 129, 139–143 |

## Specialized boundary candidates

| Source | Rule | Reason | Required proof |
| --- | --- | --- | --- |
| `src/screens/ArtifactsPage.tsx` | raw button | Transparent full-card selection target must not replace the card link or nested actions. | Artifact selection interaction test |
| `src/components/ArtifactPlayer.tsx` | fixed dark canvas | Frames arbitrary untrusted Artifact content and Full screen. | Player iframe, error, and Full-screen tests |
| `src/screens/ArtifactPreviewPage.tsx` | fixed dark canvas | Dedicated isolated Preview surface. | Preview iframe and Full-screen browser test |
| Upload Dropzone | specialized file input | Native file/drop semantics and preflight must remain intact. | Upload preflight tests |
| Gallery iframe | specialized content element | Sandbox and isolated URL are security boundaries. | Gallery player and isolated browser tests |

## Initial visual finding

Public Gallery now shares the Artifact card language, but Gallery administration and Creator profile still use hand-built bordered articles, incomplete Field and Avatar presentation, compressed one-line rendering, and state containers that do not match Artifact management. Account entry, device authorization, Artifact metadata, status, and Player feedback still contain raw neutral palettes or native action controls. Ordinary management navigation correctly has no Admin item.
