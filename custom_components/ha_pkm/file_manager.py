import os
import shutil
import tempfile
import asyncio
from pathlib import Path
from datetime import datetime

from .const import TRASH_DIR, HIDDEN_DIRS


class FileManager:
    def __init__(self, hass, vault_path: str):
        self.hass = hass
        self.vault_path = Path(vault_path).resolve()

    def _safe_resolve(self, relative_path: str) -> Path:
        """Resolve a relative path under vault_path, rejecting traversal attempts."""
        resolved = (self.vault_path / relative_path).resolve()
        # is_relative_to() (Python 3.9+) avoids the prefix-collision bug of
        # str.startswith() when vault names share a common prefix.
        if not resolved.is_relative_to(self.vault_path):
            raise PermissionError(f"Path traversal denied: {relative_path}")
        return resolved

    def _stat_entry(self, full_path: Path, relative_to: Path) -> dict:
        stat = full_path.stat()
        return {
            "name": full_path.name,
            "path": str(full_path.relative_to(relative_to)),
            "type": "folder" if full_path.is_dir() else "file",
            "mtime": stat.st_mtime,
            "size": stat.st_size if full_path.is_file() else 0,
        }

    def _build_tree(self, directory: Path) -> list:
        entries = []
        try:
            items = sorted(directory.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
        except PermissionError:
            return entries

        for item in items:
            # Hide system dirs but allow .pkm (saved views live there)
            if item.name in HIDDEN_DIRS:
                continue
            if item.name.startswith(".") and item.name != ".pkm":
                continue
            entry = self._stat_entry(item, self.vault_path)
            if item.is_dir():
                entry["children"] = self._build_tree(item)
            entries.append(entry)
        return entries

    async def list_files(self, path: str = "") -> list:
        def _list():
            base = self._safe_resolve(path) if path else self.vault_path
            return self._build_tree(base)
        return await self.hass.async_add_executor_job(_list)

    async def read_file(self, path: str) -> dict:
        def _read():
            full = self._safe_resolve(path)
            if not full.exists():
                raise FileNotFoundError(f"File not found: {path}")
            stat = full.stat()
            return {
                "content": full.read_text(encoding="utf-8"),
                "mtime": stat.st_mtime,
                "size": stat.st_size,
            }
        return await self.hass.async_add_executor_job(_read)

    async def write_file(self, path: str, content: str) -> dict:
        def _write():
            full = self._safe_resolve(path)
            full.parent.mkdir(parents=True, exist_ok=True)
            # Atomic write via temp file + rename
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=full.parent,
                delete=False,
                suffix=".tmp",
            ) as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            os.replace(tmp_path, full)
            stat = full.stat()
            return {"mtime": stat.st_mtime, "size": stat.st_size}
        return await self.hass.async_add_executor_job(_write)

    async def delete_file(self, path: str) -> None:
        def _delete():
            full = self._safe_resolve(path)
            if not full.exists():
                raise FileNotFoundError(f"File not found: {path}")
            trash_dir = self.vault_path / TRASH_DIR
            trash_dir.mkdir(exist_ok=True)
            # Avoid collisions in trash by prepending timestamp
            ts = datetime.now().strftime("%Y%m%d_%H%M%S_")
            dest = trash_dir / (ts + full.name)
            shutil.move(str(full), str(dest))
        return await self.hass.async_add_executor_job(_delete)

    async def rename_file(self, old_path: str, new_path: str) -> None:
        def _rename():
            old_full = self._safe_resolve(old_path)
            new_full = self._safe_resolve(new_path)
            if not old_full.exists():
                raise FileNotFoundError(f"File not found: {old_path}")
            new_full.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(old_full), str(new_full))
        return await self.hass.async_add_executor_job(_rename)

    async def create_folder(self, path: str) -> None:
        def _mkdir():
            full = self._safe_resolve(path)
            full.mkdir(parents=True, exist_ok=True)
        return await self.hass.async_add_executor_job(_mkdir)
