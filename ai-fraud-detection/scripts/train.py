"""
Training Pipeline CLI

Complete end-to-end pipeline:
    1. Generate synthetic dataset (or load existing)
    2. Engineer features
    3. Train Isolation Forest + Logistic Regression
    4. Evaluate on test set
    5. Generate all thesis plots and metrics
    6. Save model artifacts

Usage:
    python scripts/train.py
    python scripts/train.py --clean 5000 --contaminated 1000
    python scripts/train.py --data-dir ./data --model-dir ./models/production
"""

import os
import sys
import argparse
import numpy as np
import pandas as pd

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.data_generator import generate_and_save_dataset
from src.features import (
    build_feature_matrix,
    compute_bank_amount_stats,
    ReferenceFrequencyTracker,
    FEATURE_NAMES,
)
from src.model import FraudDetectionModel
from src.evaluate import (
    evaluate_model,
    compute_feature_importance,
)


def main():
    parser = argparse.ArgumentParser(
        description="Train the fraud detection model end-to-end."
    )
    parser.add_argument("--clean", type=int, default=5000,
                        help="Number of clean transactions to generate (default: 5000)")
    parser.add_argument("--contaminated", type=int, default=1000,
                        help="Number of contaminated transactions to generate (default: 1000)")
    parser.add_argument("--seed", type=int, default=42,
                        help="Random seed for reproducibility (default: 42)")
    parser.add_argument("--data-dir", type=str, default=None,
                        help="Data directory (default: ./data)")
    parser.add_argument("--model-dir", type=str, default=None,
                        help="Model output directory (default: ./models/production)")
    parser.add_argument("--results-dir", type=str, default=None,
                        help="Results/plots directory (default: ./results)")
    parser.add_argument("--skip-data-gen", action="store_true",
                        help="Skip data generation (use existing CSVs)")
    
    args = parser.parse_args()
    
    # Resolve paths relative to the ai-fraud-detection directory
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = args.data_dir or os.path.join(base_dir, "data")
    model_dir = args.model_dir or os.path.join(base_dir, "models", "production")
    results_dir = args.results_dir or os.path.join(base_dir, "results")
    
    print("\n" + "█" * 60)
    print("  FRAUD DETECTION MODEL — TRAINING PIPELINE")
    print("█" * 60)
    print(f"  Clean transactions:        {args.clean:,}")
    print(f"  Contaminated transactions: {args.contaminated:,}")
    print(f"  Seed:                      {args.seed}")
    print(f"  Data directory:            {data_dir}")
    print(f"  Model directory:           {model_dir}")
    print(f"  Results directory:         {results_dir}")
    print("█" * 60)
    
    # ── Step 1: Generate or Load Data ──
    if not args.skip_data_gen:
        print("\n\n▶ STEP 1: Generating synthetic dataset...")
        generate_and_save_dataset(
            output_dir=data_dir,
            n_clean=args.clean,
            n_contaminated=args.contaminated,
            seed=args.seed,
        )
    else:
        print("\n\n▶ STEP 1: Skipping data generation (using existing CSVs)")
    
    # Load datasets
    print("\n▶ STEP 2: Loading datasets...")
    clean_path = os.path.join(data_dir, "clean_transactions.csv")
    contaminated_path = os.path.join(data_dir, "contaminated_transactions.csv")
    full_path = os.path.join(data_dir, "full_dataset.csv")
    
    if not os.path.exists(clean_path) or not os.path.exists(contaminated_path):
        print(f"  ❌ Error: Dataset files not found in {data_dir}")
        print(f"     Expected: clean_transactions.csv, contaminated_transactions.csv")
        print(f"     Run without --skip-data-gen to generate them.")
        sys.exit(1)
    
    clean_df = pd.read_csv(clean_path)
    contaminated_df = pd.read_csv(contaminated_path)
    full_df = pd.read_csv(full_path)
    
    print(f"  Clean:        {len(clean_df):,} rows")
    print(f"  Contaminated: {len(contaminated_df):,} rows")
    print(f"  Full:         {len(full_df):,} rows")
    
    # ── Step 3: Train Model ──
    print("\n▶ STEP 3: Training model...")
    model = FraudDetectionModel()
    training_report = model.train(clean_df, contaminated_df, verbose=True)
    
    # ── Step 4: Save Model ──
    print("\n▶ STEP 4: Saving model artifacts...")
    model.save(model_dir)
    
    # ── Step 5: Evaluate on Full Dataset ──
    print("\n▶ STEP 5: Evaluating model on full dataset...")
    
    # Get predictions
    risk_scores, predictions, statuses = model.predict_batch(full_df)
    y_true = full_df["is_fraud"].values.astype(int)
    attack_types = full_df["attack_type"].values.tolist()
    
    # Run evaluation
    binary_threshold = model.config.get("binary_threshold", 0.5)
    eval_report = evaluate_model(
        y_true=y_true,
        y_pred=predictions,
        risk_scores=risk_scores,
        attack_types=attack_types,
        output_dir=results_dir,
        threshold=binary_threshold * 100,  # Convert to risk score space for plotting
        verbose=True,
    )
    
    # ── Step 6: Feature Importance ──
    print("\n▶ STEP 6: Computing feature importance...")
    X_full = model._build_features(full_df)
    X_full_scaled = model.scaler.transform(X_full)
    
    importances = compute_feature_importance(
        model, X_full_scaled, FEATURE_NAMES, results_dir
    )
    
    # Print top features
    top_indices = np.argsort(importances)[::-1][:10]
    print("\n  Top 10 Most Important Features:")
    print(f"  {'─' * 50}")
    for i, idx in enumerate(top_indices, 1):
        print(f"  {i:2d}. {FEATURE_NAMES[idx]:<30s} {importances[idx]:.4f}")
    
    # ── Summary ──
    print("\n\n" + "█" * 60)
    print("  TRAINING COMPLETE — SUMMARY")
    print("█" * 60)
    print(f"  Dataset:     {len(full_df):,} transactions ({len(clean_df):,} clean + {len(contaminated_df):,} fraud)")
    print(f"  Features:    {len(FEATURE_NAMES)} engineered features")
    print(f"  Accuracy:    {eval_report['overall_metrics']['accuracy']:.4f}")
    print(f"  Precision:   {eval_report['overall_metrics']['precision']:.4f}")
    print(f"  Recall:      {eval_report['overall_metrics']['recall']:.4f}")
    print(f"  F1-Score:    {eval_report['overall_metrics']['f1_score']:.4f}")
    print(f"  ROC-AUC:     {eval_report['overall_metrics']['roc_auc']:.4f}")
    print(f"  Model saved: {model_dir}")
    print(f"  Results:     {results_dir}")
    print("█" * 60)
    
    # List generated files
    print("\n  Generated Files:")
    for directory, label in [(data_dir, "Data"), (model_dir, "Model"), (results_dir, "Results")]:
        if os.path.exists(directory):
            files = os.listdir(directory)
            print(f"\n  {label} ({directory}):")
            for f in sorted(files):
                size = os.path.getsize(os.path.join(directory, f))
                if size > 1024 * 1024:
                    size_str = f"{size / 1024 / 1024:.1f} MB"
                elif size > 1024:
                    size_str = f"{size / 1024:.1f} KB"
                else:
                    size_str = f"{size} B"
                print(f"    {f:<40s} {size_str}")
    
    print("\n  ✅ Pipeline complete! Model is ready for inference.")
    print(f"  Start the API server with: python -m src.api")
    print()


if __name__ == "__main__":
    main()
