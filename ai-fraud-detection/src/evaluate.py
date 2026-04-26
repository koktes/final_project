"""
Evaluation Framework

Computes all evaluation metrics required for the thesis:
    - Precision, Recall, F1-Score (overall and per-attack-type)
    - Confusion Matrix
    - ROC-AUC Curve
    - Risk Score Distribution Analysis
    - Feature Importance Ranking

Generates publication-quality plots saved to the results directory.
These are directly usable in thesis Chapter 5 (Results & Evaluation).
"""

import os
import json
import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Optional
from datetime import datetime

from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    roc_curve,
    auc,
    precision_recall_curve,
    f1_score,
    precision_score,
    recall_score,
    accuracy_score,
)

import matplotlib
matplotlib.use("Agg")  # Non-interactive backend for server environments
import matplotlib.pyplot as plt
import seaborn as sns


# ──────────────────────────────────────────────────────────────────────────────
# Evaluation Report
# ──────────────────────────────────────────────────────────────────────────────

def evaluate_model(y_true: np.ndarray, 
                   y_pred: np.ndarray,
                   risk_scores: np.ndarray,
                   attack_types: Optional[List[str]] = None,
                   output_dir: str = "results",
                   threshold: float = 50.0,
                   verbose: bool = True) -> Dict:
    """
    Run comprehensive model evaluation and generate all thesis-ready outputs.
    
    Args:
        y_true: Ground truth labels (0=clean, 1=fraud)
        y_pred: Binary predictions (0=clean, 1=fraud)
        risk_scores: Continuous risk scores (0-100)
        attack_types: Optional list of attack type labels per sample
        output_dir: Directory to save plots and reports
        verbose: Print results to console
    
    Returns:
        Evaluation report dictionary
    """
    os.makedirs(output_dir, exist_ok=True)
    
    if verbose:
        print("\n" + "=" * 60)
        print("  Model Evaluation Report")
        print("=" * 60)
    
    report = {
        "timestamp": datetime.now().isoformat(),
        "n_samples": len(y_true),
        "n_positive": int(np.sum(y_true == 1)),
        "n_negative": int(np.sum(y_true == 0)),
    }
    
    # ── 1. Overall Metrics ──
    metrics = compute_overall_metrics(y_true, y_pred, risk_scores)
    report["overall_metrics"] = metrics
    
    if verbose:
        print(f"\n  Overall Metrics:")
        print(f"  {'─' * 40}")
        print(f"  Accuracy:  {metrics['accuracy']:.4f}")
        print(f"  Precision: {metrics['precision']:.4f}")
        print(f"  Recall:    {metrics['recall']:.4f}")
        print(f"  F1-Score:  {metrics['f1_score']:.4f}")
        print(f"  ROC-AUC:   {metrics['roc_auc']:.4f}")
    
    # ── 2. Confusion Matrix ──
    cm = compute_confusion_matrix(y_true, y_pred)
    report["confusion_matrix"] = cm
    plot_confusion_matrix(y_true, y_pred, output_dir)
    
    if verbose:
        print(f"\n  Confusion Matrix:")
        print(f"  {'─' * 40}")
        print(f"  True Negatives:  {cm['tn']:5d}  |  False Positives: {cm['fp']:5d}")
        print(f"  False Negatives: {cm['fn']:5d}  |  True Positives:  {cm['tp']:5d}")
    
    # ── 3. ROC Curve ──
    roc_data = plot_roc_curve(y_true, risk_scores / 100.0, output_dir)
    report["roc_auc_detailed"] = roc_data
    
    # ── 4. Precision-Recall Curve ──
    pr_data = plot_precision_recall_curve(y_true, risk_scores / 100.0, output_dir)
    report["pr_auc"] = pr_data
    
    # ── 5. Risk Score Distribution ──
    plot_risk_score_distribution(y_true, risk_scores, output_dir, threshold=threshold)
    
    # ── 6. Per-Attack-Type Breakdown ──
    if attack_types is not None:
        attack_report = compute_per_attack_metrics(y_true, y_pred, risk_scores, attack_types)
        report["per_attack_metrics"] = attack_report
        plot_per_attack_performance(attack_report, output_dir)
        
        if verbose:
            print(f"\n  Per-Attack-Type Performance:")
            print(f"  {'─' * 56}")
            print(f"  {'Attack Type':<20s} {'Count':>6s} {'Detected':>9s} {'Rate':>7s} {'Avg Risk':>9s}")
            print(f"  {'─' * 56}")
            for attack, data in sorted(attack_report.items()):
                if attack == "none":
                    continue
                print(f"  {attack:<20s} {data['count']:>6d} {data['detected']:>9d} "
                      f"{data['detection_rate']:>6.1%} {data['avg_risk_score']:>8.1f}")
    
    # ── 7. Classification Report (sklearn format) ──
    clf_report = classification_report(y_true, y_pred, target_names=["Clean", "Fraud"],
                                        output_dict=True)
    report["classification_report"] = clf_report
    
    if verbose:
        print(f"\n  Detailed Classification Report:")
        print(f"  {'─' * 40}")
        print(classification_report(y_true, y_pred, target_names=["Clean", "Fraud"]))
    
    # ── Save Report ──
    report_path = os.path.join(output_dir, "evaluation_report.json")
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2, default=str)
    
    if verbose:
        print(f"\n  📊 All plots saved to: {output_dir}/")
        print(f"  📄 Report saved to: {report_path}")
        print(f"{'=' * 60}\n")
    
    return report


# ──────────────────────────────────────────────────────────────────────────────
# Metric Computations
# ──────────────────────────────────────────────────────────────────────────────

def compute_overall_metrics(y_true: np.ndarray, y_pred: np.ndarray,
                             risk_scores: np.ndarray) -> Dict:
    """Compute overall classification metrics."""
    # ROC-AUC uses the continuous risk scores
    fpr, tpr, _ = roc_curve(y_true, risk_scores / 100.0)
    roc_auc_val = auc(fpr, tpr)
    
    return {
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "precision": round(float(precision_score(y_true, y_pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, y_pred, zero_division=0)), 4),
        "f1_score": round(float(f1_score(y_true, y_pred, zero_division=0)), 4),
        "roc_auc": round(float(roc_auc_val), 4),
    }


def compute_confusion_matrix(y_true: np.ndarray, y_pred: np.ndarray) -> Dict:
    """Compute confusion matrix components."""
    cm = confusion_matrix(y_true, y_pred)
    tn, fp, fn, tp = cm.ravel()
    return {
        "tn": int(tn), "fp": int(fp),
        "fn": int(fn), "tp": int(tp),
    }


def compute_per_attack_metrics(y_true: np.ndarray, y_pred: np.ndarray,
                                risk_scores: np.ndarray,
                                attack_types: List[str]) -> Dict:
    """Compute detection metrics broken down by attack type."""
    report = {}
    
    unique_attacks = set(attack_types)
    
    for attack in unique_attacks:
        mask = np.array([a == attack for a in attack_types])
        if not np.any(mask):
            continue
        
        subset_true = y_true[mask]
        subset_pred = y_pred[mask]
        subset_scores = risk_scores[mask]
        
        detected = int(np.sum(subset_pred == 1))
        total = int(np.sum(mask))
        
        report[attack] = {
            "count": total,
            "detected": detected,
            "detection_rate": round(detected / total, 4) if total > 0 else 0.0,
            "avg_risk_score": round(float(np.mean(subset_scores)), 2),
            "median_risk_score": round(float(np.median(subset_scores)), 2),
            "min_risk_score": round(float(np.min(subset_scores)), 2),
            "max_risk_score": round(float(np.max(subset_scores)), 2),
        }
    
    return report


# ──────────────────────────────────────────────────────────────────────────────
# Plot Generation (Thesis-Ready)
# ──────────────────────────────────────────────────────────────────────────────

def _setup_plot_style():
    """Configure matplotlib for publication-quality plots."""
    plt.rcParams.update({
        "figure.figsize": (8, 6),
        "figure.dpi": 150,
        "font.size": 12,
        "axes.titlesize": 14,
        "axes.labelsize": 12,
        "xtick.labelsize": 10,
        "ytick.labelsize": 10,
        "legend.fontsize": 10,
        "figure.facecolor": "white",
        "axes.facecolor": "white",
        "axes.grid": True,
        "grid.alpha": 0.3,
    })


def plot_confusion_matrix(y_true: np.ndarray, y_pred: np.ndarray,
                           output_dir: str) -> None:
    """Generate and save a confusion matrix heatmap."""
    _setup_plot_style()
    
    cm = confusion_matrix(y_true, y_pred)
    
    fig, ax = plt.subplots(figsize=(8, 6))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Blues",
                xticklabels=["Clean", "Fraud"],
                yticklabels=["Clean", "Fraud"],
                ax=ax, cbar_kws={"label": "Count"})
    ax.set_title("Confusion Matrix — Fraud Detection Model", fontweight="bold")
    ax.set_xlabel("Predicted Label")
    ax.set_ylabel("True Label")
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "confusion_matrix.png"), dpi=150, bbox_inches="tight")
    plt.close()


def plot_roc_curve(y_true: np.ndarray, y_scores: np.ndarray,
                    output_dir: str) -> Dict:
    """Generate and save an ROC curve."""
    _setup_plot_style()
    
    fpr, tpr, thresholds = roc_curve(y_true, y_scores)
    roc_auc_val = auc(fpr, tpr)
    
    fig, ax = plt.subplots(figsize=(8, 6))
    ax.plot(fpr, tpr, color="#2563eb", lw=2,
            label=f"ROC Curve (AUC = {roc_auc_val:.4f})")
    ax.plot([0, 1], [0, 1], color="#94a3b8", lw=1, linestyle="--",
            label="Random Classifier")
    ax.fill_between(fpr, tpr, alpha=0.1, color="#2563eb")
    
    ax.set_xlim([-0.02, 1.02])
    ax.set_ylim([-0.02, 1.02])
    ax.set_xlabel("False Positive Rate")
    ax.set_ylabel("True Positive Rate")
    ax.set_title("ROC Curve — Fraud Detection Model", fontweight="bold")
    ax.legend(loc="lower right")
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "roc_curve.png"), dpi=150, bbox_inches="tight")
    plt.close()
    
    return {"auc": round(float(roc_auc_val), 4)}


def plot_precision_recall_curve(y_true: np.ndarray, y_scores: np.ndarray,
                                 output_dir: str) -> Dict:
    """Generate and save a Precision-Recall curve."""
    _setup_plot_style()
    
    precision, recall, thresholds = precision_recall_curve(y_true, y_scores)
    pr_auc_val = auc(recall, precision)
    
    fig, ax = plt.subplots(figsize=(8, 6))
    ax.plot(recall, precision, color="#16a34a", lw=2,
            label=f"PR Curve (AUC = {pr_auc_val:.4f})")
    ax.fill_between(recall, precision, alpha=0.1, color="#16a34a")
    
    ax.set_xlim([-0.02, 1.02])
    ax.set_ylim([-0.02, 1.02])
    ax.set_xlabel("Recall")
    ax.set_ylabel("Precision")
    ax.set_title("Precision-Recall Curve — Fraud Detection Model", fontweight="bold")
    ax.legend(loc="lower left")
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "precision_recall_curve.png"), dpi=150, bbox_inches="tight")
    plt.close()
    
    return {"auc": round(float(pr_auc_val), 4)}


def plot_risk_score_distribution(y_true: np.ndarray, risk_scores: np.ndarray,
                                  output_dir: str, threshold: float = 50.0) -> None:
    """Generate and save risk score distribution plot (clean vs fraud)."""
    _setup_plot_style()
    
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    
    # Plot 1: Overlapping histograms
    ax1 = axes[0]
    clean_scores = risk_scores[y_true == 0]
    fraud_scores = risk_scores[y_true == 1]
    
    ax1.hist(clean_scores, bins=50, alpha=0.6, color="#22c55e", label="Clean", density=True)
    ax1.hist(fraud_scores, bins=50, alpha=0.6, color="#ef4444", label="Fraud", density=True)
    ax1.axvline(x=threshold, color="#f59e0b", linestyle="--", lw=2, label=f"Threshold ({threshold:.0f})")
    ax1.set_xlabel("Risk Score (0-100)")
    ax1.set_ylabel("Density")
    ax1.set_title("Risk Score Distribution", fontweight="bold")
    ax1.legend()
    
    # Plot 2: Box plot
    ax2 = axes[1]
    data = pd.DataFrame({
        "Risk Score": risk_scores,
        "Class": ["Clean" if y == 0 else "Fraud" for y in y_true]
    })
    sns.boxplot(data=data, x="Class", y="Risk Score", hue="Class", ax=ax2,
                palette={"Clean": "#22c55e", "Fraud": "#ef4444"}, legend=False)
    ax2.set_title("Risk Score by Class", fontweight="bold")
    ax2.axhline(y=threshold, color="#f59e0b", linestyle="--", lw=2, label="Threshold")
    ax2.legend()
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "risk_score_distribution.png"), dpi=150, bbox_inches="tight")
    plt.close()


def plot_per_attack_performance(attack_report: Dict, output_dir: str) -> None:
    """Generate and save per-attack-type detection performance bar chart."""
    _setup_plot_style()
    
    # Filter out "none" (clean transactions)
    attacks = {k: v for k, v in attack_report.items() if k != "none"}
    
    if not attacks:
        return
    
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    
    # Plot 1: Detection rate per attack type
    ax1 = axes[0]
    attack_names = list(attacks.keys())
    detection_rates = [attacks[a]["detection_rate"] * 100 for a in attack_names]
    colors = sns.color_palette("viridis", len(attack_names))
    
    bars = ax1.barh(attack_names, detection_rates, color=colors)
    ax1.set_xlabel("Detection Rate (%)")
    ax1.set_title("Detection Rate by Attack Type", fontweight="bold")
    ax1.set_xlim([0, 105])
    
    for bar, rate in zip(bars, detection_rates):
        ax1.text(bar.get_width() + 1, bar.get_y() + bar.get_height() / 2,
                f"{rate:.1f}%", va="center", fontsize=10)
    
    # Plot 2: Average risk score per attack type
    ax2 = axes[1]
    avg_scores = [attacks[a]["avg_risk_score"] for a in attack_names]
    
    bars2 = ax2.barh(attack_names, avg_scores, color=colors)
    ax2.set_xlabel("Average Risk Score")
    ax2.set_title("Average Risk Score by Attack Type", fontweight="bold")
    ax2.set_xlim([0, 105])
    ax2.axvline(x=50, color="#f59e0b", linestyle="--", lw=2, label="Suspicious Threshold")
    ax2.legend()
    
    for bar, score in zip(bars2, avg_scores):
        ax2.text(bar.get_width() + 1, bar.get_y() + bar.get_height() / 2,
                f"{score:.1f}", va="center", fontsize=10)
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "per_attack_performance.png"), dpi=150, bbox_inches="tight")
    plt.close()


def plot_feature_importance(feature_names: List[str], importances: np.ndarray,
                             output_dir: str, top_n: int = 15) -> None:
    """Generate and save feature importance bar chart."""
    _setup_plot_style()
    
    # Sort by importance
    indices = np.argsort(importances)[::-1][:top_n]
    
    fig, ax = plt.subplots(figsize=(10, 6))
    
    names = [feature_names[i] for i in indices]
    values = importances[indices]
    colors = sns.color_palette("coolwarm_r", top_n)
    
    ax.barh(names[::-1], values[::-1], color=colors[::-1])
    ax.set_xlabel("Feature Importance (Mean Absolute Deviation)")
    ax.set_title(f"Top {top_n} Most Important Features", fontweight="bold")
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "feature_importance.png"), dpi=150, bbox_inches="tight")
    plt.close()


def compute_feature_importance(model, X_test_scaled: np.ndarray,
                                feature_names: List[str],
                                output_dir: str) -> np.ndarray:
    """
    Compute feature importance using mean absolute deviation in anomaly scoring.
    
    For each feature, we measure how much the anomaly score changes when that
    feature is perturbed. Features that cause larger changes are more important.
    """
    base_scores = model.isolation_forest.score_samples(X_test_scaled)
    importances = np.zeros(X_test_scaled.shape[1])
    
    for i in range(X_test_scaled.shape[1]):
        X_perturbed = X_test_scaled.copy()
        # Shuffle this feature's values
        np.random.shuffle(X_perturbed[:, i])
        perturbed_scores = model.isolation_forest.score_samples(X_perturbed)
        importances[i] = np.mean(np.abs(base_scores - perturbed_scores))
    
    # Normalize
    if importances.max() > 0:
        importances = importances / importances.max()
    
    plot_feature_importance(feature_names, importances, output_dir)
    
    return importances
