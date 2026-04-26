"""
Synthetic Transaction Data Generator

Generates realistic payment transaction datasets for training the fraud detection model.
Clean transactions mimic real Ethiopian bank receipt patterns observed in the verification
services (CBE, Telebirr, Dashen, Bank of Abyssinia, CBE Birr, M-Pesa).
Contaminated transactions inject labeled attack vectors for supervised evaluation.

This module is a core thesis deliverable — it produces the training and evaluation data
that drives the entire ML pipeline.
"""

import random
import string
import csv
import os
import math
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, field, asdict

# ──────────────────────────────────────────────────────────────────────────────
# Ethiopian Name Corpus
# ──────────────────────────────────────────────────────────────────────────────

ETHIOPIAN_FIRST_NAMES_MALE = [
    "Abebe", "Kebede", "Tadesse", "Getachew", "Mulugeta", "Dawit", "Solomon",
    "Yohannes", "Tesfaye", "Hailu", "Girma", "Bekele", "Fisseha", "Worku",
    "Assefa", "Dereje", "Mesfin", "Berhanu", "Teshome", "Alemu", "Lemma",
    "Sisay", "Binyam", "Henok", "Yared", "Nahom", "Abel", "Daniel", "Samuel",
    "Mikael", "Eyob", "Ermias", "Biruk", "Natnael", "Robel", "Yoseph",
    "Amanuel", "Bereket", "Fitsum", "Hagos", "Kaleb", "Leul", "Mekonen",
    "Negash", "Omar", "Petros", "Redwan", "Seyoum", "Tekle", "Wondwosen",
]

ETHIOPIAN_FIRST_NAMES_FEMALE = [
    "Tigist", "Hiwot", "Meron", "Selamawit", "Bethlehem", "Rahel", "Sara",
    "Kidist", "Meseret", "Mahlet", "Firehiwot", "Bezawit", "Tsion", "Eden",
    "Liya", "Hanna", "Ruth", "Abigail", "Marta", "Aster", "Birtukan",
    "Chaltu", "Dewi", "Eleni", "Feven", "Genet", "Helen", "Iman", "Jerusalem",
    "Konjit", "Lidya", "Mekdes", "Nardos", "Olana", "Rediet", "Saron",
    "Tirunesh", "Wubit", "Yeshi", "Zewditu", "Betelhem", "Dagmawit",
]

ETHIOPIAN_LAST_NAMES = [
    "Bekele", "Tadesse", "Haile", "Gebremariam", "Wolde", "Mekonnen",
    "Tessema", "Abera", "Desta", "Gebre", "Kebede", "Lemma", "Negash",
    "Tesfaye", "Worku", "Yilma", "Zewde", "Assefa", "Berhane", "Demeke",
    "Eshetu", "Fikre", "Girmay", "Habte", "Ibrahim", "Jembere", "Kiros",
    "Legesse", "Mohammed", "Negussie", "Ahmed", "Omer", "Petros", "Regassa",
    "Seyoum", "Taye", "Umer", "Weldemariam", "Yimer", "Zeleke", "Ayele",
    "Bogale", "Chala", "Diriba", "Endale", "Ferede", "Gudeta", "Hassen",
]

ALL_FIRST_NAMES = ETHIOPIAN_FIRST_NAMES_MALE + ETHIOPIAN_FIRST_NAMES_FEMALE

# ──────────────────────────────────────────────────────────────────────────────
# Bank-Specific Configuration
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class BankConfig:
    """Configuration for generating bank-specific synthetic transactions."""
    name: str
    reference_prefix: str
    reference_length: int  # Total length including prefix
    reference_charset: str  # Characters used after prefix
    account_format: str  # Description of account format
    account_pattern: str  # e.g., "X***DDDD" where D=digit
    amount_range: Tuple[float, float]  # (min, max) in ETB
    amount_mean: float
    amount_std: float
    has_suffix: bool = False
    suffix_length: int = 0
    has_phone: bool = False
    weight: float = 1.0  # Relative frequency in dataset


BANK_CONFIGS = {
    "cbe": BankConfig(
        name="Commercial Bank of Ethiopia",
        reference_prefix="FT",
        reference_length=12,
        reference_charset=string.ascii_uppercase + string.digits,
        account_format="X***DDDD",
        account_pattern="masked_8digit",
        amount_range=(10.0, 500000.0),
        amount_mean=5000.0,
        amount_std=15000.0,
        has_suffix=True,
        suffix_length=8,
        weight=3.0,
    ),
    "telebirr": BankConfig(
        name="Telebirr",
        reference_prefix="CE",
        reference_length=10,
        reference_charset=string.ascii_uppercase + string.digits,
        account_format="251XXXXXXXXX",
        account_pattern="phone_251",
        amount_range=(1.0, 100000.0),
        amount_mean=500.0,
        amount_std=2000.0,
        weight=3.0,
    ),
    "dashen": BankConfig(
        name="Dashen Bank",
        reference_prefix="",  # Starts with 3 digits
        reference_length=16,
        reference_charset=string.ascii_uppercase + string.digits,
        account_format="DDDDDDDDDD",
        account_pattern="10digit",
        amount_range=(10.0, 200000.0),
        amount_mean=3000.0,
        amount_std=8000.0,
        weight=2.0,
    ),
    "abyssinia": BankConfig(
        name="Bank of Abyssinia",
        reference_prefix="FT",
        reference_length=12,
        reference_charset=string.ascii_uppercase + string.digits,
        account_format="DDDDDDDDDDDDD",
        account_pattern="13digit",
        amount_range=(10.0, 300000.0),
        amount_mean=4000.0,
        amount_std=10000.0,
        has_suffix=True,
        suffix_length=5,
        weight=1.5,
    ),
    "cbe_birr": BankConfig(
        name="CBE Birr",
        reference_prefix="",
        reference_length=10,
        reference_charset=string.ascii_uppercase + string.digits,
        account_format="251XXXXXXXXX",
        account_pattern="phone_251",
        amount_range=(1.0, 50000.0),
        amount_mean=300.0,
        amount_std=1000.0,
        has_phone=True,
        weight=1.5,
    ),
    "mpesa": BankConfig(
        name="M-Pesa",
        reference_prefix="",
        reference_length=10,
        reference_charset=string.ascii_uppercase + string.digits,
        account_format="251XXXXXXXXX",
        account_pattern="phone_251",
        amount_range=(1.0, 30000.0),
        amount_mean=200.0,
        amount_std=800.0,
        weight=1.0,
    ),
}

# Transaction statuses per bank
TRANSACTION_STATUSES = {
    "cbe": ["Completed", "Successful"],
    "telebirr": ["Completed", "Success", "Successful"],
    "dashen": ["Completed", "Successful", "Processed"],
    "abyssinia": ["Completed", "Successful"],
    "cbe_birr": ["Completed", "Success"],
    "mpesa": ["Completed", "Successful"],
}

# Payment reasons/descriptions
PAYMENT_REASONS = [
    "Transfer", "Payment for goods", "Salary payment", "Rent payment",
    "Utility bill", "School fee", "Medical payment", "Business transaction",
    "Loan repayment", "Gift", "Savings deposit", "Insurance premium",
    "Mobile top-up", "Online purchase", "Service payment", "Tax payment",
    "Subscription fee", "Donation", "Investment", "Refund",
]


# ──────────────────────────────────────────────────────────────────────────────
# Transaction Data Structure
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class Transaction:
    """Represents a single transaction record for the dataset."""
    transaction_id: str  # Unique dataset identifier
    bank: str
    reference: str
    amount: float
    currency: str
    payer_name: str
    payer_account: str
    receiver_name: str
    receiver_account: str
    transaction_date: str  # ISO 8601
    transaction_status: str
    reason: str
    suffix: str  # Empty if not applicable
    phone_number: str  # Empty if not applicable
    is_fraud: int  # 0 = clean, 1 = fraud
    attack_type: str  # "none" for clean transactions


# ──────────────────────────────────────────────────────────────────────────────
# Name Generation
# ──────────────────────────────────────────────────────────────────────────────

def generate_ethiopian_name(rng: random.Random) -> str:
    """Generate a random Ethiopian full name."""
    first = rng.choice(ALL_FIRST_NAMES)
    last = rng.choice(ETHIOPIAN_LAST_NAMES)
    return f"{first} {last}"


def generate_phone_number(rng: random.Random) -> str:
    """Generate a realistic Ethiopian phone number in 251 format."""
    prefix = rng.choice(["9", "7"])
    suffix_digits = "".join([str(rng.randint(0, 9)) for _ in range(8)])
    return f"251{prefix}{suffix_digits}"


# ──────────────────────────────────────────────────────────────────────────────
# Reference Number Generation (per bank)
# ──────────────────────────────────────────────────────────────────────────────

def generate_reference(bank: str, config: BankConfig, rng: random.Random) -> str:
    """Generate a bank-specific reference number following real patterns."""
    if bank == "dashen":
        # Dashen: 3 digits + 13 alphanumeric chars = 16 total
        prefix = "".join([str(rng.randint(0, 9)) for _ in range(3)])
        body = "".join(rng.choices(config.reference_charset, k=13))
        return prefix + body

    elif bank in ("cbe", "abyssinia"):
        # FT + 10 alphanumeric chars = 12 total
        body_len = config.reference_length - len(config.reference_prefix)
        body = "".join(rng.choices(config.reference_charset, k=body_len))
        return config.reference_prefix + body

    elif bank == "telebirr":
        # CE + 8 alphanumeric chars = 10 total
        body_len = config.reference_length - len(config.reference_prefix)
        body = "".join(rng.choices(config.reference_charset, k=body_len))
        return config.reference_prefix + body

    else:
        # CBE Birr, M-Pesa: 10 alphanumeric chars
        return "".join(rng.choices(config.reference_charset, k=config.reference_length))


def generate_account_number(config: BankConfig, rng: random.Random) -> str:
    """Generate a bank-specific account number."""
    pattern = config.account_pattern

    if pattern == "masked_8digit":
        # CBE-style: X***DDDD where X is a letter
        letter = rng.choice(string.ascii_uppercase)
        digits = "".join([str(rng.randint(0, 9)) for _ in range(4)])
        return f"{letter}***{digits}"

    elif pattern == "phone_251":
        return generate_phone_number(rng)

    elif pattern == "10digit":
        return "".join([str(rng.randint(0, 9)) for _ in range(10)])

    elif pattern == "13digit":
        return "".join([str(rng.randint(0, 9)) for _ in range(13)])

    else:
        return "".join([str(rng.randint(0, 9)) for _ in range(10)])


def generate_suffix(config: BankConfig, rng: random.Random) -> str:
    """Generate a bank-specific suffix (if applicable)."""
    if not config.has_suffix:
        return ""
    return "".join([str(rng.randint(0, 9)) for _ in range(config.suffix_length)])


# ──────────────────────────────────────────────────────────────────────────────
# Amount Generation
# ──────────────────────────────────────────────────────────────────────────────

def generate_amount(config: BankConfig, rng: random.Random) -> float:
    """
    Generate a realistic transaction amount using a log-normal distribution.
    
    Real transaction amounts follow a right-skewed distribution:
    many small transactions, fewer large ones. Log-normal captures this well.
    """
    # Use log-normal for realistic right-skewed distribution
    log_mean = math.log(config.amount_mean)
    log_std = 1.2  # Controls the spread

    amount = rng.lognormvariate(log_mean, log_std)

    # Clamp to bank-specific range
    amount = max(config.amount_range[0], min(amount, config.amount_range[1]))

    # Round to 2 decimal places
    amount = round(amount, 2)

    # 30% chance of round number (common in real transactions)
    if rng.random() < 0.30:
        if amount >= 100:
            amount = round(amount / 100) * 100
        elif amount >= 10:
            amount = round(amount / 10) * 10
        else:
            amount = round(amount)
        amount = float(max(config.amount_range[0], amount))

    return amount


# ──────────────────────────────────────────────────────────────────────────────
# Timestamp Generation
# ──────────────────────────────────────────────────────────────────────────────

def generate_timestamp(rng: random.Random, 
                       start_date: datetime = None,
                       end_date: datetime = None) -> str:
    """
    Generate a realistic transaction timestamp with business-hours bias.
    
    Most real transactions happen during business hours (8 AM - 6 PM),
    with lower frequency on weekends.
    """
    if start_date is None:
        start_date = datetime(2025, 1, 1)
    if end_date is None:
        end_date = datetime(2026, 4, 22)

    # Random date within range
    delta = (end_date - start_date).total_seconds()
    random_seconds = rng.uniform(0, delta)
    dt = start_date + timedelta(seconds=random_seconds)

    # Business hours bias: 70% chance of business hours
    if rng.random() < 0.70:
        hour = rng.randint(8, 17)
        dt = dt.replace(hour=hour)
    else:
        hour = rng.randint(0, 23)
        dt = dt.replace(hour=hour)

    # Set random minutes and seconds
    dt = dt.replace(minute=rng.randint(0, 59), second=rng.randint(0, 59))

    # Weekend reduction: 80% of transactions are weekdays
    if dt.weekday() >= 5 and rng.random() < 0.60:
        # Push to a weekday
        days_to_monday = (7 - dt.weekday()) % 7
        if days_to_monday == 0:
            days_to_monday = 1
        dt = dt + timedelta(days=days_to_monday)

    return dt.strftime("%Y-%m-%dT%H:%M:%S+03:00")  # East Africa Time


# ──────────────────────────────────────────────────────────────────────────────
# Clean Transaction Generation
# ──────────────────────────────────────────────────────────────────────────────

def generate_clean_transaction(bank: str, config: BankConfig, 
                                rng: random.Random,
                                transaction_id: str) -> Transaction:
    """Generate a single clean (legitimate) transaction."""
    reference = generate_reference(bank, config, rng)
    
    return Transaction(
        transaction_id=transaction_id,
        bank=bank,
        reference=reference,
        amount=generate_amount(config, rng),
        currency="ETB",
        payer_name=generate_ethiopian_name(rng),
        payer_account=generate_account_number(config, rng),
        receiver_name=generate_ethiopian_name(rng),
        receiver_account=generate_account_number(config, rng),
        transaction_date=generate_timestamp(rng),
        transaction_status=rng.choice(TRANSACTION_STATUSES[bank]),
        reason=rng.choice(PAYMENT_REASONS),
        suffix=generate_suffix(config, rng),
        phone_number=generate_phone_number(rng) if config.has_phone else "",
        is_fraud=0,
        attack_type="none",
    )


def generate_clean_transactions(n: int, seed: int = 42) -> List[Transaction]:
    """
    Generate n clean transactions distributed across banks.
    
    Distribution is weighted by BankConfig.weight to reflect real-world usage
    (CBE and Telebirr are most popular in Ethiopia).
    """
    rng = random.Random(seed)
    transactions = []

    # Calculate bank distribution
    total_weight = sum(config.weight for config in BANK_CONFIGS.values())
    bank_counts = {}
    remaining = n

    banks = list(BANK_CONFIGS.keys())
    for i, bank in enumerate(banks):
        config = BANK_CONFIGS[bank]
        if i == len(banks) - 1:
            count = remaining  # Last bank gets the remainder
        else:
            count = round(n * config.weight / total_weight)
            remaining -= count
        bank_counts[bank] = count

    # Generate transactions per bank
    tx_counter = 0
    for bank, count in bank_counts.items():
        config = BANK_CONFIGS[bank]
        for _ in range(count):
            tx_id = f"TX-{tx_counter:06d}"
            tx = generate_clean_transaction(bank, config, rng, tx_id)
            transactions.append(tx)
            tx_counter += 1

    # Shuffle to mix banks together
    rng.shuffle(transactions)

    return transactions


# ──────────────────────────────────────────────────────────────────────────────
# Attack Injection Functions
# ──────────────────────────────────────────────────────────────────────────────

# OCR-like character substitutions (same as in verifyImage.ts)
CHAR_SUBSTITUTIONS = {
    "0": ["O"],
    "O": ["0"],
    "1": ["I", "L"],
    "I": ["1"],
    "L": ["1"],
    "5": ["S"],
    "S": ["5"],
    "8": ["B"],
    "B": ["8"],
    "2": ["Z"],
    "Z": ["2"],
    "6": ["G"],
    "G": ["6"],
}


def inject_replay_attack(base_tx: Transaction, rng: random.Random,
                          tx_id: str) -> Transaction:
    """
    Replay Attack: Duplicate an existing reference number with different details.
    
    In a real attack, a fraudster reuses a legitimate transaction reference
    to claim a payment was made when it wasn't (or was for a different amount/recipient).
    """
    # Copy the reference but change other fields
    return Transaction(
        transaction_id=tx_id,
        bank=base_tx.bank,
        reference=base_tx.reference,  # SAME reference — this is the attack
        amount=base_tx.amount * rng.uniform(0.5, 2.0),  # Different amount
        currency="ETB",
        payer_name=generate_ethiopian_name(rng),  # Different payer
        payer_account=generate_account_number(BANK_CONFIGS[base_tx.bank], rng),
        receiver_name=base_tx.receiver_name,  # Same receiver (trying to claim payment)
        receiver_account=base_tx.receiver_account,
        transaction_date=generate_timestamp(rng),  # Different time
        transaction_status=rng.choice(TRANSACTION_STATUSES[base_tx.bank]),
        reason=base_tx.reason,
        suffix=base_tx.suffix,
        phone_number=base_tx.phone_number,
        is_fraud=1,
        attack_type="replay",
    )


def inject_fuzzing_attack(base_tx: Transaction, rng: random.Random,
                           tx_id: str) -> Transaction:
    """
    Fuzzing Attack: Alter characters in the reference to create a near-match.
    
    Mimics OCR errors or deliberate character swaps (0→O, 1→I, S→5, etc.)
    to create references that look similar to legitimate ones but don't match.
    """
    ref_chars = list(base_tx.reference.upper())
    n_changes = rng.randint(1, 3)  # 1-3 character changes
    
    changed_positions = set()
    attempts = 0
    while len(changed_positions) < n_changes and attempts < 20:
        pos = rng.randint(0, len(ref_chars) - 1)
        char = ref_chars[pos]
        if char in CHAR_SUBSTITUTIONS and pos not in changed_positions:
            ref_chars[pos] = rng.choice(CHAR_SUBSTITUTIONS[char])
            changed_positions.add(pos)
        attempts += 1

    # If no substitutions were possible, randomly alter a character
    if len(changed_positions) == 0:
        pos = rng.randint(2, len(ref_chars) - 1)  # Skip prefix
        ref_chars[pos] = rng.choice(string.ascii_uppercase + string.digits)

    fuzzed_ref = "".join(ref_chars)

    return Transaction(
        transaction_id=tx_id,
        bank=base_tx.bank,
        reference=fuzzed_ref,
        amount=base_tx.amount,
        currency="ETB",
        payer_name=base_tx.payer_name,
        payer_account=base_tx.payer_account,
        receiver_name=base_tx.receiver_name,
        receiver_account=base_tx.receiver_account,
        transaction_date=base_tx.transaction_date,
        transaction_status=base_tx.transaction_status,
        reason=base_tx.reason,
        suffix=base_tx.suffix,
        phone_number=base_tx.phone_number,
        is_fraud=1,
        attack_type="fuzzing",
    )


def inject_amount_tamper(base_tx: Transaction, rng: random.Random,
                          tx_id: str) -> Transaction:
    """
    Amount Tampering: Alter the transaction amount significantly.
    
    Simulates a fraudster modifying a receipt screenshot to show a different
    amount than what was actually paid. The alteration is large enough to be
    meaningful (10-80% change) but keeps the number looking realistic.
    """
    # Tamper the amount by 10-80%
    tamper_factor = rng.uniform(0.2, 0.9) if rng.random() < 0.5 else rng.uniform(1.1, 5.0)
    tampered_amount = round(base_tx.amount * tamper_factor, 2)

    return Transaction(
        transaction_id=tx_id,
        bank=base_tx.bank,
        reference=base_tx.reference,
        amount=tampered_amount,
        currency="ETB",
        payer_name=base_tx.payer_name,
        payer_account=base_tx.payer_account,
        receiver_name=base_tx.receiver_name,
        receiver_account=base_tx.receiver_account,
        transaction_date=base_tx.transaction_date,
        transaction_status=base_tx.transaction_status,
        reason=base_tx.reason,
        suffix=base_tx.suffix,
        phone_number=base_tx.phone_number,
        is_fraud=1,
        attack_type="amount_tamper",
    )


def inject_temporal_anomaly(base_tx: Transaction, rng: random.Random,
                             tx_id: str) -> Transaction:
    """
    Temporal Anomaly: Set implausible timestamps.
    
    Creates transactions with timestamps that are suspicious:
    - Future dates
    - Very old dates
    - 2-4 AM transactions (unusual for Ethiopian banking)
    - Weekend late-night transactions
    """
    anomaly_type = rng.choice(["future", "ancient", "night", "precise_duplicate"])

    if anomaly_type == "future":
        # Future date (1-365 days from now)
        future_date = datetime.now() + timedelta(days=rng.randint(1, 365))
        ts = future_date.strftime("%Y-%m-%dT%H:%M:%S+03:00")
    elif anomaly_type == "ancient":
        # Very old date (2-5 years ago)
        old_date = datetime.now() - timedelta(days=rng.randint(730, 1825))
        ts = old_date.strftime("%Y-%m-%dT%H:%M:%S+03:00")
    elif anomaly_type == "night":
        # Late night / early morning (1-4 AM)
        base_date = datetime.now() - timedelta(days=rng.randint(1, 180))
        base_date = base_date.replace(
            hour=rng.randint(1, 4),
            minute=rng.randint(0, 59),
            second=rng.randint(0, 59),
        )
        ts = base_date.strftime("%Y-%m-%dT%H:%M:%S+03:00")
    else:
        # Exact same timestamp as another transaction (suspicious)
        ts = base_tx.transaction_date

    return Transaction(
        transaction_id=tx_id,
        bank=base_tx.bank,
        reference=generate_reference(base_tx.bank, BANK_CONFIGS[base_tx.bank], rng),
        amount=base_tx.amount,
        currency="ETB",
        payer_name=base_tx.payer_name,
        payer_account=base_tx.payer_account,
        receiver_name=base_tx.receiver_name,
        receiver_account=base_tx.receiver_account,
        transaction_date=ts,
        transaction_status=base_tx.transaction_status,
        reason=base_tx.reason,
        suffix=base_tx.suffix,
        phone_number=base_tx.phone_number,
        is_fraud=1,
        attack_type="temporal_anomaly",
    )


def inject_format_violation(bank: str, config: BankConfig, rng: random.Random,
                             tx_id: str) -> Transaction:
    """
    Format Violation: Create references that break bank-specific formatting rules.
    
    Each bank has strict reference format requirements (prefix, length, charset).
    This attack generates references that deviate from these rules — simulating
    fabricated or poorly forged receipts.
    """
    violation_type = rng.choice(["wrong_prefix", "wrong_length", "wrong_charset", "mixed"])

    if violation_type == "wrong_prefix":
        # Use wrong bank prefix
        wrong_prefixes = {"cbe": "CE", "telebirr": "FT", "abyssinia": "CE",
                         "dashen": "FT", "cbe_birr": "FT", "mpesa": "CE"}
        prefix = wrong_prefixes.get(bank, "XX")
        body_len = config.reference_length - len(prefix)
        body = "".join(rng.choices(config.reference_charset, k=max(1, body_len)))
        reference = prefix + body

    elif violation_type == "wrong_length":
        # Generate reference with wrong length (too short or too long)
        length_offset = rng.choice([-3, -2, +2, +3, +5])
        wrong_length = max(4, config.reference_length + length_offset)
        reference = config.reference_prefix + "".join(
            rng.choices(config.reference_charset, k=wrong_length - len(config.reference_prefix))
        )

    elif violation_type == "wrong_charset":
        # Include special characters that shouldn't be in references
        special = "!@#$%^&*()-_=+[]{}|;:',.<>?/"
        body_len = config.reference_length - len(config.reference_prefix)
        chars = list(rng.choices(config.reference_charset, k=body_len))
        # Insert 1-3 special characters
        for _ in range(rng.randint(1, 3)):
            pos = rng.randint(0, len(chars) - 1)
            chars[pos] = rng.choice(special)
        reference = config.reference_prefix + "".join(chars)

    else:  # mixed
        # Combine multiple violations
        reference = "".join(rng.choices(string.ascii_letters + string.digits + "!@#", 
                                        k=rng.randint(5, 20)))

    return Transaction(
        transaction_id=tx_id,
        bank=bank,
        reference=reference,
        amount=generate_amount(config, rng),
        currency="ETB",
        payer_name=generate_ethiopian_name(rng),
        payer_account=generate_account_number(config, rng),
        receiver_name=generate_ethiopian_name(rng),
        receiver_account=generate_account_number(config, rng),
        transaction_date=generate_timestamp(rng),
        transaction_status=rng.choice(TRANSACTION_STATUSES[bank]),
        reason=rng.choice(PAYMENT_REASONS),
        suffix=generate_suffix(config, rng),
        phone_number=generate_phone_number(rng) if config.has_phone else "",
        is_fraud=1,
        attack_type="format_violation",
    )


def inject_name_mismatch(base_tx: Transaction, rng: random.Random,
                          tx_id: str) -> Transaction:
    """
    Name Mismatch Attack: Swap or randomize payer/receiver names.
    
    Simulates manipulated receipts where the payer and receiver names
    don't match the expected relationship (e.g., a different person's
    name pasted onto a receipt).
    """
    mismatch_type = rng.choice(["swap", "random_payer", "random_receiver", "same_name"])

    payer_name = base_tx.payer_name
    receiver_name = base_tx.receiver_name

    if mismatch_type == "swap":
        payer_name, receiver_name = receiver_name, payer_name
    elif mismatch_type == "random_payer":
        payer_name = generate_ethiopian_name(rng)
    elif mismatch_type == "random_receiver":
        receiver_name = generate_ethiopian_name(rng)
    else:  # same_name — payer and receiver are the same person
        receiver_name = payer_name

    return Transaction(
        transaction_id=tx_id,
        bank=base_tx.bank,
        reference=base_tx.reference,
        amount=base_tx.amount,
        currency="ETB",
        payer_name=payer_name,
        payer_account=base_tx.payer_account,
        receiver_name=receiver_name,
        receiver_account=base_tx.receiver_account,
        transaction_date=base_tx.transaction_date,
        transaction_status=base_tx.transaction_status,
        reason=base_tx.reason,
        suffix=base_tx.suffix,
        phone_number=base_tx.phone_number,
        is_fraud=1,
        attack_type="name_mismatch",
    )


# ──────────────────────────────────────────────────────────────────────────────
# Dataset Orchestrator
# ──────────────────────────────────────────────────────────────────────────────

ATTACK_FUNCTIONS = {
    "replay": inject_replay_attack,
    "fuzzing": inject_fuzzing_attack,
    "amount_tamper": inject_amount_tamper,
    "temporal_anomaly": inject_temporal_anomaly,
    "name_mismatch": inject_name_mismatch,
}


def generate_contaminated_transactions(n: int, 
                                        clean_transactions: List[Transaction],
                                        seed: int = 123) -> List[Transaction]:
    """
    Generate n contaminated transactions based on existing clean transactions.
    
    Each contaminated transaction is derived from a randomly selected clean
    transaction with one of 6 attack types injected. The attack type distribution
    is roughly uniform.
    """
    rng = random.Random(seed)
    contaminated = []
    
    attack_types = list(ATTACK_FUNCTIONS.keys()) + ["format_violation"]
    n_per_attack = n // len(attack_types)
    remainder = n % len(attack_types)
    
    tx_counter = len(clean_transactions)
    
    for i, attack_type in enumerate(attack_types):
        count = n_per_attack + (1 if i < remainder else 0)
        
        for _ in range(count):
            tx_id = f"TX-{tx_counter:06d}"
            base_tx = rng.choice(clean_transactions)
            
            if attack_type == "format_violation":
                bank = rng.choice(list(BANK_CONFIGS.keys()))
                config = BANK_CONFIGS[bank]
                tx = inject_format_violation(bank, config, rng, tx_id)
            else:
                attack_fn = ATTACK_FUNCTIONS[attack_type]
                tx = attack_fn(base_tx, rng, tx_id)
            
            contaminated.append(tx)
            tx_counter += 1
    
    rng.shuffle(contaminated)
    return contaminated


def generate_full_dataset(n_clean: int = 5000, 
                           n_contaminated: int = 1000,
                           seed: int = 42) -> Tuple[List[Transaction], List[Transaction], List[Transaction]]:
    """
    Generate the complete dataset: clean + contaminated, then split.
    
    Returns:
        (full_dataset, clean_only, contaminated_only)
    """
    clean = generate_clean_transactions(n_clean, seed=seed)
    contaminated = generate_contaminated_transactions(n_contaminated, clean, seed=seed + 1)
    
    full = clean + contaminated
    # Shuffle the full dataset
    rng = random.Random(seed + 2)
    rng.shuffle(full)
    
    return full, clean, contaminated


# ──────────────────────────────────────────────────────────────────────────────
# CSV Export
# ──────────────────────────────────────────────────────────────────────────────

DATASET_COLUMNS = [
    "transaction_id", "bank", "reference", "amount", "currency",
    "payer_name", "payer_account", "receiver_name", "receiver_account",
    "transaction_date", "transaction_status", "reason",
    "suffix", "phone_number", "is_fraud", "attack_type",
]


def save_transactions_to_csv(transactions: List[Transaction], filepath: str) -> None:
    """Save transactions to a CSV file."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=DATASET_COLUMNS)
        writer.writeheader()
        for tx in transactions:
            writer.writerow(asdict(tx))

    print(f"  ✅ Saved {len(transactions)} transactions to {filepath}")


def generate_and_save_dataset(output_dir: str = "data",
                               n_clean: int = 5000,
                               n_contaminated: int = 1000,
                               seed: int = 42) -> Dict[str, str]:
    """
    Generate the complete dataset and save to CSV files.
    
    Returns dict of output file paths.
    """
    print(f"\n{'='*60}")
    print(f"  Synthetic Transaction Dataset Generator")
    print(f"{'='*60}")
    print(f"  Clean transactions:        {n_clean:,}")
    print(f"  Contaminated transactions: {n_contaminated:,}")
    print(f"  Total:                     {n_clean + n_contaminated:,}")
    print(f"  Random seed:               {seed}")
    print(f"  Output directory:          {output_dir}")
    print(f"{'='*60}\n")

    full, clean, contaminated = generate_full_dataset(n_clean, n_contaminated, seed)

    paths = {
        "clean": os.path.join(output_dir, "clean_transactions.csv"),
        "contaminated": os.path.join(output_dir, "contaminated_transactions.csv"),
        "full": os.path.join(output_dir, "full_dataset.csv"),
    }

    print("Saving datasets:")
    save_transactions_to_csv(clean, paths["clean"])
    save_transactions_to_csv(contaminated, paths["contaminated"])
    save_transactions_to_csv(full, paths["full"])

    # Print statistics
    print(f"\n{'─'*60}")
    print("Dataset Statistics:")
    print(f"{'─'*60}")
    
    # Bank distribution
    from collections import Counter
    bank_counts = Counter(tx.bank for tx in full)
    print("\n  Bank Distribution (full dataset):")
    for bank, count in sorted(bank_counts.items(), key=lambda x: -x[1]):
        pct = count / len(full) * 100
        print(f"    {bank:15s}: {count:5d} ({pct:5.1f}%)")

    # Attack type distribution
    attack_counts = Counter(tx.attack_type for tx in contaminated)
    print("\n  Attack Type Distribution (contaminated only):")
    for attack, count in sorted(attack_counts.items(), key=lambda x: -x[1]):
        pct = count / len(contaminated) * 100
        print(f"    {attack:20s}: {count:4d} ({pct:5.1f}%)")

    # Amount statistics
    amounts = [tx.amount for tx in clean]
    print(f"\n  Amount Statistics (clean only):")
    print(f"    Min:    {min(amounts):12,.2f} ETB")
    print(f"    Max:    {max(amounts):12,.2f} ETB")
    print(f"    Mean:   {sum(amounts)/len(amounts):12,.2f} ETB")
    print(f"    Median: {sorted(amounts)[len(amounts)//2]:12,.2f} ETB")
    
    print(f"\n{'='*60}")
    print("  Dataset generation complete!")
    print(f"{'='*60}\n")

    return paths


if __name__ == "__main__":
    generate_and_save_dataset()
