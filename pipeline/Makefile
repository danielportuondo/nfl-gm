.PHONY: data validate test lint

SEASONS ?= 2010-2025

# Real ratings from ratings-model are used automatically when present in .cache/model/;
# otherwise this falls back to depth-order placeholders (loudly logged).
data:
	uv run python -m gridiron_pipeline -v data --seasons $(SEASONS) --allow-placeholder-ratings

validate:
	uv run python -m gridiron_pipeline validate

test:
	uv run pytest -q

lint:
	uv run ruff check .
