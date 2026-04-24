import asyncio
import logging
import threading
from pathlib import Path

from homeassistant.core import HomeAssistant

from .const import DOMAIN, EVENT_FILE_CHANGED

_LOGGER = logging.getLogger(__name__)

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    WATCHDOG_AVAILABLE = True
except ImportError:
    WATCHDOG_AVAILABLE = False


class _VaultEventHandler:
    def __init__(self, hass: HomeAssistant, vault_path: str, debounce_ms: int):
        self.hass = hass
        self.vault_path = Path(vault_path).resolve()
        self._debounce_s = debounce_ms / 1000.0
        self._pending: dict[str, asyncio.TimerHandle] = {}
        self._lock = threading.Lock()

    def _handle(self, path: str, event_type: str) -> None:
        with self._lock:
            existing = self._pending.pop(path, None)
            if existing:
                existing.cancel()
            loop = self.hass.loop
            handle = loop.call_later(
                self._debounce_s,
                lambda: self.hass.async_create_task(
                    self._fire(path, event_type)
                ),
            )
            self._pending[path] = handle

    async def _fire(self, path: str, event_type: str) -> None:
        try:
            rel = str(Path(path).relative_to(self.vault_path))
        except ValueError:
            return

        _LOGGER.debug("External file change: %s (%s)", rel, event_type)

        self.hass.bus.async_fire(
            EVENT_FILE_CHANGED,
            {"path": rel, "event_type": event_type},
        )

        data = self.hass.data.get(DOMAIN, {})
        link_index = data.get("link_index")
        search_engine = data.get("search_engine")
        database = data.get("database")

        if event_type in ("created", "modified") and path.endswith(".md"):
            try:
                fm = data.get("file_manager")
                if fm:
                    result = await fm.read_file(rel)
                    content = result["content"]
                    if link_index:
                        await link_index.update_file(rel, content)
                    if search_engine:
                        await search_engine.index_file(rel, content)
                    if database:
                        await database.update_file(rel, content)
            except Exception as err:
                _LOGGER.warning("Error updating indices for %s: %s", rel, err)
        elif event_type == "deleted":
            if link_index:
                await link_index.remove_file(rel)
            if search_engine:
                await search_engine.remove_file(rel)
            if database:
                await database.remove_file(rel)


if WATCHDOG_AVAILABLE:
    class _WatchdogHandler(FileSystemEventHandler):
        def __init__(self, vault_handler: _VaultEventHandler):
            super().__init__()
            self._vault = vault_handler

        def on_created(self, event):
            if not event.is_directory:
                self._vault._handle(event.src_path, "created")

        def on_modified(self, event):
            if not event.is_directory:
                self._vault._handle(event.src_path, "modified")

        def on_deleted(self, event):
            if not event.is_directory:
                self._vault._handle(event.src_path, "deleted")

        def on_moved(self, event):
            if not event.is_directory:
                self._vault._handle(event.dest_path, "created")


class FileWatcher:
    def __init__(self, hass: HomeAssistant, vault_path: str, debounce_ms: int):
        self.hass = hass
        self.vault_path = vault_path
        self._debounce_ms = debounce_ms
        self._observer = None

    def start(self) -> None:
        if not WATCHDOG_AVAILABLE:
            _LOGGER.warning("watchdog not available – file watcher disabled")
            return

        vault_handler = _VaultEventHandler(self.hass, self.vault_path, self._debounce_ms)
        handler = _WatchdogHandler(vault_handler)
        self._observer = Observer()
        self._observer.schedule(handler, self.vault_path, recursive=True)
        self._observer.start()
        _LOGGER.info("File watcher started for %s", self.vault_path)

    def stop(self) -> None:
        if self._observer:
            self._observer.stop()
            self._observer.join()
            self._observer = None
            _LOGGER.info("File watcher stopped")
