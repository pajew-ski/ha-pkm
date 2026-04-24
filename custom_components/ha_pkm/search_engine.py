import re
import logging
from pathlib import Path

from .const import NOTE_EXTENSIONS

_LOGGER = logging.getLogger(__name__)

FRONTMATTER_RE = re.compile(r'^---\n(.*?)\n---\n?', re.DOTALL)
TITLE_RE = re.compile(r'^#\s+(.+)', re.MULTILINE)

EXCERPT_CONTEXT = 120


class SearchEngine:
    def __init__(self, hass, vault_path: str):
        self.hass = hass
        self.vault_path = Path(vault_path).resolve()
        self._index: dict[str, dict] = {}

    async def rebuild_index(self) -> None:
        def _build():
            index = {}
            for ext in NOTE_EXTENSIONS:
                for p in self.vault_path.rglob(f"*{ext}"):
                    if any(part.startswith(".") for part in p.parts):
                        continue
                    rel = str(p.relative_to(self.vault_path))
                    try:
                        content = p.read_text(encoding="utf-8")
                        index[rel] = _parse_note(content)
                    except Exception:
                        pass
            return index

        self._index = await self.hass.async_add_executor_job(_build)

    async def index_file(self, path: str, content: str) -> None:
        self._index[path] = _parse_note(content)

    async def remove_file(self, path: str) -> None:
        self._index.pop(path, None)

    async def search(self, query: str, limit: int = 20) -> list[dict]:
        if not query.strip():
            return []

        def _search():
            results = []
            terms = query.lower().split()
            for path, note in self._index.items():
                score, matches, excerpt = _score_note(note, terms)
                if score > 0:
                    results.append(
                        {
                            "path": path,
                            "title": note["title"] or Path(path).stem,
                            "excerpt": excerpt,
                            "score": score,
                            "matches": matches,
                        }
                    )
            results.sort(key=lambda r: r["score"], reverse=True)
            return results[:limit]

        return await self.hass.async_add_executor_job(_search)


def _parse_note(content: str) -> dict:
    frontmatter = {}
    body = content
    fm_match = FRONTMATTER_RE.match(content)
    if fm_match:
        body = content[fm_match.end():]
        try:
            import yaml
            frontmatter = yaml.safe_load(fm_match.group(1)) or {}
        except Exception:
            pass

    title_match = TITLE_RE.search(body)
    title = title_match.group(1).strip() if title_match else (frontmatter.get("title") or "")

    return {
        "title": title,
        "body": body,
        "frontmatter": frontmatter,
        "lower_body": body.lower(),
        "lower_title": title.lower(),
        "fm_text": " ".join(str(v) for v in frontmatter.values()).lower(),
    }


def _score_note(note: dict, terms: list[str]) -> tuple[int, list[str], str]:
    score = 0
    matched_terms = []
    first_match_pos = len(note["body"])

    for term in terms:
        in_title = term in note["lower_title"]
        in_body = term in note["lower_body"]
        in_fm = term in note["fm_text"]

        if in_title:
            score += 10
        if in_body:
            score += 3
            pos = note["lower_body"].find(term)
            if pos < first_match_pos:
                first_match_pos = pos
        if in_fm:
            score += 5

        if in_title or in_body or in_fm:
            matched_terms.append(term)

    if not matched_terms:
        return 0, [], ""

    # Build excerpt around first match
    body = note["body"]
    if first_match_pos < len(body):
        start = max(0, first_match_pos - EXCERPT_CONTEXT // 2)
        end = min(len(body), first_match_pos + EXCERPT_CONTEXT)
        excerpt = ("..." if start > 0 else "") + body[start:end] + ("..." if end < len(body) else "")
        # Wrap matched terms in <mark>
        for term in matched_terms:
            excerpt = re.sub(
                re.escape(term),
                lambda m: f"<mark>{m.group(0)}</mark>",
                excerpt,
                flags=re.IGNORECASE,
            )
    else:
        excerpt = body[:EXCERPT_CONTEXT] + "..." if len(body) > EXCERPT_CONTEXT else body

    return score, matched_terms, excerpt
