from collections import defaultdict, deque
from threading import Lock
from time import monotonic


class SlidingWindowRateLimiter:
    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        now = monotonic()
        with self._lock:
            window = self._events[key]
            boundary = now - window_seconds
            while window and window[0] <= boundary:
                window.popleft()

            if len(window) >= limit:
                retry_after = max(int(window_seconds - (now - window[0])) + 1, 1)
                return False, retry_after

            window.append(now)
            return True, 0

    def reset(self) -> None:
        with self._lock:
            self._events.clear()


rate_limiter = SlidingWindowRateLimiter()
