"""
Unit Tests for Synthetic Data Generator

Tests the data generation functions for correctness of output format,
bank-specific patterns, attack injection, and dataset statistics.
"""

import sys
import os
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.data_generator import (
    generate_ethiopian_name,
    generate_phone_number,
    generate_reference,
    generate_account_number,
    generate_amount,
    generate_timestamp,
    generate_clean_transaction,
    generate_clean_transactions,
    generate_contaminated_transactions,
    generate_full_dataset,
    inject_replay_attack,
    inject_fuzzing_attack,
    inject_amount_tamper,
    inject_temporal_anomaly,
    inject_format_violation,
    inject_name_mismatch,
    BANK_CONFIGS,
    Transaction,
)

import random


# ──────────────────────────────────────────────────────────────────────────────
# Name Generation Tests
# ──────────────────────────────────────────────────────────────────────────────

class TestNameGeneration:
    """Test Ethiopian name generation."""
    
    def test_name_format(self):
        """Name should have first and last name."""
        rng = random.Random(42)
        name = generate_ethiopian_name(rng)
        parts = name.split()
        assert len(parts) == 2
    
    def test_name_not_empty(self):
        """Name should not be empty."""
        rng = random.Random(42)
        name = generate_ethiopian_name(rng)
        assert len(name) > 3
    
    def test_deterministic_with_seed(self):
        """Same seed should produce same name."""
        name1 = generate_ethiopian_name(random.Random(42))
        name2 = generate_ethiopian_name(random.Random(42))
        assert name1 == name2


class TestPhoneGeneration:
    """Test Ethiopian phone number generation."""
    
    def test_phone_format(self):
        """Phone should be in 251XXXXXXXXX format."""
        rng = random.Random(42)
        phone = generate_phone_number(rng)
        assert phone.startswith("251")
        assert len(phone) == 12
    
    def test_phone_all_digits(self):
        """Phone should be all digits."""
        rng = random.Random(42)
        phone = generate_phone_number(rng)
        assert phone.isdigit()


# ──────────────────────────────────────────────────────────────────────────────
# Reference Generation Tests
# ──────────────────────────────────────────────────────────────────────────────

class TestReferenceGeneration:
    """Test bank-specific reference generation."""
    
    def test_cbe_reference_format(self):
        """CBE reference should start with FT and be 12 chars."""
        rng = random.Random(42)
        ref = generate_reference("cbe", BANK_CONFIGS["cbe"], rng)
        assert ref.startswith("FT")
        assert len(ref) == 12
    
    def test_telebirr_reference_format(self):
        """Telebirr reference should start with CE and be 10 chars."""
        rng = random.Random(42)
        ref = generate_reference("telebirr", BANK_CONFIGS["telebirr"], rng)
        assert ref.startswith("CE")
        assert len(ref) == 10
    
    def test_dashen_reference_format(self):
        """Dashen reference should start with 3 digits and be 16 chars."""
        rng = random.Random(42)
        ref = generate_reference("dashen", BANK_CONFIGS["dashen"], rng)
        assert ref[:3].isdigit()
        assert len(ref) == 16
    
    def test_cbe_birr_reference_format(self):
        """CBE Birr reference should be 10 alphanumeric chars."""
        rng = random.Random(42)
        ref = generate_reference("cbe_birr", BANK_CONFIGS["cbe_birr"], rng)
        assert len(ref) == 10
        assert ref.isalnum()
    
    def test_reference_uniqueness(self):
        """Generated references should generally be unique."""
        rng = random.Random(42)
        refs = set()
        for _ in range(100):
            ref = generate_reference("cbe", BANK_CONFIGS["cbe"], rng)
            refs.add(ref)
        assert len(refs) >= 95  # At least 95% unique


# ──────────────────────────────────────────────────────────────────────────────
# Amount Generation Tests
# ──────────────────────────────────────────────────────────────────────────────

class TestAmountGeneration:
    """Test transaction amount generation."""
    
    def test_amount_within_range(self):
        """Amounts should be within bank-specific range."""
        rng = random.Random(42)
        config = BANK_CONFIGS["cbe"]
        for _ in range(100):
            amount = generate_amount(config, rng)
            assert config.amount_range[0] <= amount <= config.amount_range[1]
    
    def test_amount_positive(self):
        """Amounts should always be positive."""
        rng = random.Random(42)
        for bank, config in BANK_CONFIGS.items():
            for _ in range(50):
                amount = generate_amount(config, rng)
                assert amount > 0
    
    def test_amount_has_round_numbers(self):
        """Some amounts should be round numbers (design expectation)."""
        rng = random.Random(42)
        config = BANK_CONFIGS["cbe"]
        amounts = [generate_amount(config, rng) for _ in range(200)]
        round_100 = sum(1 for a in amounts if a % 100 == 0)
        assert round_100 > 10  # Should have some round numbers


# ──────────────────────────────────────────────────────────────────────────────
# Timestamp Generation Tests
# ──────────────────────────────────────────────────────────────────────────────

class TestTimestampGeneration:
    """Test timestamp generation."""
    
    def test_timestamp_format(self):
        """Timestamp should be ISO 8601 format."""
        rng = random.Random(42)
        ts = generate_timestamp(rng)
        assert "T" in ts
        assert "+03:00" in ts
    
    def test_business_hours_bias(self):
        """Most timestamps should be during business hours."""
        rng = random.Random(42)
        business = 0
        total = 200
        for _ in range(total):
            ts = generate_timestamp(rng)
            hour = int(ts.split("T")[1].split(":")[0])
            if 8 <= hour <= 17:
                business += 1
        assert business / total > 0.50  # At least 50% business hours


# ──────────────────────────────────────────────────────────────────────────────
# Clean Transaction Tests
# ──────────────────────────────────────────────────────────────────────────────

class TestCleanTransactions:
    """Test clean transaction generation."""
    
    def test_clean_transaction_fields(self):
        """Clean transaction should have all required fields."""
        rng = random.Random(42)
        tx = generate_clean_transaction("cbe", BANK_CONFIGS["cbe"], rng, "TX-000001")
        assert tx.bank == "cbe"
        assert tx.is_fraud == 0
        assert tx.attack_type == "none"
        assert len(tx.reference) > 0
        assert tx.amount > 0
        assert len(tx.payer_name) > 0
        assert len(tx.receiver_name) > 0
    
    def test_batch_generation(self):
        """Batch generation should produce correct count."""
        txs = generate_clean_transactions(100, seed=42)
        assert len(txs) == 100
    
    def test_bank_distribution(self):
        """Banks should be distributed by weight."""
        txs = generate_clean_transactions(1000, seed=42)
        bank_counts = {}
        for tx in txs:
            bank_counts[tx.bank] = bank_counts.get(tx.bank, 0) + 1
        
        # CBE and Telebirr should have the most (weight=3.0)
        assert bank_counts.get("cbe", 0) > bank_counts.get("mpesa", 0)
        assert bank_counts.get("telebirr", 0) > bank_counts.get("mpesa", 0)
    
    def test_deterministic_output(self):
        """Same seed should produce same transactions."""
        txs1 = generate_clean_transactions(10, seed=42)
        txs2 = generate_clean_transactions(10, seed=42)
        for t1, t2 in zip(txs1, txs2):
            assert t1.reference == t2.reference
            assert t1.amount == t2.amount


# ──────────────────────────────────────────────────────────────────────────────
# Attack Injection Tests
# ──────────────────────────────────────────────────────────────────────────────

class TestAttackInjection:
    """Test attack injection functions."""
    
    @pytest.fixture
    def base_transaction(self):
        """Create a base clean transaction for attack injection."""
        rng = random.Random(42)
        return generate_clean_transaction("cbe", BANK_CONFIGS["cbe"], rng, "TX-000001")
    
    def test_replay_attack(self, base_transaction):
        """Replay attack should keep same reference but different details."""
        rng = random.Random(42)
        fraud = inject_replay_attack(base_transaction, rng, "TX-FRAUD-001")
        assert fraud.reference == base_transaction.reference  # Same reference
        assert fraud.is_fraud == 1
        assert fraud.attack_type == "replay"
    
    def test_fuzzing_attack(self, base_transaction):
        """Fuzzing attack should alter reference characters."""
        rng = random.Random(42)
        fraud = inject_fuzzing_attack(base_transaction, rng, "TX-FRAUD-001")
        assert fraud.reference != base_transaction.reference  # Different reference
        assert fraud.is_fraud == 1
        assert fraud.attack_type == "fuzzing"
    
    def test_amount_tamper(self, base_transaction):
        """Amount tampering should change the amount."""
        rng = random.Random(42)
        fraud = inject_amount_tamper(base_transaction, rng, "TX-FRAUD-001")
        assert fraud.amount != base_transaction.amount
        assert fraud.is_fraud == 1
        assert fraud.attack_type == "amount_tamper"
    
    def test_temporal_anomaly(self, base_transaction):
        """Temporal anomaly should create suspicious timestamp."""
        rng = random.Random(42)
        fraud = inject_temporal_anomaly(base_transaction, rng, "TX-FRAUD-001")
        assert fraud.is_fraud == 1
        assert fraud.attack_type == "temporal_anomaly"
    
    def test_format_violation(self):
        """Format violation should break reference format rules."""
        rng = random.Random(42)
        fraud = inject_format_violation("cbe", BANK_CONFIGS["cbe"], rng, "TX-FRAUD-001")
        assert fraud.is_fraud == 1
        assert fraud.attack_type == "format_violation"
    
    def test_name_mismatch(self, base_transaction):
        """Name mismatch should alter payer/receiver names."""
        rng = random.Random(42)
        fraud = inject_name_mismatch(base_transaction, rng, "TX-FRAUD-001")
        assert fraud.is_fraud == 1
        assert fraud.attack_type == "name_mismatch"


# ──────────────────────────────────────────────────────────────────────────────
# Full Dataset Tests
# ──────────────────────────────────────────────────────────────────────────────

class TestFullDataset:
    """Test full dataset generation."""
    
    def test_dataset_size(self):
        """Full dataset should have correct total size."""
        full, clean, contaminated = generate_full_dataset(100, 20, seed=42)
        assert len(clean) == 100
        assert len(contaminated) == 20
        assert len(full) == 120
    
    def test_label_distribution(self):
        """Labels should match clean/contaminated split."""
        full, clean, contaminated = generate_full_dataset(100, 20, seed=42)
        n_fraud = sum(1 for tx in full if tx.is_fraud == 1)
        n_clean = sum(1 for tx in full if tx.is_fraud == 0)
        assert n_clean == 100
        assert n_fraud == 20
    
    def test_attack_type_diversity(self):
        """Contaminated dataset should have multiple attack types."""
        _, _, contaminated = generate_full_dataset(200, 60, seed=42)
        attack_types = set(tx.attack_type for tx in contaminated)
        assert len(attack_types) >= 5  # Should have at least 5 attack types
    
    def test_all_banks_represented(self):
        """All banks should be represented in the dataset."""
        full, _, _ = generate_full_dataset(500, 100, seed=42)
        banks = set(tx.bank for tx in full)
        assert len(banks) >= 5  # Should have at least 5 banks


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
