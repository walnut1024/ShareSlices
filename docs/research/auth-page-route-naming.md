<!-- cspell:words Laravel -->

# Authentication page route naming

Research date: 2026-07-17

## Conclusion

There is no web standard that requires authentication pages to use `login`, `sign-in`, `signup`, `sign-up`, or `register`. RFC 3986 defines URI structure and legal characters, but treats ordinary path segments as opaque and leaves their semantics to the application. It also makes clear that path case is not generically normalized, while the hyphen is an unreserved character. Therefore, lowercase kebab-case is a stable product convention, not an RFC requirement. [RFC 3986 §§2.3, 3.3, 6.2.2.1](https://www.rfc-editor.org/rfc/rfc3986.html)

For ShareSlices, use one vocabulary family consistently:

| User journey | Canonical route | Reason |
| --- | --- | --- |
| Public discovery | `/` | Gallery is the public product homepage. |
| Start an authenticated session | `/sign-in` | Matches the product's existing “Sign in” public CTA and the terminology of the current authentication stack. |
| Create an account | `/sign-up` | Pairs consistently with `/sign-in` and matches the existing `SignUpPage` journey. |
| Complete the current multi-stage recovery journey | `/reset-password` | The existing page owns the request, code verification, and new-password stages as one journey. |

If recovery is later split into separately addressable pages, use `/forgot-password` for requesting recovery and `/reset-password` for setting the new password. Do not introduce both routes while they still render one stateful page.

## Evidence and boundaries

### Standards define syntax, not authentication vocabulary

RFC 3986 permits letters and hyphens in path segments and says that, apart from dot-segments, a path segment is opaque to generic URI syntax. It does not assign meanings such as “sign in” or “register” to paths. RFC 9110 adopts the generic URI syntax for HTTP but likewise does not standardize authentication page names. [RFC 3986 §§2.3 and 3.3](https://www.rfc-editor.org/rfc/rfc3986.html#section-3.3); [RFC 9110 §4.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2)

Consequently, `/login` is not technically less standards-compliant than `/sign-in`. The decision is about coherent terminology, discoverability, and compatibility.

### “Sign in” is the clearer UI term

Microsoft's first-party style guide instructs writers to use the verb phrase “sign in” and avoid “log in” or the noun-like `login` in user-facing prose. GOV.UK service guidance also uses “Sign in” as the account-entry action. These are content conventions rather than URL standards, but they support aligning the page title, CTA, and route around the same concept. [Microsoft Style Guide: sign in, sign out](https://learn.microsoft.com/en-us/style-guide/a-z-word-list-term-collections/s/sign-in-sign-out); [GOV.UK Design System: Start using a service](https://design-system.service.gov.uk/patterns/start-using-a-service/)

GOV.UK separately recommends the visible phrase “Create an account” instead of “Register” or “Sign up.” That is useful copy guidance, but it does not prescribe a URL. ShareSlices can evaluate that UI wording independently without changing the canonical `/sign-up` route. [GOV.UK Design System: Create accounts](https://design-system.service.gov.uk/patterns/create-accounts/)

### The selected routes match the authentication stack

Better Auth's official email/password contract uses `sign-in`, `sign-up`, `request-password-reset`, and `reset-password`, and its redirect example uses `/reset-password`. This is the closest first-party convention to ShareSlices because Better Auth is the repository's authentication runtime. It supports `/sign-in`, `/sign-up`, and `/reset-password` as a coherent family, while not turning API endpoint names into a supposed web standard. [Better Auth: Email & Password](https://www.better-auth.com/docs/authentication/email-password)

Other frameworks demonstrate that alternatives are conventions too: Next.js' official dashboard course uses `/login`, while Laravel uses `/login`, `/register`, `/forgot-password`, and `/reset-password/{token}`. Their disagreement is further evidence that consistency within a product matters more than claiming a universal route standard. [Next.js Learn: Adding authentication](https://nextjs.org/learn/dashboard-app/adding-authentication); [Laravel starter kits: Authentication](https://laravel.com/docs/12.x/starter-kits#authentication)

## Compatibility recommendation

New navigation should generate only the canonical paths. ShareSlices does not retain compatibility aliases for the removed query-based entry URLs:

```text
/?view=login  -> Gallery at /
/?view=signup -> Gallery at /
/?view=reset  -> Gallery at /
```

A protected page redirects to `/sign-in` with a validated same-origin `returnTo` value. The no-compatibility policy is a ShareSlices product decision; it is not specified by the cited URI or framework sources.
