import logging

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


def _get_components(hass: HomeAssistant):
    data = hass.data[DOMAIN]
    return data["file_manager"], data["link_index"], data["search_engine"], data["database"]


# ---------------------------------------------------------------------------
# File system handlers
# ---------------------------------------------------------------------------

@websocket_api.websocket_command(
    {vol.Required("type"): "ha_pkm/list_files", vol.Optional("path", default=""): str}
)
@websocket_api.async_response
async def handle_list_files(hass, connection, msg):
    fm, *_ = _get_components(hass)
    try:
        tree = await fm.list_files(msg.get("path", ""))
        connection.send_result(msg["id"], {"files": tree})
    except Exception as err:
        connection.send_error(msg["id"], "list_files_error", str(err))


@websocket_api.websocket_command(
    {vol.Required("type"): "ha_pkm/read_file", vol.Required("path"): str}
)
@websocket_api.async_response
async def handle_read_file(hass, connection, msg):
    fm, *_ = _get_components(hass)
    try:
        result = await fm.read_file(msg["path"])
        connection.send_result(msg["id"], result)
    except FileNotFoundError as err:
        connection.send_error(msg["id"], "file_not_found", str(err))
    except Exception as err:
        connection.send_error(msg["id"], "read_error", str(err))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "ha_pkm/write_file",
        vol.Required("path"): str,
        vol.Required("content"): str,
    }
)
@websocket_api.async_response
async def handle_write_file(hass, connection, msg):
    fm, link_index, search_engine, database = _get_components(hass)
    path = msg["path"]
    content = msg["content"]
    try:
        result = await fm.write_file(path, content)
        # Update dependent indices in background
        hass.async_create_task(link_index.update_file(path, content))
        hass.async_create_task(search_engine.index_file(path, content))
        hass.async_create_task(database.update_file(path, content))
        connection.send_result(msg["id"], result)
    except PermissionError as err:
        connection.send_error(msg["id"], "permission_denied", str(err))
    except Exception as err:
        connection.send_error(msg["id"], "write_error", str(err))


@websocket_api.websocket_command(
    {vol.Required("type"): "ha_pkm/delete_file", vol.Required("path"): str}
)
@websocket_api.async_response
async def handle_delete_file(hass, connection, msg):
    fm, link_index, search_engine, database = _get_components(hass)
    path = msg["path"]
    try:
        await fm.delete_file(path)
        hass.async_create_task(link_index.remove_file(path))
        hass.async_create_task(search_engine.remove_file(path))
        hass.async_create_task(database.remove_file(path))
        connection.send_result(msg["id"], {"ok": True})
    except FileNotFoundError as err:
        connection.send_error(msg["id"], "file_not_found", str(err))
    except Exception as err:
        connection.send_error(msg["id"], "delete_error", str(err))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "ha_pkm/rename_file",
        vol.Required("old_path"): str,
        vol.Required("new_path"): str,
    }
)
@websocket_api.async_response
async def handle_rename_file(hass, connection, msg):
    fm, link_index, search_engine, database = _get_components(hass)
    old_path = msg["old_path"]
    new_path = msg["new_path"]
    try:
        await fm.rename_file(old_path, new_path)
        # Re-read new path for index update
        result = await fm.read_file(new_path)
        hass.async_create_task(link_index.remove_file(old_path))
        hass.async_create_task(link_index.update_file(new_path, result["content"]))
        hass.async_create_task(search_engine.remove_file(old_path))
        hass.async_create_task(search_engine.index_file(new_path, result["content"]))
        hass.async_create_task(database.remove_file(old_path))
        hass.async_create_task(database.update_file(new_path, result["content"]))
        connection.send_result(msg["id"], {"ok": True})
    except FileNotFoundError as err:
        connection.send_error(msg["id"], "file_not_found", str(err))
    except Exception as err:
        connection.send_error(msg["id"], "rename_error", str(err))


@websocket_api.websocket_command(
    {vol.Required("type"): "ha_pkm/create_folder", vol.Required("path"): str}
)
@websocket_api.async_response
async def handle_create_folder(hass, connection, msg):
    fm, *_ = _get_components(hass)
    try:
        await fm.create_folder(msg["path"])
        connection.send_result(msg["id"], {"ok": True})
    except Exception as err:
        connection.send_error(msg["id"], "create_folder_error", str(err))


# ---------------------------------------------------------------------------
# Link / graph handlers
# ---------------------------------------------------------------------------

@websocket_api.websocket_command(
    {vol.Required("type"): "ha_pkm/get_backlinks", vol.Required("path"): str}
)
@callback
def handle_get_backlinks(hass, connection, msg):
    _, link_index, *_ = _get_components(hass)
    connection.send_result(
        msg["id"],
        {"backlinks": link_index.get_backlinks(msg["path"])},
    )


@websocket_api.websocket_command(
    {vol.Required("type"): "ha_pkm/resolve_link", vol.Required("link"): str}
)
@callback
def handle_resolve_link(hass, connection, msg):
    _, link_index, *_ = _get_components(hass)
    resolved = link_index.resolve_link(msg["link"])
    connection.send_result(msg["id"], {"path": resolved})


@websocket_api.websocket_command({vol.Required("type"): "ha_pkm/get_graph_data"})
@callback
def handle_get_graph_data(hass, connection, msg):
    _, link_index, *_ = _get_components(hass)
    connection.send_result(msg["id"], link_index.get_graph_data())


@websocket_api.websocket_command({vol.Required("type"): "ha_pkm/get_tags"})
@callback
def handle_get_tags(hass, connection, msg):
    _, link_index, *_ = _get_components(hass)
    connection.send_result(msg["id"], {"tags": link_index.get_tags()})


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

@websocket_api.websocket_command(
    {
        vol.Required("type"): "ha_pkm/search",
        vol.Required("query"): str,
        vol.Optional("limit", default=20): int,
    }
)
@websocket_api.async_response
async def handle_search(hass, connection, msg):
    _, _, search_engine, _ = _get_components(hass)
    try:
        results = await search_engine.search(msg["query"], msg.get("limit", 20))
        connection.send_result(msg["id"], {"results": results})
    except Exception as err:
        connection.send_error(msg["id"], "search_error", str(err))


# ---------------------------------------------------------------------------
# Database / Dataview
# ---------------------------------------------------------------------------

@websocket_api.websocket_command(
    {
        vol.Required("type"): "ha_pkm/db_query",
        vol.Optional("filter", default={}): dict,
    }
)
@websocket_api.async_response
async def handle_db_query(hass, connection, msg):
    _, _, _, database = _get_components(hass)
    try:
        results = await database.query(msg.get("filter", {}))
        fields = database.get_all_fields()
        connection.send_result(msg["id"], {"notes": results, "fields": fields})
    except Exception as err:
        connection.send_error(msg["id"], "db_query_error", str(err))


# ---------------------------------------------------------------------------
# Canvas
# ---------------------------------------------------------------------------

@websocket_api.websocket_command(
    {vol.Required("type"): "ha_pkm/read_canvas", vol.Required("path"): str}
)
@websocket_api.async_response
async def handle_read_canvas(hass, connection, msg):
    fm, *_ = _get_components(hass)
    import json
    try:
        result = await fm.read_file(msg["path"])
        canvas_data = json.loads(result["content"])
        connection.send_result(msg["id"], {"canvas": canvas_data, "mtime": result["mtime"]})
    except FileNotFoundError as err:
        connection.send_error(msg["id"], "file_not_found", str(err))
    except json.JSONDecodeError as err:
        connection.send_error(msg["id"], "invalid_canvas", str(err))
    except Exception as err:
        connection.send_error(msg["id"], "read_error", str(err))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "ha_pkm/write_canvas",
        vol.Required("path"): str,
        vol.Required("canvas"): dict,
    }
)
@websocket_api.async_response
async def handle_write_canvas(hass, connection, msg):
    fm, *_ = _get_components(hass)
    import json
    try:
        content = json.dumps(msg["canvas"], ensure_ascii=False, indent=2)
        result = await fm.write_file(msg["path"], content)
        connection.send_result(msg["id"], result)
    except PermissionError as err:
        connection.send_error(msg["id"], "permission_denied", str(err))
    except Exception as err:
        connection.send_error(msg["id"], "write_error", str(err))


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

@websocket_api.websocket_command({vol.Required("type"): "ha_pkm/get_config"})
@callback
def handle_get_config(hass, connection, msg):
    data = hass.data[DOMAIN]
    connection.send_result(
        msg["id"],
        {
            "vault_path": data["vault_path"],
            "enable_watcher": data["enable_watcher"],
            "watcher_debounce_ms": data["watcher_debounce_ms"],
        },
    )


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

COMMAND_HANDLERS = [
    handle_list_files,
    handle_read_file,
    handle_write_file,
    handle_delete_file,
    handle_rename_file,
    handle_create_folder,
    handle_get_backlinks,
    handle_resolve_link,
    handle_get_graph_data,
    handle_get_tags,
    handle_search,
    handle_db_query,
    handle_read_canvas,
    handle_write_canvas,
    handle_get_config,
]


def async_register_commands(hass: HomeAssistant) -> None:
    for handler in COMMAND_HANDLERS:
        websocket_api.async_register_command(hass, handler)
