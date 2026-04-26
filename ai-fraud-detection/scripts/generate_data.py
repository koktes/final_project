"""
Data Generation CLI

Standalone script to generate synthetic transaction datasets
without training a model. Useful for data inspection and thesis documentation.

Usage:
    python scripts/generate_data.py
    python scripts/generate_data.py --clean 10000 --contaminated 2000
    python scripts/generate_data.py --output ./data --seed 42
"""

import os
import sys
import argparse

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.data_generator import generate_and_save_dataset


def main():
    parser = argparse.ArgumentParser(
        description="Generate synthetic transaction datasets for fraud detection."
    )
    parser.add_argument("--clean", type=int, default=5000,
                        help="Number of clean transactions (default: 5000)")
    parser.add_argument("--contaminated", type=int, default=1000,
                        help="Number of contaminated transactions (default: 1000)")
    parser.add_argument("--output", type=str, default=None,
                        help="Output directory (default: ./data)")
    parser.add_argument("--seed", type=int, default=42,
                        help="Random seed for reproducibility (default: 42)")
    
    args = parser.parse_args()
    
    # Resolve output path
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    output_dir = args.output or os.path.join(base_dir, "data")
    
    generate_and_save_dataset(
        output_dir=output_dir,
        n_clean=args.clean,
        n_contaminated=args.contaminated,
        seed=args.seed,
    )


if __name__ == "__main__":
    main()
