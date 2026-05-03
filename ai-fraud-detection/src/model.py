"""
Fraud Detection Model — Training and Inference

Implements the dual-model architecture described in the thesis:
    1. Isolation Forest — Unsupervised anomaly detector trained on clean data only
    2. Logistic Regression — Supervised calibrator that maps raw anomaly scores
       to interpretable risk scores (0-100)

The Isolation Forest learns the "normal" manifold of legitimate transactions.
Points that deviate from this manifold receive higher anomaly scores.
The Logistic Regression calibrator then normalizes these scores and adds
supervised signal from the labeled contaminated dataset.

Model persistence uses joblib for efficient serialization of numpy-backed models.
"""

import os
import json
import logging
import numpy as np
import pandas as pd
import joblib
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any

from sklearn.ensemble import IsolationForest
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split

from .features import (
    build_feature_matrix,
    compute_bank_amount_stats,
    FEATURE_NAMES,
    NUM_FEATURES,
)


logger = logging.getLogger("fraud_detection_model")


# ──────────────────────────────────────────────────────────────────────────────
# Model Configuration
# ──────────────────────────────────────────────────────────────────────────────

DEFAULT_CONFIG = {
    # Isolation Forest parameters
    "if_n_estimators": 200,          # Number of trees
    "if_max_samples": "auto",        # Samples per tree
    "if_contamination": 0.15,        # Expected anomaly fraction in training data
    "if_max_features": 1.0,          # Features per tree
    "if_random_state": 42,           # Reproducibility seed
    
    # Logistic Regression parameters
    "lr_C": 1.0,                     # Regularization strength
    "lr_max_iter": 1000,             # Max iterations
    "lr_random_state": 42,           # Reproducibility seed
    
    # Display thresholds for risk score classification (0-100 scale)
    "threshold_low_risk": 25,        # Below this = Verified
    "threshold_suspicious": 50,      # Above this = Suspicious
    "threshold_high_risk": 80,       # Above this = Invalid/Rejected
    
    # Binary classification threshold (probability space, 0-1)
    # Auto-tuned during training to maximize F1
    "binary_threshold": 0.5,
    
    # Training parameters
    "test_size": 0.15,               # Hold-out test fraction
    "val_size": 0.15,                # Validation fraction (from remaining)
}


# ──────────────────────────────────────────────────────────────────────────────
# Fraud Detection Model
# ──────────────────────────────────────────────────────────────────────────────

class FraudDetectionModel:
    """
    Two-stage fraud detection model:
        Stage 1: Isolation Forest (unsupervised anomaly detection)
        Stage 2: Logistic Regression (supervised risk score calibration)
    
    The model operates on feature vectors produced by the features module.
    """
    
    def __init__(self, config: Optional[Dict] = None):
        self.config = {**DEFAULT_CONFIG, **(config or {})}
        
        # Models
        self.isolation_forest: Optional[IsolationForest] = None
        self.calibrator: Optional[LogisticRegression] = None
        self.scaler: Optional[StandardScaler] = None
        
        # Feature context
        self.bank_stats: Optional[Dict] = None
        self.feature_names: List[str] = FEATURE_NAMES.copy()
        
        # Metadata
        self.metadata: Dict[str, Any] = {
            "version": "1.0.0",
            "trained_at": None,
            "n_train_clean": 0,
            "n_train_contaminated": 0,
            "n_features": NUM_FEATURES,
            "feature_names": self.feature_names,
            "config": self.config,
        }
    
    def _build_features(self, df: pd.DataFrame) -> np.ndarray:
        """Build scaled feature matrix from a dataframe."""
        X, _ = build_feature_matrix(df, self.bank_stats, self.freq_tracker)
        return X

    def _align_feature_matrix(self, X: np.ndarray) -> np.ndarray:
        """Pad or trim features so inference matches the loaded scaler."""
        if self.scaler is None:
            return X

        expected_features = getattr(self.scaler, "n_features_in_", X.shape[1])
        current_features = X.shape[1]

        if current_features == expected_features:
            return X

        if current_features < expected_features:
            logger.warning(
                "Padding feature matrix from %s to %s columns for compatibility",
                current_features,
                expected_features,
            )
            padding = np.zeros((X.shape[0], expected_features - current_features), dtype=X.dtype)
            return np.hstack([X, padding])

        logger.warning(
            "Trimming feature matrix from %s to %s columns for compatibility",
            current_features,
            expected_features,
        )
        return X[:, :expected_features]
    
    def train(self, clean_df: pd.DataFrame, 
              contaminated_df: pd.DataFrame,
              verbose: bool = True) -> Dict[str, Any]:
        """
        Train the complete model pipeline.
        
        Steps:
            1. Compute bank statistics from clean data
            2. Build reference frequency tracker from full dataset
            3. Build feature matrices
            4. Fit StandardScaler on clean data
            5. Train Isolation Forest on clean data (unsupervised)
            6. Generate anomaly scores for validation set
            7. Train Logistic Regression calibrator (supervised)
        
        Args:
            clean_df: DataFrame of clean (legitimate) transactions
            contaminated_df: DataFrame of contaminated (fraudulent) transactions
            verbose: Print progress updates
        
        Returns:
            Training report dict with metrics and configuration
        """
        if verbose:
            print("\n" + "=" * 60)
            print("  Model Training Pipeline")
            print("=" * 60)
        
        # ── Step 1: Compute bank statistics ──
        if verbose:
            print("\n[1/7] Computing bank amount statistics...")
        self.bank_stats = compute_bank_amount_stats(clean_df)
        
        # ── Step 2: Build feature matrices ──
        if verbose:
            print("[3/7] Engineering features...")
        X_clean = self._build_features(clean_df)
        X_contaminated = self._build_features(contaminated_df)
        
        if verbose:
            print(f"       Clean features shape:        {X_clean.shape}")
            print(f"       Contaminated features shape:  {X_contaminated.shape}")
        
        # ── Step 3: Fit scaler on clean data ──
        if verbose:
            print("[4/7] Fitting StandardScaler on clean data...")
        self.scaler = StandardScaler()
        X_clean_scaled = self.scaler.fit_transform(X_clean)
        X_contaminated_scaled = self.scaler.transform(X_contaminated)
        
        # ── Step 4: Train Isolation Forest ──
        if verbose:
            print(f"[5/7] Training Isolation Forest (n_estimators={self.config['if_n_estimators']})...")
        
        self.isolation_forest = IsolationForest(
            n_estimators=self.config["if_n_estimators"],
            max_samples=self.config["if_max_samples"],
            contamination=self.config["if_contamination"],
            max_features=self.config["if_max_features"],
            random_state=self.config["if_random_state"],
            n_jobs=-1,
        )
        self.isolation_forest.fit(X_clean_scaled)
        
        # ── Step 5: Build calibration features ──
        if verbose:
            print("[6/7] Building calibration features...")
        
        # Combine clean + contaminated for calibration training
        X_all = np.vstack([X_clean_scaled, X_contaminated_scaled])
        y_all = np.concatenate([
            np.zeros(len(X_clean_scaled)),      # 0 = clean
            np.ones(len(X_contaminated_scaled)), # 1 = fraud
        ])
        
        # Get raw anomaly scores from Isolation Forest
        # score_samples returns negative scores: lower = more anomalous
        raw_scores = self.isolation_forest.score_samples(X_all)
        if_predictions = self.isolation_forest.predict(X_all)  # 1 = inlier, -1 = outlier
        
        # Build enriched calibration features:
        # [raw_anomaly_score, is_outlier, decision_function + original features]
        # Giving LR the full feature vector alongside the anomaly score
        # lets it learn which feature patterns correspond to fraud
        is_outlier = (if_predictions == -1).astype(float).reshape(-1, 1)
        calibration_features = np.hstack([
            raw_scores.reshape(-1, 1),
            is_outlier,
            X_all,  # Full feature vector for richer signal
        ])
        
        # Split for calibration training vs validation
        cal_train, cal_val, y_train, y_val = train_test_split(
            calibration_features, y_all,
            test_size=self.config["val_size"],
            random_state=self.config["lr_random_state"],
            stratify=y_all,
        )
        
        # ── Step 6: Train Logistic Regression calibrator ──
        if verbose:
            print("[7/7] Training Logistic Regression calibrator...")
        
        self.calibrator = LogisticRegression(
            C=self.config["lr_C"],
            max_iter=self.config["lr_max_iter"],
            random_state=self.config["lr_random_state"],
        )
        self.calibrator.fit(cal_train, y_train)
        
        # Calibration accuracy
        cal_accuracy = self.calibrator.score(cal_val, y_val)
        
        # ── Auto-tune binary threshold using F1 optimization ──
        from sklearn.metrics import f1_score as f1_func
        cal_probs = self.calibrator.predict_proba(cal_val)[:, 1]
        best_threshold = 0.5
        best_f1 = 0.0
        for t in np.arange(0.05, 0.95, 0.005):
            preds = (cal_probs >= t).astype(int)
            f1_val = f1_func(y_val, preds, zero_division=0)
            if f1_val > best_f1:
                best_f1 = f1_val
                best_threshold = t
        
        # Store the binary threshold in probability space (0-1)
        self.config["binary_threshold"] = round(best_threshold, 4)
        
        if verbose:
            print(f"       Auto-tuned binary threshold: {self.config['binary_threshold']} "
                  f"(probability space, F1={best_f1:.4f})")
        
        # ── Update metadata ──
        self.metadata.update({
            "trained_at": datetime.now().isoformat(),
            "n_train_clean": len(clean_df),
            "n_train_contaminated": len(contaminated_df),
            "calibration_accuracy": round(cal_accuracy, 4),
            "binary_threshold": self.config["binary_threshold"],
            "optimal_f1": round(best_f1, 4),
        })
        
        if verbose:
            print(f"\n{'─' * 60}")
            print(f"  Training Complete!")
            print(f"  Calibration accuracy: {cal_accuracy:.4f}")
            print(f"  Binary threshold:     {self.config['binary_threshold']} (probability)")
            print(f"  Validation F1:        {best_f1:.4f}")
            print(f"  Model ready for inference.")
            print(f"{'─' * 60}\n")
        
        return self.metadata
    
    def predict(self, transaction: Dict) -> Dict[str, Any]:
        """
        Predict fraud risk for a single transaction.
        
        Args:
            transaction: Dict with transaction fields
        
        Returns:
            {
                "risk_score": float (0-100),
                "status": str ("Verified" | "Low_Risk" | "Suspicious" | "Invalid"),
                "is_anomaly": bool,
                "confidence": float (0.0-1.0),
                "anomaly_score_raw": float,
                "contributing_features": List[Dict],
            }
        """
        if not self.isolation_forest or not self.calibrator or not self.scaler:
            raise RuntimeError("Model not trained. Call train() first or load a saved model.")
        
        # Build feature vector
        from .features import build_feature_vector
        feature_vec = build_feature_vector(transaction, self.bank_stats, self.freq_tracker)

        # Keep inference compatible with legacy saved artifacts if the feature
        # builder and scaler were trained with different column counts.
        feature_vec = self._align_feature_matrix(feature_vec.reshape(1, -1))[0]
        
        # Scale
        feature_vec_scaled = self.scaler.transform(feature_vec.reshape(1, -1))
        
        # Isolation Forest anomaly score
        raw_score = self.isolation_forest.score_samples(feature_vec_scaled)[0]
        is_anomaly = self.isolation_forest.predict(feature_vec_scaled)[0] == -1
        
        # Build calibration features (must match training structure)
        is_outlier = 1.0 if is_anomaly else 0.0
        cal_features = np.hstack([
            np.array([[raw_score]]),
            np.array([[is_outlier]]),
            feature_vec_scaled,
        ])
        
        # Calibrate to probability
        fraud_probability = self.calibrator.predict_proba(cal_features)[0][1]
        
        # Convert to 0-100 risk score
        risk_score = round(fraud_probability * 100, 2)
        
        # Determine status
        status = self._classify_risk(risk_score)
        
        # Feature contribution analysis
        contributing = self._analyze_contributions(feature_vec, feature_vec_scaled)
        
        return {
            "risk_score": risk_score,
            "status": status,
            "is_anomaly": bool(is_anomaly),
            "confidence": round(1.0 - abs(fraud_probability - 0.5) * 2, 4),
            "anomaly_score_raw": round(float(raw_score), 6),
            "contributing_features": contributing,
        }
    
    def predict_batch(self, df: pd.DataFrame) -> Tuple[np.ndarray, np.ndarray, List[str]]:
        """
        Predict fraud risk for a batch of transactions.
        
        Returns:
            (risk_scores, predictions, statuses)
            - risk_scores: Array of 0-100 scores
            - predictions: Array of 0/1 binary predictions
            - statuses: List of status strings
        """
        if not self.isolation_forest or not self.calibrator or not self.scaler:
            raise RuntimeError("Model not trained.")
        
        X = self._build_features(df)
        X = self._align_feature_matrix(X)
        X_scaled = self.scaler.transform(X)
        
        # Raw anomaly scores
        raw_scores = self.isolation_forest.score_samples(X_scaled)
        if_predictions = self.isolation_forest.predict(X_scaled)
        is_outlier = (if_predictions == -1).astype(float).reshape(-1, 1)
        
        # Build calibration features (must match training structure)
        calibration_features = np.hstack([
            raw_scores.reshape(-1, 1),
            is_outlier,
            X_scaled,
        ])
        
        # Calibrated probabilities
        fraud_probs = self.calibrator.predict_proba(calibration_features)[:, 1]
        
        # Risk scores (0-100)
        risk_scores = np.round(fraud_probs * 100, 2)
        
        # Binary predictions using auto-tuned probability threshold
        predictions = (fraud_probs >= self.config["binary_threshold"]).astype(int)
        
        # Status labels
        statuses = [self._classify_risk(score) for score in risk_scores]
        
        return risk_scores, predictions, statuses
    
    def _classify_risk(self, risk_score: float) -> str:
        """Map a risk score to a status label."""
        if risk_score < self.config["threshold_low_risk"]:
            return "Verified"
        elif risk_score < self.config["threshold_suspicious"]:
            return "Low_Risk"
        elif risk_score < self.config["threshold_high_risk"]:
            return "Suspicious"
        else:
            return "Invalid"
    
    def _analyze_contributions(self, feature_vec: np.ndarray,
                                feature_vec_scaled: np.ndarray) -> List[Dict]:
        """
        Analyze which features contributed most to the anomaly score.
        
        Uses the absolute deviation from the training mean (in scaled space)
        as a proxy for feature importance. Features with the largest deviations
        are most responsible for the anomaly score.
        """
        # Deviation from mean (in scaled space, mean ≈ 0)
        deviations = np.abs(feature_vec_scaled[0])
        
        # Get top contributing features
        top_indices = np.argsort(deviations)[::-1][:5]
        
        contributions = []
        for idx in top_indices:
            if idx < len(self.feature_names):
                contributions.append({
                    "feature": self.feature_names[idx],
                    "value": round(float(feature_vec[idx]), 4),
                    "deviation": round(float(deviations[idx]), 4),
                })
        
        return contributions
    
    # ──────────────────────────────────────────────────────────────────────────
    # Model Persistence
    # ──────────────────────────────────────────────────────────────────────────
    
    def save(self, model_dir: str) -> None:
        """
        Save all model artifacts to a directory.
        
        Saves:
            - isolation_forest.joblib — The Isolation Forest model
            - calibrator.joblib — The Logistic Regression calibrator
            - scaler.joblib — The StandardScaler
            - bank_stats.json — Bank amount statistics
            - freq_tracker.joblib — Reference frequency tracker
            - metadata.json — Model metadata and configuration
        """
        os.makedirs(model_dir, exist_ok=True)
        
        joblib.dump(self.isolation_forest, os.path.join(model_dir, "isolation_forest.joblib"))
        joblib.dump(self.calibrator, os.path.join(model_dir, "calibrator.joblib"))
        joblib.dump(self.scaler, os.path.join(model_dir, "scaler.joblib"))
        joblib.dump(self.freq_tracker, os.path.join(model_dir, "freq_tracker.joblib"))
        
        # Save bank stats as JSON (human-readable)
        with open(os.path.join(model_dir, "bank_stats.json"), "w") as f:
            json.dump(self.bank_stats, f, indent=2)
        
        # Save metadata
        with open(os.path.join(model_dir, "metadata.json"), "w") as f:
            # Remove non-serializable items
            meta = {k: v for k, v in self.metadata.items()}
            json.dump(meta, f, indent=2, default=str)
        
        print(f"  ✅ Model saved to {model_dir}")
    
    def load(self, model_dir: str) -> None:
        """
        Load all model artifacts from a directory.
        """
        self.isolation_forest = joblib.load(os.path.join(model_dir, "isolation_forest.joblib"))
        self.calibrator = joblib.load(os.path.join(model_dir, "calibrator.joblib"))
        self.scaler = joblib.load(os.path.join(model_dir, "scaler.joblib"))
        self.freq_tracker = joblib.load(os.path.join(model_dir, "freq_tracker.joblib"))
        
        with open(os.path.join(model_dir, "bank_stats.json"), "r") as f:
            self.bank_stats = json.load(f)
        
        with open(os.path.join(model_dir, "metadata.json"), "r") as f:
            self.metadata = json.load(f)
        
        self.feature_names = self.metadata.get("feature_names", FEATURE_NAMES.copy())
        
        # Restore config (including auto-tuned binary_threshold)
        saved_config = self.metadata.get("config", {})
        self.config.update(saved_config)
        # Also check top-level metadata for binary_threshold (backward compat)
        if "binary_threshold" in self.metadata:
            self.config["binary_threshold"] = self.metadata["binary_threshold"]
        
        print(f"  ✅ Model loaded from {model_dir}")
        print(f"     Trained at: {self.metadata.get('trained_at', 'unknown')}")
        print(f"     Features:   {self.metadata.get('n_features', '?')}")
        print(f"     Threshold:  {self.config.get('binary_threshold', 0.5)}")
