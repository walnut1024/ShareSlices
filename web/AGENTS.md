# Web engineering guidance

Inherits [repository-wide guidance](../AGENTS.md) and owns rules specific to `web/**`.

## Product and layout

- Follow the supported-client scope in [PRODUCT.md](../PRODUCT.md). Change the product contract before adding a layout or interaction outside that scope.
- Use `1440x900` as the default design and screenshot viewport. The minimum supported viewport is `1280x720`.
- Build authenticated Web surfaces for management work. Do not add landing-page sections, promotional copy, or decorative hero treatments to management pages.

## Components and styling

- Name route-level components and files with the `*Page` suffix.
- Name reusable containers for their concrete role, such as `*Layout`, `*Shell`, `*Section`, or `*Panel`. Do not introduce `*Screen` names.
- Use local shadcn/ui components with Base UI primitives. Do not add another shadcn base or a second primitive stack.
- Use Base UI for new or materially rewritten primitives. Do not expand a scoped fix solely to migrate an unrelated hand-written primitive.
- Use Lucide icons for common actions.
- Use Tailwind CSS v4 with CSS-first configuration. Keep shared design tokens in CSS.
- Treat existing CSS tokens as the implementation source of truth. Consult the [Vercel Geist reference](https://vercel.com/design.md) only when changing the token system.

## State and boundaries

- Keep HTTP access behind the Web API layer. Do not import API, Worker, database, or object-storage internals.
- Prefer server state and component state. Add a global client store only when cross-route client state cannot be represented by server, URL, or component state.
- Use TanStack Query when server-state caching is required.

## Verification

- Run `mise run web-test` for changed Web behavior.
- With the local stack running, run `mise run web-e2e` for changed behavior that depends on routing, browser APIs, or an existing end-to-end flow.
- Treat Web end-to-end tests as a separate integration gate, not part of `mise run check`.
- Verify visual changes at `1440x900`. Do not add mobile or tablet acceptance coverage unless [PRODUCT.md](../PRODUCT.md) changes first.
