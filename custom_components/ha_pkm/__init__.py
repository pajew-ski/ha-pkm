import logging
import os
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.components.panel_custom import async_register_panel

from .const import (
    DOMAIN,
    CONF_VAULT_PATH,
    CONF_ENABLE_WATCHER,
    CONF_WATCHER_DEBOUNCE_MS,
    DEFAULT_VAULT_PATH,
    DEFAULT_ENABLE_WATCHER,
    DEFAULT_WATCHER_DEBOUNCE_MS,
)
from .file_manager import FileManager
from .link_index import LinkIndex
from .search_engine import SearchEngine
from .database import NoteDatabase
from .ws_api import async_register_commands
from .file_watcher import FileWatcher

_LOGGER = logging.getLogger(__name__)

PANEL_URL = "pkm"
PANEL_COMPONENT = "ha-pkm-panel"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.data.setdefault(DOMAIN, {})
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    conf = {**entry.data, **entry.options}

    vault_path = conf.get(CONF_VAULT_PATH, DEFAULT_VAULT_PATH)
    enable_watcher = conf.get(CONF_ENABLE_WATCHER, DEFAULT_ENABLE_WATCHER)
    debounce_ms = conf.get(CONF_WATCHER_DEBOUNCE_MS, DEFAULT_WATCHER_DEBOUNCE_MS)

    # Ensure vault directory and standard subdirs exist
    vault_dir = Path(vault_path)
    await hass.async_add_executor_job(vault_dir.mkdir, 0o755, True, True)

    def _init_vault_dirs():
        for sub in [".pkm", ".trash", "templates", "attachments"]:
            (vault_dir / sub).mkdir(exist_ok=True)

    await hass.async_add_executor_job(_init_vault_dirs)

    # Frontend files live inside the component dir so HACS ships them automatically.
    # Fall back to a manually-placed www/ha-pkm-panel for advanced dev setups.
    www_candidates = [
        Path(__file__).parent / "www",
        Path(hass.config.config_dir) / "www" / "ha-pkm-panel",
    ]
    www_path = next((p for p in www_candidates if p.exists()), None)
    if www_path:
        hass.http.register_static_path("/ha-pkm-panel", str(www_path), cache_headers=False)
        _LOGGER.info("Registered static path: /ha-pkm-panel → %s", www_path)
    else:
        _LOGGER.warning("Frontend path not found – tried: %s", [str(p) for p in www_candidates])

    # Register panel
    await async_register_panel(
        hass,
        webcomponent_name=PANEL_COMPONENT,
        sidebar_title="PKM",
        sidebar_icon="mdi:note-multiple-outline",
        frontend_url_path=PANEL_URL,
        config={},
        require_admin=False,
        trust_external=False,
        module_url=f"/ha-pkm-panel/{PANEL_COMPONENT}.js",
    )

    # Initialise service objects
    file_manager = FileManager(hass, vault_path)
    link_index = LinkIndex(hass, vault_path)
    search_engine = SearchEngine(hass, vault_path)
    database = NoteDatabase(hass, vault_path)

    hass.data[DOMAIN] = {
        "file_manager": file_manager,
        "link_index": link_index,
        "search_engine": search_engine,
        "database": database,
        "vault_path": vault_path,
        "enable_watcher": enable_watcher,
        "watcher_debounce_ms": debounce_ms,
        "file_watcher": None,
    }

    # Register WebSocket commands
    async_register_commands(hass)

    # Build initial indices
    hass.async_create_task(_build_indices(link_index, search_engine, database))

    # Start file watcher
    if enable_watcher:
        watcher = FileWatcher(hass, vault_path, debounce_ms)
        await hass.async_add_executor_job(watcher.start)
        hass.data[DOMAIN]["file_watcher"] = watcher

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    return True


async def _build_indices(link_index: LinkIndex, search_engine: SearchEngine, database: NoteDatabase) -> None:
    await link_index.async_load()
    await link_index.rebuild_full()
    await search_engine.rebuild_index()
    await database.rebuild()


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data = hass.data.get(DOMAIN, {})
    watcher = data.get("file_watcher")
    if watcher:
        await hass.async_add_executor_job(watcher.stop)
    hass.data.pop(DOMAIN, None)
    return True
