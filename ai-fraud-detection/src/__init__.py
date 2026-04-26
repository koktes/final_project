"""
AI Fraud Detection Module for the Multi-Bank Transaction Verification System.

This module provides:
- Synthetic transaction data generation (clean + contaminated)
- Feature engineering pipeline (entropy, temporal, structural analysis)
- Anomaly detection via Isolation Forest + Logistic Regression calibration
- Risk scoring (0-100) with contributing feature breakdown
- Evaluation framework (Precision, Recall, F1, ROC-AUC)
- FastAPI microservice for inference
"""

__version__ = "1.0.0"
