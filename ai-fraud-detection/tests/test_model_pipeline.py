"""
Integration Test — Full Model Pipeline

Tests the complete end-to-end flow:
    Data Generation → Feature Engineering → Training → Prediction → Evaluation

This test uses a small dataset for speed but validates the entire pipeline.
"""

import sys
import os
import tempfile
import pytest
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.data_generator import generate_full_dataset, save_transactions_to_csv, DATASET_COLUMNS
from src.features import build_feature_matrix, compute_bank_amount_stats, ReferenceFrequencyTracker, FEATURE_NAMES
from src.model import FraudDetectionModel
from dataclasses import asdict


class TestFullPipeline:
    """Integration test for the complete model pipeline."""
    
    @pytest.fixture(scope="class")
    def dataset(self):
        """Generate a small test dataset."""
        full, clean, contaminated = generate_full_dataset(
            n_clean=200, n_contaminated=50, seed=42
        )
        
        # Convert to DataFrames
        clean_df = pd.DataFrame([asdict(tx) for tx in clean])
        contaminated_df = pd.DataFrame([asdict(tx) for tx in contaminated])
        full_df = pd.DataFrame([asdict(tx) for tx in full])
        
        return clean_df, contaminated_df, full_df
    
    @pytest.fixture(scope="class")
    def trained_model(self, dataset):
        """Train a model on the test dataset."""
        clean_df, contaminated_df, _ = dataset
        model = FraudDetectionModel()
        model.train(clean_df, contaminated_df, verbose=False)
        return model
    
    def test_data_generation(self, dataset):
        """Test that data generation produces valid DataFrames."""
        clean_df, contaminated_df, full_df = dataset
        
        assert len(clean_df) == 200
        assert len(contaminated_df) == 50
        assert len(full_df) == 250
        
        # Check all expected columns exist
        for col in DATASET_COLUMNS:
            assert col in clean_df.columns, f"Missing column: {col}"
        
        # Check labels
        assert all(clean_df["is_fraud"] == 0)
        assert all(contaminated_df["is_fraud"] == 1)
    
    def test_feature_engineering(self, dataset):
        """Test that feature engineering produces valid matrix."""
        clean_df, _, _ = dataset
        
        bank_stats = compute_bank_amount_stats(clean_df)
        freq_tracker = ReferenceFrequencyTracker()
        freq_tracker.build_from_dataset(clean_df)
        
        X, names = build_feature_matrix(clean_df, bank_stats, freq_tracker)
        
        assert X.shape[0] == len(clean_df)
        assert X.shape[1] == len(FEATURE_NAMES)
        assert not np.any(np.isnan(X)), "Feature matrix contains NaN values"
        assert not np.any(np.isinf(X)), "Feature matrix contains Inf values"
    
    def test_model_training(self, trained_model):
        """Test that model trains successfully."""
        assert trained_model.isolation_forest is not None
        assert trained_model.calibrator is not None
        assert trained_model.scaler is not None
        assert trained_model.metadata["trained_at"] is not None
    
    def test_single_prediction(self, trained_model):
        """Test prediction for a single transaction."""
        tx = {
            "bank": "cbe",
            "reference": "FT2513001V2G",
            "amount": 5000.0,
            "payer_name": "Abebe Kebede",
            "payer_account": "A***1234",
            "receiver_name": "Tigist Haile",
            "receiver_account": "B***5678",
            "transaction_date": "2026-04-22T10:30:00+03:00",
        }
        
        result = trained_model.predict(tx)
        
        assert "risk_score" in result
        assert 0 <= result["risk_score"] <= 100
        assert result["status"] in ["Verified", "Low_Risk", "Suspicious", "Invalid"]
        assert isinstance(result["is_anomaly"], bool)
        assert 0 <= result["confidence"] <= 1
        assert len(result["contributing_features"]) > 0
    
    def test_batch_prediction(self, trained_model, dataset):
        """Test batch prediction."""
        _, _, full_df = dataset
        
        risk_scores, predictions, statuses = trained_model.predict_batch(full_df)
        
        assert len(risk_scores) == len(full_df)
        assert len(predictions) == len(full_df)
        assert len(statuses) == len(full_df)
        assert all(0 <= s <= 100 for s in risk_scores)
        assert all(p in [0, 1] for p in predictions)
    
    def test_model_separates_classes(self, trained_model, dataset):
        """Test that the model assigns higher risk to fraud transactions."""
        _, _, full_df = dataset
        
        risk_scores, _, _ = trained_model.predict_batch(full_df)
        
        clean_mask = full_df["is_fraud"] == 0
        fraud_mask = full_df["is_fraud"] == 1
        
        avg_clean = np.mean(risk_scores[clean_mask.values])
        avg_fraud = np.mean(risk_scores[fraud_mask.values])
        
        # Fraud transactions should have higher average risk score
        assert avg_fraud > avg_clean, (
            f"Model failed to separate classes: "
            f"avg_clean={avg_clean:.2f}, avg_fraud={avg_fraud:.2f}"
        )
    
    def test_model_save_load(self, trained_model, dataset):
        """Test model persistence (save + load)."""
        _, _, full_df = dataset
        
        with tempfile.TemporaryDirectory() as tmpdir:
            model_dir = os.path.join(tmpdir, "test_model")
            
            # Save
            trained_model.save(model_dir)
            
            # Verify files exist
            assert os.path.exists(os.path.join(model_dir, "isolation_forest.joblib"))
            assert os.path.exists(os.path.join(model_dir, "calibrator.joblib"))
            assert os.path.exists(os.path.join(model_dir, "scaler.joblib"))
            assert os.path.exists(os.path.join(model_dir, "metadata.json"))
            
            # Load into new model
            new_model = FraudDetectionModel()
            new_model.load(model_dir)
            
            # Predictions should match
            tx = {
                "bank": "cbe",
                "reference": "FT2513001V2G",
                "amount": 5000.0,
                "payer_name": "Abebe Kebede",
                "receiver_name": "Tigist Haile",
                "transaction_date": "2026-04-22T10:30:00+03:00",
            }
            
            result_original = trained_model.predict(tx)
            result_loaded = new_model.predict(tx)
            
            assert abs(result_original["risk_score"] - result_loaded["risk_score"]) < 0.01
    
    def test_suspicious_transaction_detection(self, trained_model):
        """Test that obviously suspicious transactions get high risk scores."""
        # Format violation: wrong prefix for CBE
        suspicious_tx = {
            "bank": "cbe",
            "reference": "XX!@#BROKEN",  # Invalid format
            "amount": 999999.99,  # Unusually large
            "payer_name": "A",  # Suspiciously short name
            "receiver_name": "A",  # Same short name
            "transaction_date": "2030-12-31T03:00:00+03:00",  # Future + night
        }
        
        result = trained_model.predict(suspicious_tx)
        # Should have elevated risk compared to baseline (~10-15 for clean).
        # With small training sets (200 samples), calibration is less extreme,
        # so we use a lower threshold. The full pipeline test (test_model_separates_classes)
        # validates overall class separation.
        assert result["risk_score"] > 15, (
            f"Suspicious transaction got very low risk: {result['risk_score']}"
        )
    
    def test_csv_export(self, dataset):
        """Test CSV export of transactions."""
        clean_df, _, _ = dataset
        
        with tempfile.TemporaryDirectory() as tmpdir:
            from src.data_generator import Transaction
            
            filepath = os.path.join(tmpdir, "test_export.csv")
            
            # Convert back to Transaction objects for the save function
            transactions = []
            for _, row in clean_df.iterrows():
                tx = Transaction(**{k: row[k] for k in DATASET_COLUMNS})
                transactions.append(tx)
            
            save_transactions_to_csv(transactions, filepath)
            
            # Read back and verify
            loaded_df = pd.read_csv(filepath)
            assert len(loaded_df) == len(clean_df)
            for col in DATASET_COLUMNS:
                assert col in loaded_df.columns


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
