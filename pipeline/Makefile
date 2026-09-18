.PHONY: data model data-placeholder validate test lint

SEASONS ?= 2010-2025

# Requires ratings-model's parquets in .cache/model/ (run `make model` first, or `make data-placeholder`
# to export with depth-order placeholder ratings for pipeline development only — never ship those).
data:
	uv run python -m gridiron_pipeline -v data --seasons $(SEASONS)

model:
	uv run python -m gridiron_pipeline.model build --seasons $(SEASONS)

data-placeholder:
	uv run python -m gridiron_pipeline -v data --seasons $(SEASONS) --allow-placeholder-ratings

validate:
	uv run python -m gridiron_pipeline validate

test:
	uv run pytest -q

lint:
	uv run ruff check .
