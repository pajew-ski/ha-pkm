import re
import logging
from pathlib import Path

from homeassistant.helpers.storage import Store

from .const import STORAGE_KEY_LINK_INDEX, STORAGE_VERSION, NOTE_EXTENSIONS

_LOGGER = logging.getLogger(__name__)

WIKILINK_RE = re.compile(r'\[\[([^\]|#\n]+?)(?:[|#][^\]\n]*)?\]\]')
TAG_RE = re.compile(r'(?<!\S)#([a-zA-ZÀ-ɏ][a-zA-Z0-9_\-/]*)')
FRONTMATTER_RE = re.compile(r'^---\n(.*?)\n---', re.DOTALL)


class LinkIndex:
    def __init__(self, hass, vault_path: str):
        self.hass = hass
        self.vault_path = Path(vault_path).resolve()
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY_LINK_INDEX)
        self._outgoing: dict[str, list[str]] = {}
        self._backlinks: dict[str, list[str]] = {}
        self._tags: dict[str, list[str]] = {}
        self._unresolved: dict[str, list[str]] = {}
        # Stem → path mapping for link resolution
        self._stem_map: dict[str, list[str]] = {}

    async def async_load(self) -> None:
        data = await self._store.async_load()
        if data:
            self._outgoing = data.get("outgoing", {})
            self._backlinks = data.get("backlinks", {})
            self._tags = data.get("tags", {})
            self._unresolved = data.get("unresolved", {})
            self._rebuild_stem_map()

    async def async_save(self) -> None:
        await self._store.async_save(
            {
                "outgoing": self._outgoing,
                "backlinks": self._backlinks,
                "tags": self._tags,
                "unresolved": self._unresolved,
            }
        )

    def _rebuild_stem_map(self) -> None:
        self._stem_map = {}
        for path in self._outgoing:
            stem = Path(path).stem
            self._stem_map.setdefault(stem, [])
            if path not in self._stem_map[stem]:
                self._stem_map[stem].append(path)

    def _parse_file(self, path: str, content: str) -> tuple[list[str], list[str]]:
        links = [m.group(1).strip() for m in WIKILINK_RE.finditer(content)]
        tags = [f"#{m.group(1)}" for m in TAG_RE.finditer(content)]
        fm_match = FRONTMATTER_RE.match(content)
        if fm_match:
            try:
                import yaml
                fm = yaml.safe_load(fm_match.group(1)) or {}
                raw_tags = fm.get("tags", [])
                if isinstance(raw_tags, str):
                    raw_tags = [raw_tags]
                for t in raw_tags:
                    tag = f"#{t}" if not t.startswith("#") else t
                    if tag not in tags:
                        tags.append(tag)
            except Exception:
                pass
        return links, tags

    def _remove_file_from_index(self, path: str) -> None:
        links = self._outgoing.pop(path, [])
        for link in links:
            if path in self._backlinks.get(link, []):
                self._backlinks[link].remove(path)
                if not self._backlinks[link]:
                    del self._backlinks[link]
            if path in self._unresolved.get(link, []):
                self._unresolved[link].remove(path)
                if not self._unresolved[link]:
                    del self._unresolved[link]

        for tag, sources in list(self._tags.items()):
            if path in sources:
                sources.remove(path)
                if not sources:
                    del self._tags[tag]

    def _index_file(self, path: str, content: str) -> None:
        links, tags = self._parse_file(path, content)
        self._outgoing[path] = links

        for link in links:
            resolved = self.resolve_link(link)
            if resolved:
                self._backlinks.setdefault(resolved, [])
                if path not in self._backlinks[resolved]:
                    self._backlinks[resolved].append(path)
            else:
                self._unresolved.setdefault(link, [])
                if path not in self._unresolved[link]:
                    self._unresolved[link].append(path)

        for tag in tags:
            self._tags.setdefault(tag, [])
            if path not in self._tags[tag]:
                self._tags[tag].append(path)

        stem = Path(path).stem
        self._stem_map.setdefault(stem, [])
        if path not in self._stem_map[stem]:
            self._stem_map[stem].append(path)

    async def rebuild_full(self) -> None:
        self._outgoing = {}
        self._backlinks = {}
        self._tags = {}
        self._unresolved = {}
        self._stem_map = {}

        def _collect():
            files = {}
            for ext in NOTE_EXTENSIONS:
                for p in self.vault_path.rglob(f"*{ext}"):
                    rel = str(p.relative_to(self.vault_path))
                    if not any(part.startswith(".") for part in p.parts):
                        try:
                            files[rel] = p.read_text(encoding="utf-8")
                        except Exception:
                            pass
            return files

        files = await self.hass.async_add_executor_job(_collect)
        for path, content in files.items():
            self._index_file(path, content)
        await self.async_save()

    async def update_file(self, path: str, content: str) -> None:
        self._remove_file_from_index(path)
        self._index_file(path, content)
        # Recheck previously unresolved links that might now resolve to this file
        stem = Path(path).stem
        for link, sources in list(self._unresolved.items()):
            if link == stem or link == path:
                for src in list(sources):
                    self._unresolved[link].remove(src)
                    self._backlinks.setdefault(path, [])
                    if src not in self._backlinks[path]:
                        self._backlinks[path].append(src)
                if not self._unresolved[link]:
                    del self._unresolved[link]
        await self.async_save()

    async def remove_file(self, path: str) -> None:
        self._remove_file_from_index(path)
        stem = Path(path).stem
        if stem in self._stem_map and path in self._stem_map[stem]:
            self._stem_map[stem].remove(path)
        await self.async_save()

    def resolve_link(self, link_text: str) -> str | None:
        """Return relative vault path for a wikilink text, or None if unresolved."""
        # Exact path match
        for path in self._outgoing:
            if path == link_text or path == f"{link_text}.md":
                return path
        # Stem match (fuzzy)
        matches = self._stem_map.get(link_text) or self._stem_map.get(
            Path(link_text).stem
        )
        if matches:
            return matches[0]
        return None

    def get_backlinks(self, path: str) -> list[str]:
        return self._backlinks.get(path, [])

    def get_tags(self) -> dict:
        return dict(self._tags)

    def get_graph_data(self) -> dict:
        all_paths = set(self._outgoing.keys())
        # Include ghost nodes from unresolved
        ghost_nodes = set()
        edges = []

        for src, links in self._outgoing.items():
            for link in links:
                resolved = self.resolve_link(link)
                if resolved:
                    edges.append({"source": src, "target": resolved, "label": None})
                else:
                    ghost_nodes.add(link)
                    edges.append({"source": src, "target": f"__ghost__{link}", "label": None})

        nodes = [
            {"id": p, "path": p, "ghost": False, "backlink_count": len(self._backlinks.get(p, []))}
            for p in all_paths
        ]
        for g in ghost_nodes:
            nodes.append({"id": f"__ghost__{g}", "path": None, "ghost": True, "label": g, "backlink_count": 0})

        return {"nodes": nodes, "edges": edges}
