# Payment Verification API — Project Assessment

Assessment date: 2026-01-17  
Project version observed: 2.1.0

This document reviews the backend codebase end-to-end (Express + Prisma + multiple “verifier” services) with an emphasis on architecture and algorithms, and with practical recommendations for building a more robust successor (backend + frontend).

Note: I can review the technical approach and risks, but I won’t provide instructions for bypassing security controls (e.g., disabling TLS verification, evading geofencing, or similar). Where the current code does that, I call it out as a defect and recommend safer alternatives.

---

## 1) What the system actually does

At a high level, the API turns a user-supplied identifier (reference/receipt number, sometimes a suffix/phone) into a structured “receipt” response by querying an external source and extracting fields.

**Data acquisition patterns used:**
- **Direct HTTP fetch** of a PDF or HTML page (Axios)
- **Browser automation fallback** to locate a PDF URL (Puppeteer)
- **HTML scraping** with Cheerio + regex fallback
- **PDF text extraction** with `pdf-parse` + regex field extraction
- **Image-based classification/extraction** using Mistral Vision (Pixtral)

**Product surface:**
- REST endpoints under `/verify-*` plus `/verify-image`
- API key middleware (custom) for access control
- Admin endpoints for API-key issuance and usage stats
- Usage logging to MySQL via Prisma

---

## 2) Architecture overview (current)

**Entry point:** `src/index.ts`
- Express server
- Global middleware order: `cors` + `express.json()` + `requestLogger` + `/admin` routes + `apiKeyAuth` + routers
- Prisma connection bootstrapped at startup; loads a stats cache from DB

**Middleware:**
- `src/middleware/apiKeyAuth.ts`: generates and validates API keys; updates usage counters
- `src/middleware/requestLogger.ts`: request logs + in-memory stats + async DB usage log on response finish

**Persistence (Prisma / MySQL):**
- `ApiKey` and `UsageLog` are used
- Several additional models (`User`, `Account`, `Session`, etc.) appear to be leftover from a NextAuth-style schema and are not used by the API server

**Services (verification algorithms):**
- `verifyCBE.ts`: direct PDF fetch → parse; fallback to Puppeteer to detect a PDF response
- `verifyDashen.ts`: PDF fetch → parse
- `verifyTelebirr.ts`: HTML fetch → parse; fallback to proxy JSON/HTML
- `verifyAbyssinia.ts`: fetch JSON from an API endpoint → map fields
- `verifyCBEBirr.ts`: fetch PDF with Bearer token → parse (currently includes hardcoded sample values)
- `verifyImage.ts`: upload image → send to Mistral Vision to classify + extract ID → optionally call Telebirr/CBE verifiers

---

## 3) What’s good (pros)

**API shape and separation:**
- Clean, simple route-to-service separation: `routes/*` delegate to `services/*`

**Practical scraping resilience (in places):**
- Telebirr verifier uses multiple extraction strategies (regex + DOM parsing) and retries by switching source (primary vs fallback)

**Operational awareness:**
- Rotating log files via Winston
- Usage logging to DB (good foundation for billing/limits/abuse detection)

**TypeScript strict mode enabled:**
- `tsconfig.json` uses `strict: true` (good baseline)

**Graceful shutdown:**
- Closes HTTP server and disconnects Prisma on SIGTERM/SIGINT

---

## 4) Key defects / risks (cons)

### 4.1 Security and privacy defects

1) **TLS verification is explicitly disabled in multiple verifiers**
- Seen in: `verifyCBE.ts`, `verifyDashen.ts` (`https.Agent({ rejectUnauthorized: false })`)
- Impact: enables man-in-the-middle attacks; undermines data integrity and confidentiality
- Recommendation: never disable TLS verification; fix cert chain issues properly (trusted CA store, pinned CA bundle, or official endpoints)

2) **API keys are generated insecurely and stored in plaintext**
- Generation uses timestamp + `Math.random()`; not cryptographically strong
- Stored as plain `key` in DB
- Recommendation: generate with `crypto.randomBytes(32)` (or equivalent), store only a hash (e.g., HMAC or bcrypt/argon2), and show the secret only once on creation

3) **Admin authentication is a single shared secret with a dangerous default**
- `ADMIN_SECRET` defaults to `change-this-secret-key`
- Recommendation: require an env var (no default), use proper admin auth (JWT, OAuth, or at least rotated secrets + audit logs)

4) **File uploads have no limits/validation**
- `multer({ dest: "uploads/" })` without size/type constraints
- Recommendation: enforce size limits, MIME allowlist, and safe storage; consider streaming uploads, and structured error responses

5) **Logging leaks sensitive data**
- `requestLogger` logs full POST bodies (PII risk)
- `verifyCBEBirr` logs the full PDF text content (extreme PII leakage risk)
- Recommendation: implement structured redaction (mask account numbers, names, phone); log only high-level metadata by default

6) **API key auth bypass surface**
- `/admin` is intentionally before `apiKeyAuth` (fine), but then protected by weak admin secret
- Recommendation: treat `/admin` as privileged and strongly protected (network restrictions, auth, rate limits)

### 4.2 Correctness bugs and design inconsistencies

1) **Usage stats query double-prefixes endpoint with method**
- `UsageLog.endpoint` already stores a string like `"GET /verify-x"`, and `UsageLog.method` stores `GET`
- Stats query does `CONCAT(method, ' ', endpoint)` → yields `"GET GET /verify-x"`
- Recommendation: store endpoint as path-only (e.g., `/verify-x`) and keep method separate, or stop concatenating in queries

2) **`/verify-cbebirr` route uses Authorization header, but middleware doesn’t**
- `apiKeyAuth` accepts `x-api-key` header or query param
- `verifyCBEBirrRoute` additionally checks `Authorization: Bearer ...`
- Net effect: a caller using only Bearer may be rejected by middleware before route logic
- Recommendation: standardize auth input (either accept Bearer for your API keys everywhere, or don’t)

3) **CBE Birr verifier is not a general parser (hardcoded sample values)**
- `verifyCBEBirr.ts` includes fallbacks that literally return specific names/IDs
- Recommendation: remove all hardcoded sample values; build parser from actual structure; add golden-test fixtures

4) **Mixed response envelopes across endpoints**
- Some routes return `{ success: true, data: ... }`, others return the service result directly
- Recommendation: define a single response contract and apply consistently

5) **Date parsing is naive**
- Uses `new Date(string)` on scraped text (timezone/locale ambiguity)
- Recommendation: parse explicitly (ISO when available) and return timestamps consistently (e.g., ISO 8601 UTC)

### 4.3 Reliability and maintainability risks

1) **Scraping/parsing is brittle and tightly coupled to source formats**
- Regex-driven parsing over PDF text is fragile; HTML selectors are fragile
- Recommendation: isolate per-source “adapters” with versioning; keep raw snapshots for regression tests

2) **No rate limiting, no circuit breakers, no queueing**
- Risk: a burst of requests can overwhelm upstreams and your server (especially Puppeteer + Mistral Vision)
- Recommendation: add per-key rate limits, concurrency limits, and a job queue for expensive work

3) **Synchronous file I/O in request handler**
- `verifyImage.ts` uses `readFileSync` and `unlinkSync` inside the request path
- Recommendation: use async fs APIs; also add periodic cleanup for orphaned uploads

4) **Puppeteer resource cost is unmanaged**
- Launching a browser per request is expensive; no pooling
- Recommendation: use a browser pool or move browser automation to a worker queue

5) **Large “debug-first” logging in production code**
- Many services log huge strings
- Recommendation: use log levels properly and cap payload sizes

---

## 5) Algorithm review by verifier

### 5.1 CBE (`verifyCBE.ts`)
**Algorithm:**
- Build URL from `reference + accountSuffix`
- Attempt direct PDF fetch
- If that fails: open page in Puppeteer and detect a PDF response URL
- Fetch PDF and parse via `pdf-parse`
- Extract fields via regex over normalized text

**Strengths:** pragmatic fallback path (direct → browser) that improves success rate.

**Weaknesses:** TLS disabled; parsing is brittle; Puppeteer launch per request; minimal validation; naive date parsing.

### 5.2 Dashen (`verifyDashen.ts`)
**Algorithm:**
- Fetch receipt PDF
- Parse PDF text
- Extract many fields via regex, including fee breakdown

**Strengths:** richer structured extraction; extensive debugging signals.

**Weaknesses:** TLS disabled; verbose logging; regex fragility; minimal “schema validation” of extracted fields.

### 5.3 Telebirr (`verifyTelebirr.ts`)
**Algorithm:**
- Fetch HTML receipt page
- Parse via Cheerio
- Use regex fallbacks for hard-to-find fields
- If primary fails or invalid: hit a fallback proxy URL (expects JSON but can scrape HTML)

**Strengths:** most resilient extraction strategy in this repo.

**Weaknesses:** relies on a third-party fallback endpoint; limited validation (only checks a few essential fields); no backoff/retry strategy beyond switching sources.

### 5.4 Abyssinia (`verifyAbyssinia.ts`)
**Algorithm:**
- Fetch JSON from an endpoint
- Validate shape
- Map fields to a shared `VerifyResult`

**Strengths:** JSON is less brittle than PDF/HTML scraping.

**Weaknesses:** logs too much (full response bodies); mapping guesses “receiver” semantics; weak essential-field validation.

### 5.5 CBE Birr (`verifyCBEBirr.ts`)
**Algorithm:**
- Fetch PDF using `Authorization: Bearer <token>`
- Parse PDF text and attempt to extract fields

**Strengths:** attempts to provide a separate, richer receipt schema.

**Weaknesses:** currently not production-credible due to hardcoded sample values and logging full PDF text.

### 5.6 Image verification (`verifyImage.ts`)
**Algorithm:**
- Upload image
- Send base64 image to Mistral Vision with a constrained JSON response format
- Extract transaction ID and optionally auto-verify via other verifiers

**Strengths:** good UX idea: “drop an image and get a structured answer.”

**Weaknesses:** no upload limits; synchronous disk I/O; expensive LLM call per request without throttling; assumes model output is always valid JSON.

---

## 6) Concrete improvement roadmap for a “more complex and useful” successor

### 6.1 Platform-level features (high value)
- **Multi-tenant API keys**: organizations, projects, environments (dev/staging/prod), scoped permissions
- **Rate limiting + quotas**: per key/per org, burst + sustained, with clear 429 responses
- **Idempotency keys**: prevent duplicate charges/requests in clients; store request fingerprints
- **Async verification jobs**: POST creates a job, GET polls status, optional webhooks on completion
- **Webhooks + event log**: immutable event stream for auditing and integration
- **Caching + revalidation**: cache successful verifications (with TTL and safety rules)
- **Observability**: structured logs, metrics (Prometheus), tracing (OpenTelemetry)
- **Admin console**: key management, usage charts, anomaly detection

### 6.2 Data/algorithm features
- **Normalization layer**: canonical receipt schema across providers (payer/receiver identifiers, amounts, currency, timestamps)
- **Confidence scoring**: return confidence and warnings for partial parses
- **Field-level provenance**: which extractor produced the value (DOM vs regex vs model)
- **Reconciliation/matching engine**: match inbound payments to invoices/orders with fuzzy matching and tolerances
- **Fraud/anomaly signals** (careful: use only legitimate data sources): unusual frequency, reused references, mismatched payer names, etc.

### 6.3 Engineering upgrades (implementation-oriented)
- **Hexagonal architecture (ports/adapters)**: keep “verification adapters” behind interfaces; make them testable
- **Parser tests with fixtures**: store sample PDFs/HTML snapshots (sanitized) and run regression tests
- **Shared validation**: `zod` or `valibot` schemas for inputs/outputs, consistent error codes
- **Worker queue**: BullMQ/Redis or similar for Puppeteer/AI-heavy workloads
- **Secrets and config**: strict env validation at boot (no defaults for secrets)

---

## 7) Priority fixes if you fork/extend this project

If you do nothing else, these should be your first refactors:
1) Remove TLS-bypass logic; fix cert validation properly.
2) Replace API key generation with cryptographically secure keys; store hashes.
3) Add rate limiting and upload constraints.
4) Stop logging request bodies / raw PDF text; implement redaction.
5) Standardize response envelopes and error codes.
6) Fix usage stats schema/query (method + endpoint duplication).
7) Replace Puppeteer-per-request with a worker/pool.

---

## 8) Notes on verification and checks

I did not run `pnpm build` in this environment because `pnpm` is not installed here, and you requested analysis-only. If you want, I can add a short “how to run checks” section and/or wire up an npm-compatible build script.

---

## 9) Related document in this repo

See `SYSTEM_ANALYSIS.md` for an earlier long-form analysis. This document complements it with additional concrete code-level issues (notably CBE Birr hardcoding, auth header mismatch, and method+endpoint duplication in stats) and a roadmap oriented toward a more scalable product.
