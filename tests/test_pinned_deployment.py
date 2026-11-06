"""Protect release pin rewrites and online SQLite backups."""
import importlib.util
from pathlib import Path
import sqlite3

import pytest

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).parents[1] / 'scripts/deploy_pinned_coordinator.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


def test_launcher_preserves_environment_secret_reads_and_exec():
    source = '#!/bin/zsh\ncd /checkout\nsource /private/env.sh\ncd /old-release\nexport PYTHONPATH=/old-release"${PYTHONPATH:+:$PYTHONPATH}"\nexport IE_GEO_INGRESS_SECRET="$(cat /private/marker)"\nexec /checkout/.venv/bin/python -c "run()"\n'
    result = deploy.update_launcher(source, Path('/new release'))
    assert "cd '/new release'\nexport PYTHONPATH='/new release'" in result
    assert 'source /private/env.sh' in result
    assert 'export IE_GEO_INGRESS_SECRET="$(cat /private/marker)"' in result
    assert result.split('\nexec ')[1] == source.split('\nexec ')[1]
    assert '/old-release' not in result
    assert deploy.update_launcher(result, Path('/new release')) == result
    with pytest.raises(ValueError):
        deploy.update_launcher('#!/bin/zsh\nexec python\n', Path('/new'))


def test_backup_includes_committed_wal_without_changing_live_data(tmp_path):
    source, destination = tmp_path / 'live.db', tmp_path / 'backup.db'
    live = sqlite3.connect(source)
    live.execute('PRAGMA journal_mode=WAL')
    live.execute('CREATE TABLE example(value INTEGER)')
    live.execute('INSERT INTO example VALUES (79)')
    live.commit()
    deploy.backup_database(source, destination)
    with sqlite3.connect(destination) as backup:
        assert backup.execute('SELECT value FROM example').fetchone()[0] == 79
    live.execute('INSERT INTO example VALUES (80)')
    live.commit()
    assert live.execute('SELECT COUNT(*) FROM example').fetchone()[0] == 2
    live.close()
