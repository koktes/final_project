# AI Fraud Detection Module

Intelligent fraud detection engine for the Multi-Bank Transaction Verification System.

This module implements the probabilistic verification path (Path B) described in the thesis:
**"Design and Evaluation of a Multi-Bank Transaction Verification System with Intelligent Fraud Detection."**

## Architecture

```
ai-fraud-detection/
├── src/
│   ├── __init__.py           # Package metadata
│   ├── data_generator.py     # Synthetic transaction dataset generator
│   ├── features.py           # Feature engineering pipeline (38 features)
│   ├── model.py              # Isolation Forest + LR calibration model
│   ├── evaluate.py           # Evaluation framework (metrics + plots)
│   └── api.py                # FastAPI microservice
├── scripts/
│   ├── train.py              # End-to-end training pipeline CLI
│   └── generate_data.py      # Standalone data generation CLI
├── tests/
│   ├── test_features.py      # Unit tests: feature engineering
│   ├── test_data_generator.py # Unit tests: data generation
│   └── test_model_pipeline.py # Integration tests: full pipeline
├── data/                     # Generated datasets (CSV)
├── models/                   # Trained model artifacts
├── results/                  # Evaluation plots and reports
└── requirements.txt          # Python dependencies
```

## Quick Start

### 1. Install Dependencies

```bash
cd ai-fraud-detection
pip install -r requirements.txt
```

### 2. Run the Full Training Pipeline

```bash
python scripts/train.py
```

This will:
1. Generate 5,000 clean + 1,000 contaminated synthetic transactions
2. Engineer 38 numerical features per transaction
3. Train an Isolation Forest anomaly detector on clean data
4. Calibrate risk scores using Logistic Regression
5. Evaluate with Precision/Recall/F1/ROC-AUC
6. Generate thesis-ready plots
7. Save the trained model

### 3. Start the API Server

```bash
python -m src.api
```

The API will start on `http://localhost:8000`. Visit `http://localhost:8000/docs` for interactive documentation.

### 4. Run Tests

```bash
python -m pytest tests/ -v
```

## Model Architecture

### Two-Stage Detection

1. **Isolation Forest** (Unsupervised) — Trained only on clean/legitimate transactions. Learns the "normal" manifold. Transactions that deviate from this manifold are flagged as anomalous.

2. **Logistic Regression Calibrator** (Supervised) — Maps raw Isolation Forest anomaly scores to interpretable risk scores (0–100) using labeled training data.

### Feature Categories (38 total)

| Category | Features | Purpose |
|---|---|---|
| Reference Analysis | Shannon entropy, structural integrity, length deviation, special chars, OCR n-gram anomaly | Detect forged/manipulated reference numbers |
| Temporal Analysis | Hour, day-of-week, business hours, weekend, night, cyclic encoding, future detection | Detect implausible timestamps |
| Amount Analysis | Log-amount, z-score, round number, magnitude, decimal part | Detect unusual transaction amounts |
| Identity Analysis | Name lengths, similarity, identical check, word counts | Detect name manipulation |
| Frequency Analysis | Reference count, duplicate flag, payer-reference count | Detect replay attacks |
| Bank Encoding | One-hot encoding for 6 banks | Bank-specific pattern detection |

### Risk Classification

| Risk Score | Status | Meaning |
|---|---|---|
| 0–24 | **Verified** | Transaction appears legitimate |
| 25–59 | **Low_Risk** | Minor anomalies detected, likely legitimate |
| 60–84 | **Suspicious** | Significant anomalies, manual review recommended |
| 85–100 | **Invalid** | High fraud probability, should be rejected |

## Synthetic Dataset

The training data is generated synthetically because labeled fraud data from Ethiopian banks does not exist. The generator produces:

### Clean Transactions (5,000)
- Follow real bank reference patterns (CBE: FT + 10 chars, Telebirr: CE + 8 chars, etc.)
- Log-normal amount distributions (most 50–5000 ETB, few large outliers)
- Business-hours-biased timestamps
- Ethiopian name corpus

### Contaminated Transactions (1,000)
Six attack types with equal distribution:

| Attack | Description | Primary Detection Feature |
|---|---|---|
| **Replay** | Reused reference number with different details | Reference frequency |
| **Fuzzing** | OCR-like character swaps (0↔O, 1↔I, S↔5) | Shannon entropy deviation |
| **Amount Tamper** | Altered amount (10–80% change) | Amount z-score |
| **Temporal Anomaly** | Future dates, 2–4 AM timestamps | Time features |
| **Format Violation** | Wrong prefix, length, or special characters | Structural integrity |
| **Name Mismatch** | Swapped or identical payer/receiver names | Name similarity |

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/predict` | Score a single transaction |
| `POST` | `/predict/batch` | Score up to 100 transactions |
| `GET` | `/health` | Health check |
| `GET` | `/model-info` | Model metadata and metrics |
| `GET` | `/docs` | Interactive API documentation |

### Example Request

```bash
curl -X POST http://localhost:8000/predict \
  -H "Content-Type: application/json" \
  -d '{
    "bank": "cbe",
    "reference": "FT2513001V2G",
    "amount": 5000.00,
    "payer_name": "Abebe Kebede",
    "receiver_name": "Tigist Haile",
    "transaction_date": "2026-04-22T10:30:00+03:00"
  }'
```

### Example Response

```json
{
  "risk_score": 12.5,
  "status": "Verified",
  "is_anomaly": false,
  "confidence": 0.85,
  "anomaly_score_raw": -0.152,
  "contributing_features": [
    {"feature": "structural_integrity", "value": 1.0, "deviation": 0.12},
    {"feature": "is_business_hours", "value": 1.0, "deviation": 0.08}
  ]
}
```

## Reproducibility

All random operations use fixed seeds:
- Data generation: seed 42
- Model training: seed 42
- Train/test split: seed 42

To reproduce results exactly:
```bash
python scripts/train.py --seed 42
```
