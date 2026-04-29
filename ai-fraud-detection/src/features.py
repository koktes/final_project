"""
Feature Engineering Pipeline

Transforms raw transaction records into numerical feature vectors suitable for
the Isolation Forest anomaly detection model. Each feature is designed to capture
a specific class of fraud signal.

Feature Categories:
    1. Reference Analysis — Shannon entropy, structural integrity
    2. Temporal Analysis — hour-of-day, day-of-week, business hours
    3. Amount Analysis — log-transform, z-score, round-number detection
    4. Identity Analysis — name length, character composition
    5. Frequency Analysis — reference reuse detection

This module is a core thesis deliverable — the quality of features directly
determines model performance.
"""

import math
import re
import string
import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple
from collections import Counter
from datetime import datetime


# ──────────────────────────────────────────────────────────────────────────────
# Bank Reference Patterns (mirroring the TypeScript routing logic)
# ──────────────────────────────────────────────────────────────────────────────

BANK_REFERENCE_PATTERNS = {
    "cbe": {
        "regex": r"^FT[A-Z0-9]{10}$",
        "prefix": "FT",
        "expected_length": 12,
        "charset": set(string.ascii_uppercase + string.digits),
    },
    "telebirr": {
        "regex": r"^CE[A-Z0-9]{8}$",
        "prefix": "CE",
        "expected_length": 10,
        "charset": set(string.ascii_uppercase + string.digits),
    },
    "dashen": {
        "regex": r"^\d{3}[A-Z0-9]{13}$",
        "prefix": None,
        "expected_length": 16,
        "charset": set(string.ascii_uppercase + string.digits),
    },
    "abyssinia": {
        "regex": r"^FT[A-Z0-9]{10}$",
        "prefix": "FT",
        "expected_length": 12,
        "charset": set(string.ascii_uppercase + string.digits),
    },
    "cbe_birr": {
        "regex": r"^[A-Z0-9]{10}$",
        "prefix": None,
        "expected_length": 10,
        "charset": set(string.ascii_uppercase + string.digits),
    },
    "mpesa": {
        "regex": r"^[A-Z0-9]{10}$",
        "prefix": None,
        "expected_length": 10,
        "charset": set(string.ascii_uppercase + string.digits),
    },
}


# ──────────────────────────────────────────────────────────────────────────────
# 1. Reference Analysis Features
# ──────────────────────────────────────────────────────────────────────────────

def compute_shannon_entropy(text: str) -> float:
    """
    Compute Shannon entropy of a string.
    
    Shannon entropy measures the information density / randomness of a string.
    Legitimate transaction references have predictable entropy ranges per bank.
    Manipulated references (fuzzing attacks) tend to have different entropy.
    
    H(X) = -Σ p(x) * log2(p(x))
    
    Args:
        text: The string to compute entropy for.
        
    Returns:
        Shannon entropy in bits. Higher = more random.
    """
    if not text:
        return 0.0
    
    # Count character frequencies
    freq = Counter(text)
    length = len(text)
    
    entropy = 0.0
    for count in freq.values():
        p = count / length
        if p > 0:
            entropy -= p * math.log2(p)
    
    return round(entropy, 6)


def compute_structural_integrity(reference: str, bank: str) -> float:
    """
    Compute how well a reference matches its expected bank format.
    
    Returns a score between 0.0 (completely wrong) and 1.0 (perfect match).
    The score is composed of multiple sub-checks:
        - Prefix match (correct starting characters)
        - Length match (correct total length)
        - Character set match (no invalid characters)
        - Regex full match
    
    This directly mirrors the routing logic in verifyUniversalRoute.ts.
    """
    if bank not in BANK_REFERENCE_PATTERNS:
        return 0.0
    
    pattern = BANK_REFERENCE_PATTERNS[bank]
    score = 0.0
    checks = 0
    
    # Check 1: Regex full match (most important)
    if re.match(pattern["regex"], reference):
        score += 0.4
    checks += 0.4
    
    # Check 2: Prefix match
    if pattern["prefix"]:
        if reference.startswith(pattern["prefix"]):
            score += 0.2
    else:
        # No prefix requirement — check first 3 chars for Dashen (digits)
        if bank == "dashen":
            if reference[:3].isdigit():
                score += 0.2
        else:
            score += 0.2  # No prefix to check
    checks += 0.2
    
    # Check 3: Length match
    expected_len = pattern["expected_length"]
    actual_len = len(reference)
    if actual_len == expected_len:
        score += 0.2
    elif abs(actual_len - expected_len) <= 2:
        score += 0.1  # Close but not exact
    checks += 0.2
    
    # Check 4: Character set validity
    valid_chars = pattern["charset"]
    if reference:
        valid_ratio = sum(1 for c in reference if c in valid_chars) / len(reference)
        score += 0.2 * valid_ratio
    checks += 0.2
    
    return round(score / checks if checks > 0 else 0.0, 6) if checks > 0 else 0.0


def compute_reference_length_deviation(reference: str, bank: str) -> float:
    """
    Compute how much the reference length deviates from the expected length.
    
    Returns the absolute difference normalized by expected length.
    """
    if bank not in BANK_REFERENCE_PATTERNS:
        return 1.0
    
    expected_len = BANK_REFERENCE_PATTERNS[bank]["expected_length"]
    actual_len = len(reference)
    
    return abs(actual_len - expected_len) / expected_len


def compute_special_char_ratio(reference: str) -> float:
    """Ratio of non-alphanumeric characters in the reference."""
    if not reference:
        return 0.0
    
    special_count = sum(1 for c in reference if c not in string.ascii_letters + string.digits)
    return special_count / len(reference)


# ──────────────────────────────────────────────────────────────────────────────
# 2. Temporal Analysis Features
# ──────────────────────────────────────────────────────────────────────────────

def compute_time_features(timestamp_str: str) -> Dict[str, float]:
    """
    Extract temporal features from a transaction timestamp.
    
    Features:
        - hour: Hour of day (0-23)
        - day_of_week: Day of week (0=Monday, 6=Sunday)
        - is_business_hours: 1.0 if within 8AM-6PM, else 0.0
        - is_weekend: 1.0 if Saturday or Sunday, else 0.0
        - is_night: 1.0 if between 11PM-5AM, else 0.0
        - month: Month of year (1-12)
        - hour_sin: Sine transform of hour (cyclic encoding)
        - hour_cos: Cosine transform of hour (cyclic encoding)
        - dow_sin: Sine transform of day-of-week (cyclic encoding)
        - dow_cos: Cosine transform of day-of-week (cyclic encoding)
        - is_future: 1.0 if timestamp is in the future
        - days_from_now: Absolute days difference from current date
    """
    try:
        # Handle timezone offset in format +03:00
        ts = timestamp_str.replace("+03:00", "+0300").replace("+00:00", "+0000")
        # Try ISO format first
        try:
            dt = datetime.fromisoformat(timestamp_str.replace("+03:00", ""))
        except ValueError:
            dt = datetime.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S")
    except (ValueError, TypeError):
        # Return default features for unparseable timestamps
        return {
            "hour": 12.0, "day_of_week": 2.0,
            "is_business_hours": 1.0, "is_weekend": 0.0,
            "is_night": 0.0, "month": 6.0,
            "hour_sin": 0.0, "hour_cos": -1.0,
            "dow_sin": 0.78, "dow_cos": -0.22,
            "is_future": 0.0, "days_from_now": 0.0,
        }
    
    hour = dt.hour
    dow = dt.weekday()
    month = dt.month
    
    # Cyclic encoding: maps periodic features to sine/cosine
    # This ensures hour 23 is close to hour 0 (not 23 apart)
    hour_sin = math.sin(2 * math.pi * hour / 24)
    hour_cos = math.cos(2 * math.pi * hour / 24)
    dow_sin = math.sin(2 * math.pi * dow / 7)
    dow_cos = math.cos(2 * math.pi * dow / 7)
    
    is_business = 1.0 if 8 <= hour <= 17 else 0.0
    is_weekend = 1.0 if dow >= 5 else 0.0
    is_night = 1.0 if hour <= 5 or hour >= 23 else 0.0
    
    # Future detection
    now = datetime.now()
    is_future = 1.0 if dt > now else 0.0
    days_from_now = abs((dt - now).days)
    
    return {
        "hour": float(hour),
        "day_of_week": float(dow),
        "is_business_hours": is_business,
        "is_weekend": is_weekend,
        "is_night": is_night,
        "month": float(month),
        "hour_sin": round(hour_sin, 6),
        "hour_cos": round(hour_cos, 6),
        "dow_sin": round(dow_sin, 6),
        "dow_cos": round(dow_cos, 6),
        "is_future": is_future,
        "days_from_now": float(min(days_from_now, 3650)),  # Cap at 10 years
    }


# ──────────────────────────────────────────────────────────────────────────────
# 3. Amount Analysis Features
# ──────────────────────────────────────────────────────────────────────────────

def compute_amount_features(amount: float, bank: str,
                             bank_stats: Optional[Dict[str, Dict]] = None) -> Dict[str, float]:
    """
    Extract amount-based features from a transaction.
    
    Features:
        - log_amount: Log-transformed amount (handles right-skewed distribution)
        - is_round_number: 1.0 if amount is a round number (divisible by 100)
        - is_round_10: 1.0 if amount is divisible by 10
        - amount_magnitude: Order of magnitude (log10)
        - decimal_part: Fractional part of amount (0.00 for round numbers)
        - z_score: Bank-specific z-score (if bank_stats provided)
    """
    log_amount = math.log1p(max(0, amount))  # log(1 + amount), handles 0
    
    is_round = 1.0 if amount > 0 and amount % 100 == 0 else 0.0
    is_round_10 = 1.0 if amount > 0 and amount % 10 == 0 else 0.0
    
    magnitude = math.log10(max(1, amount))
    decimal_part = amount - int(amount)
    
    # Bank-specific z-score
    z_score = 0.0
    if bank_stats and bank in bank_stats:
        stats = bank_stats[bank]
        if stats["std"] > 0:
            z_score = (amount - stats["mean"]) / stats["std"]
    
    return {
        "log_amount": round(log_amount, 6),
        "is_round_number": is_round,
        "is_round_10": is_round_10,
        "amount_magnitude": round(magnitude, 6),
        "decimal_part": round(decimal_part, 4),
        "z_score_amount": round(z_score, 6),
    }


def compute_bank_amount_stats(df: pd.DataFrame) -> Dict[str, Dict]:
    """
    Compute per-bank amount statistics from clean training data.
    
    These statistics are used to compute z-scores for individual transactions.
    """
    stats = {}
    for bank in df["bank"].unique():
        bank_amounts = df[df["bank"] == bank]["amount"]
        stats[bank] = {
            "mean": bank_amounts.mean(),
            "std": bank_amounts.std() if len(bank_amounts) > 1 else 1.0,
            "median": bank_amounts.median(),
            "min": bank_amounts.min(),
            "max": bank_amounts.max(),
        }
    return stats


# ──────────────────────────────────────────────────────────────────────────────
# 4. Identity Analysis Features
# ──────────────────────────────────────────────────────────────────────────────

def compute_name_features(payer_name: str, receiver_name: str) -> Dict[str, float]:
    """
    Extract identity-based features from payer and receiver names.
    
    Features:
        - payer_name_length: Length of payer name
        - receiver_name_length: Length of receiver name
        - names_identical: 1.0 if payer == receiver (self-transfer, potentially suspicious)
        - name_similarity: Jaccard similarity between name character sets
        - payer_word_count: Number of words in payer name
        - receiver_word_count: Number of words in receiver name
    """
    payer_len = len(payer_name) if payer_name else 0
    receiver_len = len(receiver_name) if receiver_name else 0
    
    # Are names identical? (potential self-transfer fraud)
    names_identical = 1.0 if payer_name and receiver_name and payer_name.lower() == receiver_name.lower() else 0.0
    
    # Character-level Jaccard similarity
    if payer_name and receiver_name:
        payer_chars = set(payer_name.lower())
        receiver_chars = set(receiver_name.lower())
        intersection = len(payer_chars & receiver_chars)
        union = len(payer_chars | receiver_chars)
        similarity = intersection / union if union > 0 else 0.0
    else:
        similarity = 0.0
    
    payer_words = len(payer_name.split()) if payer_name else 0
    receiver_words = len(receiver_name.split()) if receiver_name else 0
    
    return {
        "payer_name_length": float(payer_len),
        "receiver_name_length": float(receiver_len),
        "names_identical": names_identical,
        "name_similarity": round(similarity, 6),
        "payer_word_count": float(payer_words),
        "receiver_word_count": float(receiver_words),
    }


# ──────────────────────────────────────────────────────────────────────────────
# 5. Frequency Analysis Features
# ──────────────────────────────────────────────────────────────────────────────

class ReferenceFrequencyTracker:
    """
    Tracks reference number frequencies for replay attack detection.
    
    Maintains a history of seen references and counts occurrences.
    In production, this would be backed by a database or Redis.
    For training, we compute frequencies from the full dataset.
    """
    
    def __init__(self):
        self.reference_counts: Counter = Counter()
        self.payer_reference_counts: Counter = Counter()
    
    def build_from_dataset(self, df: pd.DataFrame) -> None:
        """Build frequency maps from a dataset."""
        self.reference_counts = Counter(df["reference"].values)
        # Track payer + reference combos
        self.payer_reference_counts = Counter(
            zip(df["reference"].values, df["payer_name"].values)
        )
    
    def get_frequency_features(self, reference: str, 
                                payer_name: str = "") -> Dict[str, float]:
        """
        Get frequency-based features for a transaction.
        
        Features:
            - reference_count: Number of times this reference appears in history
            - is_duplicate: 1.0 if reference appears more than once
            - payer_reference_count: Times this payer used this reference
        """
        ref_count = self.reference_counts.get(reference, 0)
        payer_ref_count = self.payer_reference_counts.get((reference, payer_name), 0)
        
        return {
            "reference_count": float(ref_count),
            "is_duplicate": 1.0 if ref_count > 1 else 0.0,
            "payer_reference_count": float(payer_ref_count),
        }


# ──────────────────────────────────────────────────────────────────────────────
# 6. Bank Encoding
# ──────────────────────────────────────────────────────────────────────────────

BANK_ENCODING = {
    "cbe": 0, "telebirr": 1, "dashen": 2,
    "abyssinia": 3, "cbe_birr": 4, "mpesa": 5,
}

def encode_bank(bank: str) -> Dict[str, float]:
    """
    One-hot encode the bank identifier.
    
    One-hot encoding is used instead of ordinal encoding because there is
    no ordinal relationship between banks.
    """
    features = {}
    for bank_name in BANK_ENCODING:
        features[f"bank_{bank_name}"] = 1.0 if bank == bank_name else 0.0
    return features


# ──────────────────────────────────────────────────────────────────────────────
# Complete Feature Vector Builder
# ──────────────────────────────────────────────────────────────────────────────

# Ordered list of all feature names (determines vector order)
FEATURE_NAMES = [
    # Reference features
    "shannon_entropy", "structural_integrity", "ref_length_deviation",
    "special_char_ratio", "char_ngram_anomaly",
    # Time features
    "hour", "day_of_week", "is_business_hours", "is_weekend", "is_night",
    "month", "hour_sin", "hour_cos", "dow_sin", "dow_cos",
    "is_future", "days_from_now",
    # Amount features
    "log_amount", "is_round_number", "is_round_10",
    "amount_magnitude", "decimal_part", "z_score_amount",
    # Name features
    "payer_name_length", "receiver_name_length", "names_identical",
    "name_similarity", "payer_word_count", "receiver_word_count",
    # Frequency features
    "reference_count", "is_duplicate", "payer_reference_count",
    # Bank encoding (one-hot)
    "bank_cbe", "bank_telebirr", "bank_dashen",
    "bank_abyssinia", "bank_cbe_birr", "bank_mpesa",
]

NUM_FEATURES = len(FEATURE_NAMES)


def build_feature_dict(transaction: Dict,
                        bank_stats: Optional[Dict] = None,
                        freq_tracker: Optional[ReferenceFrequencyTracker] = None) -> Dict[str, float]:
    """
    Build a complete feature dictionary from a transaction record.
    
    Args:
        transaction: Dict with transaction fields (from CSV row or API request)
        bank_stats: Pre-computed bank amount statistics (for z-scores)
        freq_tracker: Reference frequency tracker (for duplicate detection)
    
    Returns:
        Dictionary mapping feature name → feature value
    """
    reference = str(transaction.get("reference", ""))
    bank = str(transaction.get("bank", ""))
    amount = float(transaction.get("amount", 0))
    timestamp = str(transaction.get("transaction_date", ""))
    payer_name = str(transaction.get("payer_name", ""))
    receiver_name = str(transaction.get("receiver_name", ""))
    
    features = {}
    
    # 1. Reference features
    features["shannon_entropy"] = compute_shannon_entropy(reference)
    features["structural_integrity"] = compute_structural_integrity(reference, bank)
    features["ref_length_deviation"] = compute_reference_length_deviation(reference, bank)
    features["special_char_ratio"] = compute_special_char_ratio(reference)
    features["char_ngram_anomaly"] = compute_char_ngram_anomaly(reference, bank)
    
    # 2. Time features
    features.update(compute_time_features(timestamp))
    
    # 3. Amount features
    features.update(compute_amount_features(amount, bank, bank_stats))
    
    # 4. Name features
    features.update(compute_name_features(payer_name, receiver_name))
    
    # 5. Frequency features
    if freq_tracker:
        features.update(freq_tracker.get_frequency_features(reference, payer_name))
    else:
        features["reference_count"] = 0.0
        features["is_duplicate"] = 0.0
        features["payer_reference_count"] = 0.0
    
    # 6. Bank encoding
    features.update(encode_bank(bank))
    
    return features


def build_feature_vector(transaction: Dict,
                          bank_stats: Optional[Dict] = None,
                          freq_tracker: Optional[ReferenceFrequencyTracker] = None) -> np.ndarray:
    """
    Build a numerical feature vector from a transaction record.
    
    Returns a 1D numpy array with features in the order defined by FEATURE_NAMES.
    """
    features = build_feature_dict(transaction, bank_stats, freq_tracker)
    return np.array([features.get(name, 0.0) for name in FEATURE_NAMES], dtype=np.float64)


def build_feature_matrix(df: pd.DataFrame,
                          bank_stats: Optional[Dict] = None,
                          freq_tracker: Optional[ReferenceFrequencyTracker] = None) -> Tuple[np.ndarray, List[str]]:
    """
    Build feature matrix for an entire dataset.
    
    Args:
        df: DataFrame with transaction records
        bank_stats: Pre-computed bank amount statistics
        freq_tracker: Reference frequency tracker
    
    Returns:
        (X, feature_names): Feature matrix of shape (n_samples, n_features)
                           and list of feature names
    """
    vectors = []
    
    for _, row in df.iterrows():
        tx = row.to_dict()
        vec = build_feature_vector(tx, bank_stats, freq_tracker)
        vectors.append(vec)
    
    X = np.array(vectors)
    return X, FEATURE_NAMES.copy()


def get_feature_importance_names() -> List[str]:
    """Return the ordered list of feature names for interpretation."""
    return FEATURE_NAMES.copy()
