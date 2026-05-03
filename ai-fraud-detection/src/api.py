"""
FastAPI Microservice for Fraud Detection

Exposes the trained fraud detection model as a REST API.
Designed to be called by the main Express verification server
after a successful bank verification.

Endpoints:
    POST /predict       — Score a transaction for fraud risk
    POST /predict/batch — Score multiple transactions at once
    GET  /health        — Health check
    GET  /model-info    — Model metadata and performance metrics
"""

import os
import sys
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from fastapi.requests import Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
import numpy as np

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.model import FraudDetectionModel


logger = logging.getLogger("fraud_detection_api")
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s - %(message)s"
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
logger.setLevel(logging.INFO)


# ──────────────────────────────────────────────────────────────────────────────
# Pydantic Models (Request / Response Schemas)
# ──────────────────────────────────────────────────────────────────────────────

class TransactionRequest(BaseModel):
    """Input schema for a single transaction prediction."""
    bank: str = Field(..., description="Bank identifier: cbe, telebirr, dashen, abyssinia, cbe_birr, mpesa")
    reference: str = Field(..., description="Transaction reference number")
    amount: float = Field(..., gt=0, description="Transaction amount in ETB")
    payer_name: str = Field(default="", description="Payer full name")
    payer_account: str = Field(default="", description="Payer account number")
    receiver_name: str = Field(default="", description="Receiver full name")
    receiver_account: str = Field(default="", description="Receiver account number")
    transaction_date: str = Field(default="", description="ISO 8601 timestamp")
    transaction_status: str = Field(default="Completed", description="Transaction status")
    reason: str = Field(default="", description="Payment reason/description")
    suffix: str = Field(default="", description="Account suffix (CBE, Abyssinia)")
    phone_number: str = Field(default="", description="Phone number (CBE Birr)")

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "bank": "cbe",
                    "reference": "FT2513001V2G",
                    "amount": 5000.00,
                    "payer_name": "Abebe Kebede",
                    "payer_account": "A***1234",
                    "receiver_name": "Tigist Haile",
                    "receiver_account": "B***5678",
                    "transaction_date": "2026-04-22T10:30:00+03:00",
                    "transaction_status": "Completed",
                    "reason": "Transfer",
                    "suffix": "39003377",
                }
            ]
        }
    }


class BatchTransactionRequest(BaseModel):
    """Input schema for batch prediction."""
    transactions: List[TransactionRequest] = Field(..., min_length=1, max_length=100)


class ContributingFeature(BaseModel):
    """A feature that contributed to the risk score."""
    feature: str
    value: float
    deviation: float


class PredictionResponse(BaseModel):
    """Output schema for a single prediction."""
    risk_score: float = Field(..., ge=0, le=100, description="Risk score from 0 (safe) to 100 (fraud)")
    status: str = Field(..., description="Risk classification: Verified, Low_Risk, Suspicious, Invalid")
    is_anomaly: bool = Field(..., description="Whether the Isolation Forest flagged this as anomalous")
    confidence: float = Field(..., ge=0, le=1, description="Model confidence (0-1)")
    anomaly_score_raw: float = Field(..., description="Raw Isolation Forest anomaly score")
    contributing_features: List[ContributingFeature] = Field(
        default_factory=list,
        description="Top features contributing to the risk score"
    )
    verification_source: str = Field(
        default="Internal_ML_Engine",
        description="Source of the decision for thesis reporting",
    )
    reason_codes: List[str] = Field(
        default_factory=list,
        description="Short reason codes derived from the strongest signals",
    )
    extracted_metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Normalized transaction metadata used for scoring",
    )
    raw: Dict[str, Any] = Field(
        default_factory=dict,
        description="Raw model outputs and supporting evidence",
    )


class BatchPredictionResponse(BaseModel):
    """Output schema for batch prediction."""
    predictions: List[PredictionResponse]
    summary: Dict[str, Any]


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    timestamp: str
    model_loaded: bool


class ModelInfoResponse(BaseModel):
    """Model information response."""
    version: str
    trained_at: Optional[str]
    n_train_clean: int
    n_train_contaminated: int
    n_features: int
    feature_names: List[str]
    calibration_accuracy: Optional[float]


def build_reason_codes(contributions: List[ContributingFeature], status: str) -> List[str]:
    """Convert the strongest feature signals into thesis-friendly reason codes."""
    feature_to_reason = {
        "shannon_entropy": "ENTROPY_ANOMALY",
        "structural_integrity": "FORMAT_VIOLATION",
        "ref_length_deviation": "REFERENCE_LENGTH_DRIFT",
        "special_char_ratio": "SPECIAL_CHARACTER_VIOLATION",
        "char_ngram_anomaly": "OCR_SUBSTITUTION_PATTERN",
        "is_future": "FUTURE_TIMESTAMP",
        "days_from_now": "TIMESTAMP_DRIFT",
        "z_score_amount": "AMOUNT_OUTLIER",
        "is_round_number": "ROUND_AMOUNT_PATTERN",
        "names_identical": "SELF_TRANSFER_PATTERN",
        "name_similarity": "IDENTITY_SIMILARITY",
        "reference_count": "REFERENCE_REUSE",
        "is_duplicate": "DUPLICATE_REFERENCE",
        "payer_reference_count": "PAYER_REFERENCE_REUSE",
    }

    reason_codes: List[str] = []
    for contribution in contributions[:3]:
        reason = feature_to_reason.get(contribution.feature, contribution.feature.upper())
        if reason not in reason_codes:
            reason_codes.append(reason)

    if not reason_codes:
        reason_codes.append("MODEL_SCORE_ONLY")

    if status == "Invalid" and "HIGH_RISK_SCORE" not in reason_codes:
        reason_codes.append("HIGH_RISK_SCORE")

    return reason_codes


def build_extracted_metadata(transaction: TransactionRequest) -> Dict[str, Any]:
    """Build a normalized metadata payload for the prediction response."""
    return {
        "bank": transaction.bank,
        "reference": transaction.reference,
        "amount": transaction.amount,
        "currency": "ETB",
        "transaction_date": transaction.transaction_date,
        "payer_name": transaction.payer_name,
        "payer_account": transaction.payer_account,
        "receiver_name": transaction.receiver_name,
        "receiver_account": transaction.receiver_account,
        "transaction_status": transaction.transaction_status,
        "reason": transaction.reason,
        "suffix": transaction.suffix,
        "phone_number": transaction.phone_number,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Application Setup
# ──────────────────────────────────────────────────────────────────────────────

from contextlib import asynccontextmanager

# Global model instance
model: Optional[FraudDetectionModel] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the trained model on startup, cleanup on shutdown."""
    global model
    logger.info("Starting fraud detection service")
    
    # Look for model in standard locations
    model_dir = os.environ.get("MODEL_DIR", os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "models", "production"
    ))
    
    logger.info("Using model directory: %s", model_dir)
    if os.path.exists(model_dir) and os.path.exists(os.path.join(model_dir, "metadata.json")):
        model = FraudDetectionModel()
        try:
            model.load(model_dir)
            logger.info("Model loaded from %s", model_dir)
        except Exception:
            logger.exception("Failed to load model from %s", model_dir)
            model = None
    else:
        logger.warning("No trained model found at %s", model_dir)
        logger.warning("Run 'python scripts/train.py' first to train the model.")
        model = None
    
    yield  # App runs here
    
    # Cleanup (if needed)
    logger.info("Shutting down fraud detection service")
    model = None


app = FastAPI(
    title="Fraud Detection Microservice",
    description=(
        "AI-powered fraud detection for the Multi-Bank Transaction Verification System. "
        "Uses Isolation Forest anomaly detection with Logistic Regression calibration "
        "to produce risk scores (0-100) for payment transactions."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.warning("Validation failed for %s %s: %s", request.method, request.url.path, exc.errors())
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error during %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error": str(exc)},
    )


# ──────────────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Check if the service is running and the model is loaded."""
    return HealthResponse(
        status="ok",
        timestamp=datetime.now().isoformat(),
        model_loaded=model is not None,
    )


@app.get("/model-info", response_model=ModelInfoResponse)
async def model_info():
    """Get information about the loaded model."""
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded. Run training first.")
    
    meta = model.metadata
    return ModelInfoResponse(
        version=meta.get("version", "unknown"),
        trained_at=meta.get("trained_at"),
        n_train_clean=meta.get("n_train_clean", 0),
        n_train_contaminated=meta.get("n_train_contaminated", 0),
        n_features=meta.get("n_features", 0),
        feature_names=meta.get("feature_names", []),
        calibration_accuracy=meta.get("calibration_accuracy"),
    )


@app.post("/predict", response_model=PredictionResponse)
async def predict(transaction: TransactionRequest):
    """
    Predict fraud risk for a single transaction.
    
    Returns a risk score (0-100), status classification, and the top contributing
    features that influenced the score.
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded. Run training first.")
    
    tx_dict = transaction.model_dump()
    logger.info(
        "Predict request received bank=%s reference=%s amount=%s status=%s",
        transaction.bank,
        transaction.reference,
        transaction.amount,
        transaction.transaction_status,
    )

    try:
        result = model.predict(tx_dict)
        contributing = [ContributingFeature(**f) for f in result["contributing_features"]]
    except Exception:
        logger.exception(
            "Prediction failed bank=%s reference=%s amount=%s",
            transaction.bank,
            transaction.reference,
            transaction.amount,
        )
        raise HTTPException(status_code=500, detail="Prediction failed")

    logger.info(
        "Prediction complete bank=%s reference=%s risk_score=%s status=%s anomaly=%s",
        transaction.bank,
        transaction.reference,
        result["risk_score"],
        result["status"],
        result["is_anomaly"],
    )
    
    return PredictionResponse(
        risk_score=result["risk_score"],
        status=result["status"],
        is_anomaly=result["is_anomaly"],
        confidence=result["confidence"],
        anomaly_score_raw=result["anomaly_score_raw"],
        contributing_features=contributing,
        reason_codes=build_reason_codes(contributing, result["status"]),
        extracted_metadata=build_extracted_metadata(transaction),
        raw={
            "ml": result,
            "deterministic": {},
        },
    )


@app.post("/predict/batch", response_model=BatchPredictionResponse)
async def predict_batch(request: BatchTransactionRequest):
    """
    Predict fraud risk for multiple transactions at once.
    
    Accepts up to 100 transactions and returns individual predictions
    plus a summary of the batch.
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded. Run training first.")
    
    logger.info("Batch predict request received count=%s", len(request.transactions))
    predictions = []
    risk_scores = []
    
    for tx in request.transactions:
        tx_dict = tx.model_dump()
        try:
            result = model.predict(tx_dict)
            contributing = [ContributingFeature(**f) for f in result["contributing_features"]]
        except Exception:
            logger.exception(
                "Batch prediction failed bank=%s reference=%s amount=%s",
                tx.bank,
                tx.reference,
                tx.amount,
            )
            raise HTTPException(status_code=500, detail="Batch prediction failed")
        predictions.append(PredictionResponse(
            risk_score=result["risk_score"],
            status=result["status"],
            is_anomaly=result["is_anomaly"],
            confidence=result["confidence"],
            anomaly_score_raw=result["anomaly_score_raw"],
            contributing_features=contributing,
            reason_codes=build_reason_codes(contributing, result["status"]),
            extracted_metadata=build_extracted_metadata(tx),
            raw={
                "ml": result,
                "deterministic": {},
            },
        ))
        risk_scores.append(result["risk_score"])
    
    # Compute batch summary
    scores_array = np.array(risk_scores)
    summary = {
        "total": len(predictions),
        "avg_risk_score": round(float(np.mean(scores_array)), 2),
        "max_risk_score": round(float(np.max(scores_array)), 2),
        "min_risk_score": round(float(np.min(scores_array)), 2),
        "n_verified": sum(1 for p in predictions if p.status == "Verified"),
        "n_low_risk": sum(1 for p in predictions if p.status == "Low_Risk"),
        "n_suspicious": sum(1 for p in predictions if p.status == "Suspicious"),
        "n_invalid": sum(1 for p in predictions if p.status == "Invalid"),
    }
    
    logger.info("Batch predict complete count=%s avg_risk=%s", len(predictions), summary["avg_risk_score"])
    return BatchPredictionResponse(predictions=predictions, summary=summary)


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    
    port = int(os.environ.get("FRAUD_DETECTION_PORT", 8000))
    uvicorn.run(
        "src.api:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        log_level="info",
    )
