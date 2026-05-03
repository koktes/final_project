"""
Unit Tests for Feature Engineering Pipeline

Tests each feature computation function for correctness,
edge cases, and expected behavior on known inputs.
"""

import sys
import os
import math
import pytest
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.features import (
    compute_shannon_entropy,
    compute_structural_integrity,
    compute_reference_length_deviation,
    compute_special_char_ratio,
    compute_time_features,
    compute_amount_features,
    compute_name_features,
    ReferenceFrequencyTracker,
    encode_bank,
    build_feature_dict,
    build_feature_vector,
    FEATURE_NAMES,
    NUM_FEATURES,
)


# ──────────────────────────────────────────────────────────────────────────────
# Shannon Entropy Tests
# ──────────────────────────────────────────────────────────────────────────────

class TestShannonEntropy:
    """Test Shannon entropy computation."""
    
    def test_empty_string(self):
        """Empty string should have zero entropy."""
        assert compute_shannon_entropy("") == 0.0
    
    def test_single_character(self):
        """String with one unique character has zero entropy."""
        assert compute_shannon_entropy("AAAA") == 0.0
    
    def test_two_equal_characters(self):
        """String 'AB' has entropy of 1.0 bits."""
        entropy = compute_shannon_entropy("AB")
        assert abs(entropy - 1.0) < 0.001
    
    def test_maximum_entropy(self):
        """All unique characters maximizes entropy."""
        # "ABCD" - 4 unique chars, each appears once → log2(4) = 2.0
        entropy = compute_shannon_entropy("ABCD")
        assert abs(entropy - 2.0) < 0.001
    
    def test_real_cbe_reference(self):
        """Real CBE reference should have moderate entropy."""
        entropy = compute_shannon_entropy("FT2513001V2G")
        assert 2.0 < entropy < 4.0  # Expected range for 12-char alphanumeric
    
    def test_low_entropy_reference(self):
        """Repetitive reference should have lower entropy."""
        entropy = compute_shannon_entropy("AAAAAAAAAAAA")
        assert entropy == 0.0
    
    def test_high_entropy_reference(self):
        """Reference with many unique chars has higher entropy."""
        entropy = compute_shannon_entropy("FT2A4B6C8D0E")
        assert entropy > 2.5


# ──────────────────────────────────────────────────────────────────────────────
# Structural Integrity Tests
# ──────────────────────────────────────────────────────────────────────────────

class TestStructuralIntegrity:
    """Test structural integrity scoring."""
    
    def test_perfect_cbe_reference(self):
        """Valid CBE reference should score high."""
        score = compute_structural_integrity("FT2513001V2G", "cbe")
        assert score >= 0.9
    
    def test_perfect_telebirr_reference(self):
        """Valid Telebirr reference should score high."""
        score = compute_structural_integrity("CE2513001X", "telebirr")
        assert score >= 0.9
    
    def test_wrong_prefix(self):
        """Wrong prefix should reduce score significantly."""
        score_correct = compute_structural_integrity("FT2513001V2G", "cbe")
        score_wrong = compute_structural_integrity("CE2513001V2G", "cbe")
        assert score_correct > score_wrong
    
    def test_wrong_length(self):
        """Wrong length should reduce score."""
        score_correct = compute_structural_integrity("FT2513001V2G", "cbe")
        score_short = compute_structural_integrity("FT251300", "cbe")
        assert score_correct > score_short
    
    def test_special_characters(self):
        """Special characters in reference should reduce score."""
        score_clean = compute_structural_integrity("FT2513001V2G", "cbe")
        score_dirty = compute_structural_integrity("FT25!300#V2G", "cbe")
        assert score_clean > score_dirty
    
    def test_unknown_bank(self):
        """Unknown bank should return 0.0."""
        score = compute_structural_integrity("FT2513001V2G", "unknown_bank")
        assert score == 0.0
    
    def test_dashen_reference(self):
        """Dashen reference (3 digits + 13 chars) should score well."""
        score = compute_structural_integrity("123ABCDEFGHIJKLM", "dashen")
        # 16 chars, starts with 3 digits
        assert score >= 0.7


# ──────────────────────────────────────────────────────────────────────────────
# Time Features Tests
# ──────────────────────────────────────────────────────────────────────────────

class TestTimeFeatures:
    """Test temporal feature extraction."""
    
    def test_business_hours(self):
        """10 AM on Wednesday should be business hours."""
        features = compute_time_features("2026-04-22T10:30:00+03:00")
        assert features["is_business_hours"] == 1.0
        assert features["is_night"] == 0.0
        assert features["is_weekend"] == 0.0
    
    def test_night_hours(self):
        """3 AM should be nighttime."""
        features = compute_time_features("2026-04-22T03:00:00+03:00")
        assert features["is_night"] == 1.0
        assert features["is_business_hours"] == 0.0
    
    def test_weekend(self):
        """Saturday should be weekend."""
        # April 25, 2026 is a Saturday
        features = compute_time_features("2026-04-25T10:00:00+03:00")
        assert features["is_weekend"] == 1.0
    
    def test_future_date(self):
        """Future date should be flagged."""
        features = compute_time_features("2030-01-01T12:00:00+03:00")
        assert features["is_future"] == 1.0
    
    def test_cyclic_encoding(self):
        """Hour cyclic encoding should produce valid sin/cos values."""
        features = compute_time_features("2026-04-22T00:00:00+03:00")
        # At hour 0: sin(0) = 0, cos(0) = 1
        assert abs(features["hour_sin"]) < 0.01
        assert abs(features["hour_cos"] - 1.0) < 0.01
    
    def test_invalid_timestamp(self):
        """Invalid timestamp should return defaults."""
        features = compute_time_features("not_a_date")
        assert features["hour"] == 12.0  # Default
        assert features["is_business_hours"] == 1.0


# ──────────────────────────────────────────────────────────────────────────────
# Amount Features Tests
# ──────────────────────────────────────────────────────────────────────────────

class TestAmountFeatures:
    """Test amount feature extraction."""
    
    def test_round_number(self):
        """Round hundred should be flagged."""
        features = compute_amount_features(5000.0, "cbe")
        assert features["is_round_number"] == 1.0
        assert features["is_round_10"] == 1.0
    
    def test_non_round_number(self):
        """Non-round amount should not be flagged."""
        features = compute_amount_features(5123.45, "cbe")
        assert features["is_round_number"] == 0.0
    
    def test_log_transform(self):
        """Log transform should handle positive amounts correctly."""
        features = compute_amount_features(1000.0, "cbe")
        assert features["log_amount"] > 0
        expected = math.log1p(1000.0)
        assert abs(features["log_amount"] - expected) < 0.001
    
    def test_zero_amount(self):
        """Zero amount should not crash."""
        features = compute_amount_features(0.0, "cbe")
        assert features["log_amount"] == 0.0
    
    def test_z_score_with_stats(self):
        """Z-score should work with bank statistics."""
        stats = {"cbe": {"mean": 5000.0, "std": 1000.0}}
        features = compute_amount_features(7000.0, "cbe", stats)
        assert abs(features["z_score_amount"] - 2.0) < 0.01


# ──────────────────────────────────────────────────────────────────────────────
# Name Features Tests
# ──────────────────────────────────────────────────────────────────────────────

class TestNameFeatures:
    """Test identity-based feature extraction."""
    
    def test_identical_names(self):
        """Self-transfer (same payer and receiver) should be flagged."""
        features = compute_name_features("Abebe Kebede", "Abebe Kebede")
        assert features["names_identical"] == 1.0
        assert features["name_similarity"] == 1.0
    
    def test_different_names(self):
        """Different names should not be flagged as identical."""
        features = compute_name_features("Abebe Kebede", "Tigist Haile")
        assert features["names_identical"] == 0.0
        assert features["name_similarity"] < 1.0
    
    def test_empty_names(self):
        """Empty names should not crash."""
        features = compute_name_features("", "")
        assert features["payer_name_length"] == 0.0
        assert features["names_identical"] == 0.0
    
    def test_word_count(self):
        """Word count should match number of space-separated words."""
        features = compute_name_features("Abebe Bekele Tadesse", "Tigist Haile")
        assert features["payer_word_count"] == 3.0
        assert features["receiver_word_count"] == 2.0


# ──────────────────────────────────────────────────────────────────────────────
# Frequency Tracker Tests
# ──────────────────────────────────────────────────────────────────────────────

class TestFrequencyTracker:
    """Test reference frequency tracking."""
    
    def test_unique_references(self):
        """Unique references should have count of 1."""
        import pandas as pd
        tracker = ReferenceFrequencyTracker()
        df = pd.DataFrame({
            "reference": ["REF001", "REF002", "REF003"],
            "payer_name": ["Alice", "Bob", "Charlie"],
        })
        tracker.build_from_dataset(df)
        
        features = tracker.get_frequency_features("REF001", "Alice")
        assert features["reference_count"] == 1.0
        assert features["is_duplicate"] == 0.0
    
    def test_duplicate_references(self):
        """Duplicate references should be detected."""
        import pandas as pd
        tracker = ReferenceFrequencyTracker()
        df = pd.DataFrame({
            "reference": ["REF001", "REF001", "REF002"],
            "payer_name": ["Alice", "Bob", "Charlie"],
        })
        tracker.build_from_dataset(df)
        
        features = tracker.get_frequency_features("REF001", "Alice")
        assert features["reference_count"] == 2.0
        assert features["is_duplicate"] == 1.0
    
    def test_unknown_reference(self):
        """Unknown reference should have count of 0."""
        import pandas as pd
        tracker = ReferenceFrequencyTracker()
        df = pd.DataFrame({
            "reference": ["REF001"],
            "payer_name": ["Alice"],
        })
        tracker.build_from_dataset(df)
        
        features = tracker.get_frequency_features("UNKNOWN", "Alice")
        assert features["reference_count"] == 0.0


# ──────────────────────────────────────────────────────────────────────────────
# Bank Encoding Tests
# ──────────────────────────────────────────────────────────────────────────────

class TestBankEncoding:
    """Test one-hot bank encoding."""
    
    def test_cbe_encoding(self):
        """CBE should produce correct one-hot vector."""
        features = encode_bank("cbe")
        assert features["bank_cbe"] == 1.0
        assert features["bank_telebirr"] == 0.0
        assert features["bank_dashen"] == 0.0
    
    def test_unknown_bank(self):
        """Unknown bank should produce all zeros."""
        features = encode_bank("unknown")
        assert all(v == 0.0 for v in features.values())


# ──────────────────────────────────────────────────────────────────────────────
# Feature Vector Builder Tests
# ──────────────────────────────────────────────────────────────────────────────

class TestFeatureVector:
    """Test complete feature vector building."""
    
    def test_vector_shape(self):
        """Feature vector should have correct number of features."""
        tx = {
            "reference": "FT2513001V2G",
            "bank": "cbe",
            "amount": 5000.0,
            "transaction_date": "2026-04-22T10:30:00+03:00",
            "payer_name": "Abebe Kebede",
            "receiver_name": "Tigist Haile",
        }
        vec = build_feature_vector(tx)
        assert len(vec) == NUM_FEATURES
    
    def test_no_nan_values(self):
        """Feature vector should not contain NaN values."""
        tx = {
            "reference": "FT2513001V2G",
            "bank": "cbe",
            "amount": 5000.0,
            "transaction_date": "2026-04-22T10:30:00+03:00",
            "payer_name": "Abebe Kebede",
            "receiver_name": "Tigist Haile",
        }
        vec = build_feature_vector(tx)
        assert not np.any(np.isnan(vec))
    
    def test_feature_names_length(self):
        """Feature names list should match NUM_FEATURES."""
        assert len(FEATURE_NAMES) == NUM_FEATURES
    
    def test_minimal_transaction(self):
        """Minimal transaction (just required fields) should not crash."""
        tx = {
            "reference": "ABC",
            "bank": "cbe",
            "amount": 100.0,
        }
        vec = build_feature_vector(tx)
        assert len(vec) == NUM_FEATURES
        assert not np.any(np.isnan(vec))


# ──────────────────────────────────────────────────────────────────────────────
# Special Char Ratio Tests
# ──────────────────────────────────────────────────────────────────────────────

class TestSpecialCharRatio:
    """Test special character ratio computation."""
    
    def test_clean_reference(self):
        """Alphanumeric reference should have zero special chars."""
        assert compute_special_char_ratio("FT2513001V2G") == 0.0
    
    def test_dirty_reference(self):
        """Reference with special chars should have non-zero ratio."""
        ratio = compute_special_char_ratio("FT25!@#01V2G")
        assert ratio > 0.0
    
    def test_empty_reference(self):
        """Empty reference should return 0.0."""
        assert compute_special_char_ratio("") == 0.0


# ──────────────────────────────────────────────────────────────────────────────
# Character N-Gram Anomaly Tests
# ──────────────────────────────────────────────────────────────────────────────

class TestCharNgramAnomaly:
    """Test OCR-like substitution anomaly scoring."""

    def test_fuzzed_reference_scores_higher(self):
        """OCR-style substitutions should score higher than a clean reference."""
        clean = build_feature_dict({
            "reference": "FT2513001V2G",
            "bank": "cbe",
            "amount": 5000.0,
            "transaction_date": "2026-04-22T10:30:00+03:00",
            "payer_name": "Abebe Kebede",
            "receiver_name": "Tigist Haile",
        })["char_ngram_anomaly"]

        fuzzed = build_feature_dict({
            "reference": "FT2513OO1V2G",
            "bank": "cbe",
            "amount": 5000.0,
            "transaction_date": "2026-04-22T10:30:00+03:00",
            "payer_name": "Abebe Kebede",
            "receiver_name": "Tigist Haile",
        })["char_ngram_anomaly"]

        assert fuzzed > clean


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
