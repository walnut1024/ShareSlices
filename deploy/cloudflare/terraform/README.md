# Cloudflare Terraform state and phases

This root owns long-lived private R2 buckets, product Queues, the cache-disabled
Hyperdrive configuration, and separately activated Worker ingress. It does not
own Worker bundles, bindings, Secrets, deployments, Queue consumers, Queue
delivery pause state, or Cron triggers. Those fields remain unavailable here
until the disposable-account ownership gate selects one qualified owner.

The S3 backend is intentionally empty in source. Initialize it only with an
operator-controlled backend configuration and credentials, for example:

```sh
terraform -chdir=deploy/cloudflare/terraform init \
  -backend-config=/operator/private/shareslices-backend.hcl
```

The backend must provide encryption at rest and in transit, versioning or an
equivalent recovery history, access restricted to deployment operators, and
independent backup retention. Terraform plans and state are sensitive because
the Hyperdrive origin password is a write-only resource field that remains in
state even though the variable is marked `sensitive`. Do not upload plan or
state files as ordinary CI artifacts or commit backend configuration.

Run the private-prerequisite phase with `activate_ingress = false`. Import any
pre-existing named resource into its exact address before the first apply; do
not let Terraform replace or adopt it by name. After the App and Content
candidates pass pre-traffic verification, a separately authorized plan may set
`activate_ingress = true` with the approved custom-domain and route maps.

Recovery restores the latest encrypted state version, runs a refresh-only plan,
and compares every resource with provider inventory before any apply. Missing,
ambiguous, unexpectedly recreated, or drifted resources block activation. State
recovery never proves that an R2 bucket is private or that a Worker candidate is
safe; `doctor` and release verification provide those independent checks.

