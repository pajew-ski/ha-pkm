"""Tests for LinkIndex._parse_file and resolve/index helpers."""
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from custom_components.ha_pkm.link_index import LinkIndex, WIKILINK_RE, TAG_RE


@pytest.fixture
def index(tmp_path):
    hass = MagicMock()
    store = MagicMock()
    store.async_load = AsyncMock(return_value=None)
    store.async_save = AsyncMock()
    with patch("custom_components.ha_pkm.link_index.Store", return_value=store):
        idx = LinkIndex(hass, str(tmp_path))
    return idx


# ---------------------------------------------------------------------------
# _parse_file
# ---------------------------------------------------------------------------

class TestParseFile:
    def test_extracts_wikilinks(self, index):
        links, _ = index._parse_file("a.md", "See [[Target Note]] and [[Other]]")
        assert "Target Note" in links
        assert "Other" in links

    def test_wikilink_with_alias(self, index):
        links, _ = index._parse_file("a.md", "[[Real Target|Display Text]]")
        assert "Real Target" in links

    def test_wikilink_with_header(self, index):
        links, _ = index._parse_file("a.md", "[[Note#section]]")
        assert "Note" in links

    def test_inline_tags(self, index):
        _, tags = index._parse_file("a.md", "This is #mytag and #another/sub")
        assert "#mytag" in tags
        assert "#another/sub" in tags

    def test_frontmatter_tags(self, index):
        content = "---\ntags: [work, personal]\n---\n# Body"
        _, tags = index._parse_file("a.md", content)
        assert "#work" in tags
        assert "#personal" in tags

    def test_frontmatter_tags_string(self, index):
        content = "---\ntags: solo\n---\ntext"
        _, tags = index._parse_file("a.md", content)
        assert "#solo" in tags

    def test_no_links(self, index):
        links, tags = index._parse_file("a.md", "Plain text without any links.")
        assert links == []
        assert tags == []

    def test_duplicate_tags_deduplicated(self, index):
        _, tags = index._parse_file("a.md", "#foo bar #foo baz")
        assert tags.count("#foo") == 1


# ---------------------------------------------------------------------------
# _index_file / resolve_link
# ---------------------------------------------------------------------------

class TestIndexAndResolve:
    def test_resolve_exact_path(self, index):
        index._index_file("notes/foo.md", "")
        assert index.resolve_link("notes/foo.md") == "notes/foo.md"

    def test_resolve_stem(self, index):
        index._index_file("notes/foo.md", "")
        assert index.resolve_link("foo") == "notes/foo.md"

    def test_resolve_with_md_extension(self, index):
        index._index_file("notes/foo.md", "")
        assert index.resolve_link("foo.md") == "notes/foo.md"

    def test_unresolved_returns_none(self, index):
        assert index.resolve_link("nonexistent") is None

    def test_backlinks_built(self, index):
        index._index_file("notes/foo.md", "")
        index._index_file("notes/bar.md", "See [[foo]]")
        assert "notes/bar.md" in index.get_backlinks("notes/foo.md")

    def test_remove_file_cleans_backlinks(self, index):
        index._index_file("notes/foo.md", "")
        index._index_file("notes/bar.md", "[[foo]]")
        index._remove_file_from_index("notes/bar.md")
        assert index.get_backlinks("notes/foo.md") == []

    def test_ghost_node_in_graph(self, index):
        index._index_file("a.md", "[[ghost_note]]")
        data = index.get_graph_data()
        ghost_ids = [n["id"] for n in data["nodes"] if n["ghost"]]
        assert "__ghost__ghost_note" in ghost_ids

    def test_tags_indexed(self, index):
        index._index_file("a.md", "#work project notes")
        assert "a.md" in index.get_tags().get("#work", [])


# ---------------------------------------------------------------------------
# Regex unit tests
# ---------------------------------------------------------------------------

class TestRegex:
    def test_wikilink_re_basic(self):
        m = WIKILINK_RE.search("See [[Foo Bar]]")
        assert m.group(1) == "Foo Bar"

    def test_wikilink_re_no_match_in_code(self):
        # Should still match — we don't skip code blocks at regex level
        m = WIKILINK_RE.search("`[[code]]`")
        assert m is not None

    def test_tag_re_word_boundary(self):
        matches = [m.group(1) for m in TAG_RE.finditer("text #valid but email@address should not match")]
        assert "valid" in matches
        assert "address" not in matches

    def test_tag_re_inline(self):
        matches = [m.group(1) for m in TAG_RE.finditer("#a #b #c")]
        assert matches == ["a", "b", "c"]
