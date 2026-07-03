import sys
from pathlib import Path

# Tests import repo modules directly (grading.*, etl.*, shared.*).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
