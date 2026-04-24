DOMAIN = "ha_pkm"

CONF_VAULT_PATH = "vault_path"
CONF_ENABLE_WATCHER = "enable_watcher"
CONF_WATCHER_DEBOUNCE_MS = "watcher_debounce_ms"

DEFAULT_VAULT_PATH = "/config/pkm/"
DEFAULT_ENABLE_WATCHER = True
DEFAULT_WATCHER_DEBOUNCE_MS = 500

EVENT_FILE_CHANGED = "ha_pkm_file_changed"

STORAGE_KEY_LINK_INDEX = "ha_pkm_link_index"
STORAGE_VERSION = 1

NOTE_EXTENSIONS = {".md"}
CANVAS_EXTENSION = ".canvas"
DBVIEW_EXTENSION = ".dbview"
TRASH_DIR = ".trash"
HIDDEN_DIRS = {".trash", ".git"}   # .pkm visible so saved views are accessible
