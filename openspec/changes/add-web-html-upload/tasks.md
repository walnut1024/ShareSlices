# Add Web HTML upload tasks

## 1. Define the input behavior

- [x] 1.1 Update `PRODUCT.md` with self-contained Web HTML selection and browser-side ZIP packaging.
- [x] 1.2 Add the `artifact-upload` delta requirement without changing the server ZIP contract.

## 2. Implement the Web adapter

- [x] 2.1 Add focused tests for HTML selection, name derivation, ZIP conversion, and ZIP pass-through.
- [x] 2.2 Accept `.html` and `.htm` in the creation dialog and communicate the self-contained-file boundary.
- [x] 2.3 Package HTML as a ZIP with root `index.html` before archive validation and upload.

## 3. Verify

- [x] 3.1 Run the focused Artifact management tests and Web TypeScript check.
- [x] 3.2 Run `mise run check`, strict change validation, and `git diff --check`.
- [x] 3.3 Review the scoped diff for contract, correctness, and regression risks.
