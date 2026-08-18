# Security, privacy, and licensing

## 1. Threat model

Storm Intelligence runs close to operational vessel data and communicates with external meteorological services. Security review must therefore consider both classic software threats and disclosure of operational context.

Potentially sensitive information includes vessel position, course, speed, historical tracks, onboard environmental measurements, configured operating-area bounds, provider credentials and remote-model API credentials.

## 2. Credential handling

Credentials must never be embedded in source code, chart URLs, public WebApp assets, test fixtures, model files, reproducibility manifests or exported diagnostics.

Provider adapters should use Signal K configuration only when the setting can be stored appropriately by the deployment. Remote LLM API keys are referenced by environment-variable name and read at runtime; the key value is never returned in algorithm metadata.

Errors must not echo authorization headers or complete secret-bearing URLs.

## 3. External requests and vessel privacy

Location-aware provider requests can reveal an approximate vessel operating area. Operators should understand the privacy, retention and jurisdiction policies of each external service before enabling it.

A provider which accepts a large fixed regional query can disclose less precise vessel location than a vessel-centered request, but may increase bandwidth. This is an operational/privacy trade-off and should remain configurable where practical.

## 4. Remote LLM inference

`llm-openai-compatible` can transmit bounded normalized evidence to a configured remote endpoint. It is disabled by default.

The algorithm should send the minimum evidence required for inference, not raw vessel logs or entire provider payloads. Structured evidence may still contain vessel-relative distances and navigation context and should be treated as operational data.

The default Responses API request asks for provider-side response storage to be disabled where supported. This flag is not a contractual privacy guarantee; deployment operators remain responsible for the configured provider's policies.

Never configure an untrusted `baseUrl` with a valuable API credential: the configured credential is sent to that endpoint.

## 5. Public versus authenticated routes

Plotter/browser assets and narrowly scoped map tile bytes may be served on public routes required by the host integration. Administrative controls and sensitive dynamic state should remain behind Signal K/plugin access controls.

The companion WebApp is **read-only**, but read-only telemetry may still be sensitive. Enabling unauthenticated read-only Signal K access can expose vessel status to other hosts on the reachable network.

## 6. Input validation

Adapters must validate coordinates, product IDs, content types and response shapes before processing. Network requests require finite timeouts and bounded retries.

Untrusted identifiers must not become arbitrary filesystem paths. Provider/product keys should be validated against discovered capabilities before storage access.

LLM output is untrusted even when schema-constrained. Candidate IDs, states and confidence values are validated before merging.

## 7. Dependency security

The runtime intentionally keeps dependencies small. New dependencies should be assessed for maintenance activity, transitive risk, native build requirements and ARM64/vessel-platform support.

Security advisories should be reviewed before release. A vulnerability in an optional provider/model integration should not justify weakening core input validation.

## 8. Data retention

Archive and prefetch retention are independently configurable. Operators should minimize persistence according to operational need, provider licensing and privacy policy.

Real vessel logs used in reproducibility studies may reveal routes and routines. They should not be redistributed without an explicit consent/privacy review. Synthetic vessel scenarios are preferred for openly published benchmarks when operational logs are unnecessary.

## 9. Provider licensing

Technical ability to cache or download data does not imply legal permission to retain, redistribute or use it commercially.

Each adapter/provider integration must document:

- attribution requirements;
- caching and archival rights;
- redistribution rights;
- commercial-use restrictions;
- authentication/access eligibility;
- any share-alike or derived-product conditions.

Blitzortung protected raw data, for example, must not be placed in a public benchmark merely because authorized researchers can download it.

## 10. Reproducibility under restricted licences

When source data cannot be redistributed, publish acquisition recipes, provider documentation references, checksums and normalization code. State that computational reproduction is conditional on authorized access.

Never publish credentials in an attempt to make a benchmark easier to reproduce.

## 11. Reporting security issues

A security issue should be reported privately to project maintainers before public disclosure when exploitation could expose credentials, vessel location or unauthorized write capability. Include affected version, reproduction steps and whether the issue requires authentication/network proximity.
