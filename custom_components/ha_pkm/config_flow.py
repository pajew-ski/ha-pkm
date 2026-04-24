import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback

from .const import (
    DOMAIN,
    CONF_VAULT_PATH,
    CONF_ENABLE_WATCHER,
    CONF_WATCHER_DEBOUNCE_MS,
    DEFAULT_VAULT_PATH,
    DEFAULT_ENABLE_WATCHER,
    DEFAULT_WATCHER_DEBOUNCE_MS,
)

STEP_USER_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_VAULT_PATH, default=DEFAULT_VAULT_PATH): str,
        vol.Required(CONF_ENABLE_WATCHER, default=DEFAULT_ENABLE_WATCHER): bool,
        vol.Required(
            CONF_WATCHER_DEBOUNCE_MS, default=DEFAULT_WATCHER_DEBOUNCE_MS
        ): vol.All(int, vol.Range(min=100, max=5000)),
    }
)


class HaPkmConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        errors = {}
        if user_input is not None:
            vault_path = user_input[CONF_VAULT_PATH]
            if not vault_path.startswith("/"):
                errors[CONF_VAULT_PATH] = "path_not_absolute"
            else:
                await self.async_set_unique_id(DOMAIN)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(title="ha-pkm", data=user_input)

        return self.async_show_form(
            step_id="user",
            data_schema=STEP_USER_SCHEMA,
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return HaPkmOptionsFlow(config_entry)


class HaPkmOptionsFlow(config_entries.OptionsFlow):
    def __init__(self, config_entry):
        self.config_entry = config_entry

    async def async_step_init(self, user_input=None):
        errors = {}
        if user_input is not None:
            vault_path = user_input[CONF_VAULT_PATH]
            if not vault_path.startswith("/"):
                errors[CONF_VAULT_PATH] = "path_not_absolute"
            else:
                return self.async_create_entry(title="", data=user_input)

        current = self.config_entry.options or self.config_entry.data
        schema = vol.Schema(
            {
                vol.Required(
                    CONF_VAULT_PATH,
                    default=current.get(CONF_VAULT_PATH, DEFAULT_VAULT_PATH),
                ): str,
                vol.Required(
                    CONF_ENABLE_WATCHER,
                    default=current.get(CONF_ENABLE_WATCHER, DEFAULT_ENABLE_WATCHER),
                ): bool,
                vol.Required(
                    CONF_WATCHER_DEBOUNCE_MS,
                    default=current.get(
                        CONF_WATCHER_DEBOUNCE_MS, DEFAULT_WATCHER_DEBOUNCE_MS
                    ),
                ): vol.All(int, vol.Range(min=100, max=5000)),
            }
        )
        return self.async_show_form(
            step_id="init",
            data_schema=schema,
            errors=errors,
        )
