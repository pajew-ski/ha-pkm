import re
import logging
from pathlib import Path

from .const import NOTE_EXTENSIONS

_LOGGER = logging.getLogger(__name__)

FRONTMATTER_RE = re.compile(r'^---\n(.*?)\n---\n?', re.DOTALL)


class NoteDatabase:
    def __init__(self, hass, vault_path: str):
        self.hass = hass
        self.vault_path = Path(vault_path).resolve()
        self._notes: dict[str, dict] = {}

    async def rebuild(self) -> None:
        def _build():
            notes = {}
            for ext in NOTE_EXTENSIONS:
                for p in self.vault_path.rglob(f"*{ext}"):
                    if any(part.startswith(".") for part in p.parts):
                        continue
                    rel = str(p.relative_to(self.vault_path))
                    try:
                        content = p.read_text(encoding="utf-8")
                        notes[rel] = _extract_metadata(rel, content, p)
                    except Exception:
                        pass
            return notes

        self._notes = await self.hass.async_add_executor_job(_build)

    async def update_file(self, path: str, content: str) -> None:
        full = self.vault_path / path
        self._notes[path] = _extract_metadata(path, content, full)

    async def remove_file(self, path: str) -> None:
        self._notes.pop(path, None)

    async def query(self, filter_obj: dict) -> list[dict]:
        def _filter():
            results = []
            for path, meta in self._notes.items():
                if _matches(meta, filter_obj):
                    results.append({"path": path, **meta})
            results.sort(key=lambda r: r.get("title", r["path"]))
            return results

        return await self.hass.async_add_executor_job(_filter)

    def get_all_fields(self) -> list[str]:
        fields = set()
        for meta in self._notes.values():
            fields.update(k for k in meta if k not in ("path", "mtime", "size"))
        return sorted(fields)

    def get_all_notes(self) -> list[dict]:
        return [{"path": p, **m} for p, m in self._notes.items()]


def _extract_metadata(path: str, content: str, full_path: Path) -> dict:
    fm = {}
    fm_match = FRONTMATTER_RE.match(content)
    if fm_match:
        try:
            import yaml
            fm = yaml.safe_load(fm_match.group(1)) or {}
        except Exception:
            pass

    try:
        stat = full_path.stat()
        mtime = stat.st_mtime
        size = stat.st_size
    except Exception:
        mtime = 0
        size = 0

    from pathlib import Path as _Path
    title = fm.get("title") or _Path(path).stem
    return {"title": title, "mtime": mtime, "size": size, **fm}


def _matches(meta: dict, filter_obj: dict) -> bool:
    for key, condition in filter_obj.items():
        value = meta.get(key)
        if isinstance(condition, dict):
            for op, operand in condition.items():
                if op == "$contains":
                    if value is None:
                        return False
                    if isinstance(value, list):
                        if operand not in value:
                            return False
                    elif operand not in str(value):
                        return False
                elif op == "$startsWith":
                    if value is None or not str(value).startswith(str(operand)):
                        return False
                elif op == "$before":
                    if value is None or float(value) >= float(operand):
                        return False
                elif op == "$after":
                    if value is None or float(value) <= float(operand):
                        return False
                elif op == "$isEmpty":
                    is_empty = value is None or value == "" or value == []
                    if operand and not is_empty:
                        return False
                    if not operand and is_empty:
                        return False
                elif op == "$isNotEmpty":
                    is_empty = value is None or value == "" or value == []
                    if operand and is_empty:
                        return False
                    if not operand and not is_empty:
                        return False
                elif op == "$ne":
                    if value == operand:
                        return False
                else:
                    _LOGGER.warning("Unknown filter operator: %s", op)
        else:
            # Equality
            if value != condition:
                return False
    return True
