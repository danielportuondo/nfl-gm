.PHONY: data test lint

data:
	uv run python -m gridiron_pipeline build-all

test:
	uv run pytest -q

lint:
	uv run ruff check . && uv run ruff format --check .
