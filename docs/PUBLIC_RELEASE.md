# Public repository and portfolio checklist

This checklist documents deployment responsibilities; it is not evidence that
each check has already passed.

## Before changing GitHub visibility

- Scan all branches and history for secrets with a dedicated secret scanner.
  Inspect GitHub Actions logs/artifacts and attached screenshots separately.
  A clean working tree and ignored `.env` do not clear Git history.
- Rotate any exposed credentials first. Removing a file in a new commit does
  not remove its historical versions or copies already downloaded.
- Review licensing, retained third-party notices, private reporting in
  `SECURITY.md`, and dependency/security alerts. Do not publish the private
  feature-planning files ignored by `.gitignore`.
- Require reviewed changes and CI checks for main and staging. Enable GitHub
  secret scanning and push protection where available.
- Remember that public copies and forks cannot be recalled by making the
  original repository private again.

## Demo payments

1. Keep the correct public HTTPS origin and production application environment.
2. Set `SCHEDRA_BILLING_MODE=sandbox` and both sandbox Bachs secrets in the
   deployment platform, not in source control.
3. Configure the sandbox provider webhook for that origin's
   `/api/webhooks/bachs`. A live webhook secret is not interchangeable.
4. Confirm `/api/payment-environment` reports `sandbox` and the notice appears
   on pricing, billing, and paid booking pages after deployment.
5. Verify checkout uses the sandbox provider. Only use official test details.
6. Check renewal/cancellation, delayed and duplicated webhook delivery, and
   provider failures before presenting those flows as verified.

Use a separate database if an environment has live financial history. Changing
keys neither cancels live provider subscriptions nor converts existing invoices.

## Portfolio quality

- Demonstrate one complete booking journey before listing every feature.
- Use sample records and calendars you control; invite no uninvolved people.
- Keep screenshots free of customer data, access tokens, and administrator links.
- Check desktop, narrow mobile screens, keyboard navigation, and empty/error states.
- Run lint, typecheck, unit/database tests, browser tests, and the production build.
- Record the release commit and what was actually tested; distinguish provider
  fakes from real sandbox verification. Do not claim payment-provider approval
  proves application security or business readiness.
