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
from typing import Dict, List, Optional, Any
from datetime import datetime

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import numpy as np

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.model import FraudDetectionModel


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
    
    # Look for model in standard locations
    model_dir = os.environ.get("MODEL_DIR", os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "models", "production"
    ))
    
    if os.path.exists(model_dir) and os.path.exists(os.path.join(model_dir, "metadata.json")):
        model = FraudDetectionModel()
        model.load(model_dir)
        print(f"Model loaded from {model_dir}")
    else:
        print(f"No trained model found at {model_dir}")
        print(f"Run 'python scripts/train.py' first to train the model.")
        model = None
    
    yield  # App runs here
    
    # Cleanup (if needed)
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
    result = model.predict(tx_dict)
    
    return PredictionResponse(
        risk_score=result["risk_score"],
        status=result["status"],
        is_anomaly=result["is_anomaly"],
        confidence=result["confidence"],
        anomaly_score_raw=result["anomaly_score_raw"],
        contributing_features=[
            ContributingFeature(**f) for f in result["contributing_features"]
        ],
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
    
    predictions = []
    risk_scores = []
    
    for tx in request.transactions:
        tx_dict = tx.model_dump()
        result = model.predict(tx_dict)
        predictions.append(PredictionResponse(
            risk_score=result["risk_score"],
            status=result["status"],
            is_anomaly=result["is_anomaly"],
            confidence=result["confidence"],
            anomaly_score_raw=result["anomaly_score_raw"],
            contributing_features=[
                ContributingFeature(**f) for f in result["contributing_features"]
            ],
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
