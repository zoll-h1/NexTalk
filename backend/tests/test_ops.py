import pytest

from app.core.config import settings
from app.core.rate_limit import rate_limiter


@pytest.mark.asyncio
async def test_health_rate_limit_can_reject_excess_requests(client):
    original_limit = settings.rate_limit_requests
    original_window = settings.rate_limit_window_seconds

    settings.rate_limit_requests = 2
    settings.rate_limit_window_seconds = 60
    rate_limiter.reset()

    try:
        first = await client.get("/health")
        second = await client.get("/health")
        third = await client.get("/health")
    finally:
        settings.rate_limit_requests = original_limit
        settings.rate_limit_window_seconds = original_window
        rate_limiter.reset()

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429
    assert third.json()["detail"] == "Rate limit exceeded"
    assert "x-request-id" in third.headers
