"""Provide minimal homeassistant stubs so tests can import our modules without a full HA install."""
import sys
import types
from unittest.mock import MagicMock


def _make_module(name, **attrs):
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    return mod


# Core stubs
sys.modules.setdefault("homeassistant", _make_module("homeassistant"))
sys.modules.setdefault("homeassistant.core", _make_module("homeassistant.core", HomeAssistant=MagicMock))
sys.modules.setdefault("homeassistant.config_entries", _make_module("homeassistant.config_entries", ConfigEntry=MagicMock))
sys.modules.setdefault("homeassistant.components", _make_module("homeassistant.components"))
sys.modules.setdefault("homeassistant.components.panel_custom", _make_module("homeassistant.components.panel_custom", async_register_panel=MagicMock()))
sys.modules.setdefault("homeassistant.components.websocket_api", _make_module(
    "homeassistant.components.websocket_api",
    websocket_command=lambda *a, **kw: (lambda fn: fn),
    async_response=lambda fn: fn,
    connection_from_message=MagicMock,
    ActiveConnection=MagicMock,
    ERR_NOT_FOUND="not_found",
    ERR_INVALID_FORMAT="invalid_format",
    ERR_UNKNOWN_ERROR="unknown_error",
))
sys.modules.setdefault("homeassistant.helpers", _make_module("homeassistant.helpers"))
sys.modules.setdefault("homeassistant.helpers.storage", _make_module("homeassistant.helpers.storage", Store=MagicMock))
sys.modules.setdefault("homeassistant.core_decorators", _make_module("homeassistant.core_decorators"))

# voluptuous stub
vol_mod = types.ModuleType("voluptuous")
vol_mod.Schema = MagicMock(side_effect=lambda s, **kw: s)
vol_mod.Required = MagicMock(side_effect=lambda k, **kw: k)
vol_mod.Optional = MagicMock(side_effect=lambda k, **kw: k)
vol_mod.All = MagicMock(side_effect=lambda *a: a[0])
vol_mod.Coerce = MagicMock(side_effect=lambda t: t)
vol_mod.In = MagicMock(side_effect=lambda v: v)
vol_mod.Invalid = Exception
sys.modules.setdefault("voluptuous", vol_mod)

# homeassistant.helpers.config_validation stub
cv_mod = types.ModuleType("homeassistant.helpers.config_validation")
cv_mod.string = str
cv_mod.boolean = bool
cv_mod.positive_int = int
sys.modules.setdefault("homeassistant.helpers.config_validation", cv_mod)

# callback decorator stub
import homeassistant.core as _hass_core
_hass_core.callback = lambda fn: fn
