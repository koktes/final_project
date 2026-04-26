# Thesis Completion Roadmap

## 1. Goal and End State

Build and defend a Hybrid Multi-Bank Transaction Verification System that:

1. Verifies supported banks through deterministic connectors (API/scraping/parsing).
2. Falls back to a probabilistic fraud detection engine when deterministic verification is unavailable, ambiguous, or degraded.
3. Produces one standardized decision output for all channels (reference input, image input, universal endpoint).
4. Demonstrates measurable research value with reproducible experiments and thesis-ready metrics.

---

## 2. Current State (As-Is)

### 2.1 What is already strong

1. Multi-bank deterministic verification exists (CBE, Telebirr, Dashen, Abyssinia, CBE Birr, M-Pesa).
2. A universal routing endpoint exists.
3. OCR pipeline improved with local OCR + fallback model OCR.
4. AI module exists as a separate Python service:
   - Synthetic data generation
   - Feature engineering
   - Isolation Forest + Logistic Regression calibration
   - Evaluation artifacts (Precision/Recall/F1/ROC-AUC)
   - FastAPI inference endpoints

### 2.2 Critical gaps to close

1. Main Node verification flow is not yet integrated with AI risk scoring path.
2. Unified decision contract is not enforced across all endpoints.
3. Security and production-hardening issues still exist (middleware wiring, TLS strategy, sensitive logging).
4. End-to-end frontend workflow is not yet defined/implemented.
5. Thesis evidence must be tightened with stronger evaluation framing and reproducibility packaging.

---

## 3. Target Architecture (To-Be)

## 3.1 Unified verification flow

1. Client submits request through one of:
   - POST /verify (reference-first)
   - POST /verify-image (image-first)
2. Verification Orchestrator normalizes input into a Unified Transaction Object (UTO).
3. Orchestrator performs bank identification and capability lookup.
4. If deterministic verification succeeds with high confidence:
   - Return source = Bank_API
   - Return status = Verified or Invalid
5. If deterministic path unavailable, fails, or is low-confidence:
   - Call AI Fraud Service
   - Return source = Internal_ML_Engine
   - Return status = Low_Risk or Suspicious or Invalid
6. All responses follow one schema.

## 3.2 Standard response schema (mandatory)

Use this shape for every endpoint:

```json
{
  "success": true,
  "verificationSource": "Bank_API | Internal_ML_Engine | Hybrid",
  "status": "Verified | Low_Risk | Suspicious | Invalid",
  "riskScore": 0,
  "confidence": 0,
  "bank": "cbe",
  "reference": "FT...",
  "reasonCodes": ["API_UNAVAILABLE", "FORMAT_VIOLATION"],
  "extractedMetadata": {
    "amount": 0,
    "currency": "ETB",
    "transactionDate": "2026-04-22T10:30:00+03:00",
    "payer": "",
    "receiver": ""
  },
  "raw": {
    "deterministic": {},
    "ml": {}
  }
}
```

---

## 4. OCR Implementation Plan

## 4.1 OCR objectives

1. Extract reference reliably from screenshots/PDF exports.
2. Detect provider and route correctly.
3. Quantify OCR confidence and uncertainty.
4. Feed OCR quality signals into ML risk scoring.

## 4.2 OCR pipeline (recommended)

1. Input validation:
   - MIME allowlist
   - file size limits
   - reject corrupted images
2. Preprocessing (before OCR):
   - grayscale
   - contrast enhancement
   - denoise
   - optional deskew
3. Primary OCR:
   - local Tesseract extraction
4. Post-processing:
   - normalize text
   - regex extraction for bank-specific references
   - generate substitution candidates (O/0, I/1, S/5, etc.)
5. Fallback OCR:
   - remote model OCR only when local OCR fails
6. Confidence scoring:
   - OCR confidence
   - pattern validity score
   - cross-check with deterministic verification response

## 4.3 OCR success criteria

1. Reference extraction success rate >= 90% on curated test set.
2. Wrong-reference extraction rate <= 5%.
3. OCR fallback usage rate tracked and justified.
4. Every OCR output includes confidence and extraction source.

---

## 5. AI Fraud Engine Plan

## 5.1 Integration strategy

1. Keep Python service as dedicated microservice.
2. Add a Node AI client module:
   - health check
   - single predict call
   - timeout/retry/circuit-break behavior
3. Trigger AI path when:
   - deterministic path unavailable
   - deterministic parse incomplete
   - deterministic output suspicious or inconsistent
4. Persist risk outcomes for analytics and thesis experiments.

## 5.2 Model and data roadmap

1. Retain current baseline model (Isolation Forest + LR calibration).
2. Expand dataset realism:
   - OCR-noise perturbations
   - bank-format drift perturbations
   - time-window replay patterns
3. Add holdout strategy:
   - train/val/test split with locked seed
   - optional mini real anonymized set for sanity-check
4. Track per-attack metrics and false-positive burden.

## 5.3 AI acceptance criteria

1. End-to-end calls from Node -> AI service are stable under timeout and failure.
2. Risk score and status returned within SLA (target <= 500ms P95 for cached/normal request).
3. Evaluation report includes:
   - Precision
   - Recall
   - F1
   - ROC-AUC
   - per-attack detection rates
4. Known weak attack classes documented with mitigation plan.

---

## 6. Verification Engine Hardening Plan

## 6.1 Must-fix items

1. Wire API key middleware correctly in server pipeline.
2. Re-enable or enforce secure TLS verification strategy.
3. Remove raw PII logs (request body, full PDF text).
4. Normalize output envelope across all routes.
5. Add deterministic parser confidence flags:
   - complete_fields
   - parse_quality
   - source_reliability

## 6.2 Reliability upgrades

1. Add retry with backoff for unstable upstream sources.
2. Add concurrency limits for heavy paths (Puppeteer, OCR fallback).
3. Add parser fixtures and regression tests for each bank format.
4. Add graceful degraded mode when external sources fail.

---

## 7. Frontend Roadmap (Not Too Simple)

## 7.1 Frontend objective

Deliver a research-demo-grade interface that supports operational usage and explains decisions.

## 7.2 Core pages

1. Verification Console:
   - Enter reference or upload image
   - Select auto mode or bank-specific mode
   - View normalized output and decision source
2. Decision Insight Panel:
   - Risk score gauge
   - Status badge
   - Top contributing factors (from AI)
   - Deterministic evidence summary
3. History and Search:
   - Filter by bank, status, risk range, date range
   - Replay previous requests
4. Monitoring Dashboard:
   - Request volume
   - success/failure rates
   - AI path usage percentage
   - false-positive review queue
5. Admin section:
   - API key management
   - environment health (Node + AI)

## 7.3 Value-add features (recommended)

1. Verification provenance timeline:
   - input -> OCR -> routing -> deterministic/AI -> final decision
2. Manual review workflow:
   - analyst mark as true/false fraud
   - export labeled feedback
3. Batch verification mode:
   - CSV upload
   - summary of risk classes
4. Explainability card:
   - top 3 risk drivers and confidence notes
5. Smart warnings:
   - highlight OCR uncertainty and suggest manual checks

## 7.4 Frontend tech suggestions

1. React + TypeScript + Vite.
2. State/query: TanStack Query.
3. Charts: Recharts/ECharts.
4. Design: clean admin-style layout with strong hierarchy and compact data tables.

---

## 8. Research and Thesis Deliverables Mapping

## 8.1 Chapter deliverables

1. Methodology:
   - architecture diagrams
   - feature engineering rationale
   - dual-path decision logic
2. Implementation:
   - API and microservice interaction
   - OCR and parser design
3. Evaluation:
   - metrics, confusion matrix, per-attack table
   - ablation notes and limitations
4. Discussion:
   - strengths, weaknesses, operational constraints
   - future work

## 8.2 Required artifacts for defense

1. Source code repository (tagged release).
2. Reproducible training script and model metadata.
3. Evaluation report + plots.
4. Demo script and test dataset.
5. API documentation and frontend walkthrough.

---

## 9. Timeline to Completion

## 9.1 Phase 1: Integration foundation (Days 1-3)

1. Add orchestrator service in Node.
2. Define unified response schema.
3. Connect deterministic adapters through orchestrator.
4. Add AI client and health checks.

Deliverable: working hybrid skeleton with stable API contract.

## 9.2 Phase 2: OCR + hybrid decisioning (Days 4-6)

1. Finalize OCR confidence and candidate resolution.
2. Route failed/low-confidence deterministic cases to AI.
3. Add reasonCodes and provenance fields.
4. Add logs/metrics without PII.

Deliverable: true dual-path runtime behavior.

## 9.3 Phase 3: Evaluation hardening (Days 7-9)

1. Refresh synthetic dataset generation.
2. Retrain and tune thresholds.
3. Generate final metrics and attack-wise analysis.
4. Run parser regression checks.

Deliverable: thesis-ready quantitative evidence package.

## 9.4 Phase 4: Frontend implementation (Days 10-12)

1. Build Verification Console and Insight Panel.
2. Add history table and monitoring dashboard.
3. Add reviewer workflow and export.

Deliverable: demo-ready frontend with value-add features.

## 9.5 Phase 5: Final polish and defense prep (Days 13-14)

1. End-to-end dry run and bug fixes.
2. Freeze metrics and screenshots.
3. Prepare architecture, evaluation, and demo slides.
4. Write limitation and future-work section clearly.

Deliverable: defense-ready final project package.

---

## 10. Definition of Done (Project Completion Checklist)

1. A single request path can produce deterministic or AI fallback decisions end-to-end.
2. All major endpoints return unified schema with source, status, riskScore, and metadata.
3. OCR pipeline reports confidence and source.
4. AI model has reproducible training artifacts and final evaluation report.
5. Frontend demonstrates:
   - verification
   - explainability
   - history
   - monitoring
6. Security baseline is acceptable:
   - authentication wired
   - TLS handling corrected
   - PII logs reduced
7. Thesis documentation includes architecture, methodology, results, limitations, and future work.

---

## 11. Risks and Mitigations

1. External provider instability:
   - Mitigation: retries, fallback, cached outcomes, clear degraded-mode status.
2. OCR errors on low-quality images:
   - Mitigation: preprocessing + confidence scoring + manual review path.
3. AI false positives:
   - Mitigation: threshold tuning, reason codes, human review queue.
4. Time compression:
   - Mitigation: freeze scope at core objectives, defer stretch features.

---

## 12. Stretch Goals (Only if core is complete)

1. Per-bank adaptive thresholds.
2. Drift detection and weekly retraining trigger.
3. Batch ingestion + webhook callbacks.
4. Lightweight mobile-friendly frontend mode.

---

## 13. Immediate Next Actions (Start Now)

1. Create orchestrator module and unified response DTO in Node.
2. Wire API key middleware and admin routes correctly.
3. Implement Node-to-AI client and fallback decision policy.
4. Build frontend verification page first (input -> decision -> evidence).
5. Run one full end-to-end demo scenario and record gaps.
