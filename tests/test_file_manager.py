"""Tests for FileManager — pure sync helpers (no hass needed)."""
import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

# We only test the synchronous helpers; async wrappers are thin pass-throughs.
from custom_components.ha_pkm.file_manager import FileManager


@pytest.fixture
def vault(tmp_path):
    """Return a FileManager whose vault is a fresh temp directory."""
    hass = MagicMock()
    hass.async_add_executor_job = AsyncMock(side_effect=lambda fn, *a, **k: fn(*a, **k))
    return FileManager(hass, str(tmp_path)), tmp_path


# ---------------------------------------------------------------------------
# _safe_resolve
# ---------------------------------------------------------------------------

class TestSafeResolve:
    def test_valid_relative(self, vault):
        fm, tmp = vault
        resolved = fm._safe_resolve("notes/foo.md")
        assert resolved == tmp / "notes" / "foo.md"

    def test_root_file(self, vault):
        fm, tmp = vault
        assert fm._safe_resolve("readme.md") == tmp / "readme.md"

    def test_traversal_rejected(self, vault):
        fm, _ = vault
        with pytest.raises(PermissionError):
            fm._safe_resolve("../etc/passwd")

    def test_traversal_via_dotdot_chain(self, vault):
        fm, _ = vault
        with pytest.raises(PermissionError):
            fm._safe_resolve("notes/../../secret")

    def test_sibling_dir_rejected(self, vault):
        """Vault /tmp/abc should not grant access to /tmp/abcevil."""
        fm, tmp = vault
        # Craft a path that resolves to a sibling of the vault
        sibling = tmp.parent / (tmp.name + "evil")
        sibling.mkdir(exist_ok=True)
        rel = os.path.relpath(sibling / "file.txt", tmp)
        with pytest.raises(PermissionError):
            fm._safe_resolve(rel)


# ---------------------------------------------------------------------------
# _stat_entry
# ---------------------------------------------------------------------------

class TestStatEntry:
    def test_file_entry(self, vault):
        fm, tmp = vault
        f = tmp / "note.md"
        f.write_text("hello")
        entry = fm._stat_entry(f, tmp)
        assert entry["name"] == "note.md"
        assert entry["path"] == "note.md"
        assert entry["type"] == "file"
        assert entry["size"] == 5

    def test_dir_entry(self, vault):
        fm, tmp = vault
        d = tmp / "subdir"
        d.mkdir()
        entry = fm._stat_entry(d, tmp)
        assert entry["type"] == "folder"
        assert entry["size"] == 0


# ---------------------------------------------------------------------------
# _build_tree
# ---------------------------------------------------------------------------

class TestBuildTree:
    def test_basic_listing(self, vault):
        fm, tmp = vault
        (tmp / "a.md").write_text("")
        (tmp / "b.md").write_text("")
        tree = fm._build_tree(tmp)
        names = [e["name"] for e in tree]
        assert "a.md" in names
        assert "b.md" in names

    def test_hidden_dirs_excluded(self, vault):
        fm, tmp = vault
        (tmp / ".trash").mkdir()
        (tmp / ".git").mkdir()
        (tmp / ".pkm").mkdir()
        tree = fm._build_tree(tmp)
        names = [e["name"] for e in tree]
        assert ".trash" not in names
        assert ".git" not in names
        # .pkm should be visible (saved views live there)
        assert ".pkm" in names

    def test_dot_files_excluded(self, vault):
        fm, tmp = vault
        (tmp / ".hidden_file").write_text("x")
        tree = fm._build_tree(tmp)
        names = [e["name"] for e in tree]
        assert ".hidden_file" not in names

    def test_nested_structure(self, vault):
        fm, tmp = vault
        sub = tmp / "sub"
        sub.mkdir()
        (sub / "child.md").write_text("")
        tree = fm._build_tree(tmp)
        folders = [e for e in tree if e["type"] == "folder"]
        assert folders[0]["name"] == "sub"
        assert any(c["name"] == "child.md" for c in folders[0]["children"])

    def test_folders_sorted_before_files(self, vault):
        fm, tmp = vault
        (tmp / "alpha.md").write_text("")
        (tmp / "zeta").mkdir()
        tree = fm._build_tree(tmp)
        assert tree[0]["type"] == "folder"
        assert tree[1]["type"] == "file"


# ---------------------------------------------------------------------------
# write_file / read_file (sync internals via executor mock)
# ---------------------------------------------------------------------------

class TestWriteRead:
    def test_round_trip(self, vault):
        fm, tmp = vault
        path = "notes/hello.md"
        # call sync _write directly
        full = tmp / "notes" / "hello.md"
        full.parent.mkdir(parents=True, exist_ok=True)
        import tempfile as _tf, os as _os
        content = "# Hello\nworld"
        with _tf.NamedTemporaryFile(mode="w", encoding="utf-8", dir=full.parent, delete=False, suffix=".tmp") as t:
            t.write(content)
            tmp_name = t.name
        _os.replace(tmp_name, full)
        assert full.read_text() == content

    def test_creates_parent_dirs(self, vault):
        fm, tmp = vault
        deep = tmp / "a" / "b" / "c"
        deep.mkdir(parents=True)
        f = deep / "note.md"
        f.write_text("content")
        assert f.exists()
