#!/usr/bin/env python3
"""Update an existing launchd coordinator pin. Preserve its environment and database."""
import argparse
import os
from pathlib import Path
import re
import shlex
import sqlite3
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout.strip()


def update_launcher(source: str, release: Path) -> str:
    """Change only the existing release cd and matching PYTHONPATH prefix."""
    lines = source.splitlines(keepends=True)
    candidates = []
    for i, line in enumerate(lines):
        if line.lstrip().startswith('cd ') and i + 1 < len(lines) and lines[i + 1].startswith('export PYTHONPATH='):
            words = shlex.split(line)
            if len(words) == 2:
                candidates.append((i, words[1]))
    if len(candidates) != 1:
        raise ValueError('Expected one release cd followed by export PYTHONPATH. Launcher was not changed.')
    i, old = candidates[0]
    if old not in lines[i + 1]:
        raise ValueError('Release cd and PYTHONPATH do not match. Launcher was not changed.')
    # Preserve every flag, environment source, secret read, and final exec verbatim.
    lines[i] = f'cd {shlex.quote(str(release))}\n'
    lines[i + 1] = 'export PYTHONPATH=' + shlex.quote(str(release)) + '"${PYTHONPATH:+:$PYTHONPATH}"\n'
    return ''.join(lines)


def backup_database(source: Path, destination: Path):
    if not source.is_file():
        raise ValueError('The configured database does not exist. No service settings changed.')
    with sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True, timeout=30) as live:
        with sqlite3.connect(destination) as backup:
            live.backup(backup)
            if backup.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise ValueError('Database backup integrity check failed.')


def atomic_write(path: Path, text: str):
    temporary = path.with_name(path.name + '.deploy-tmp')
    try:
        temporary.write_text(text)
        temporary.chmod(0o700)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def ready(url: str):
    for _ in range(20):
        try:
            with urlopen(url + '/health', timeout=2) as response:
                healthy = response.status == 200
            try:
                with urlopen(url + '/v1/exchange/activity/network', timeout=2) as response:
                    route_exists = response.status == 200
            except HTTPError:
                route_exists = False
            if healthy and route_exists:
                return
        except (URLError, TimeoutError, OSError):
            pass
        time.sleep(1)
    raise RuntimeError('New coordinator did not pass health and API-route checks.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--db', type=Path, required=True)
    parser.add_argument('--launcher', type=Path, default=Path.home() / '.inference-exchange/services/coordinator.sh')
    parser.add_argument('--service', default='com.inferenceexchange.alpha.coordinator')
    parser.add_argument('--url', default='http://127.0.0.1:8000')
    args = parser.parse_args()
    os.umask(0o077)
    repo = args.repo.expanduser().resolve()
    launcher = args.launcher.expanduser().resolve()
    db = args.db.expanduser().resolve()
    python = repo / '.venv/bin/python'
    if not python.is_file() or not launcher.is_file() or not db.is_file():
        raise ValueError('Existing Python, launcher, and database are required. Nothing was changed.')
    if run('git', '-C', str(repo), 'diff', 'HEAD', '--'):
        raise ValueError('Tracked checkout files have local changes. Nothing was changed.')
    sha = run('git', '-C', str(repo), 'rev-parse', 'HEAD')
    if sha != run('git', '-C', str(repo), 'rev-parse', 'origin/main'):
        raise ValueError('Checkout must be at origin/main. Pull main first.')
    service = f'gui/{os.getuid()}/{args.service}'
    run('launchctl', 'print', service)  # fail before any mutation if not loaded
    release = repo.parent / f'ie-api-release-{sha[:12]}'
    old = launcher.read_text()
    updated = update_launcher(old, release)
    # Existing service configuration must keep the explicit database path.
    # Resolve it in the existing launcher prefix, without starting the application.
    prefix, separator, _ = old.rpartition('\nexec ')
    if not separator:
        raise ValueError('Expected a final exec line. Nothing was changed.')
    env_check = prefix + '\n' + shlex.quote(str(python)) + " -c 'import os; print(os.environ.get(\"IE_DB_PATH\", \"\"))'\n"
    configured_db = run('/bin/zsh', '-c', env_check).splitlines()[-1:]
    if not configured_db or Path(configured_db[-1]).expanduser().resolve() != db:
        raise ValueError('The launcher database path does not match --db. Nothing was changed.')
    if release.exists():
        if run('git', '-C', str(release), 'rev-parse', 'HEAD') != sha or run('git', '-C', str(release), 'status', '--porcelain'):
            raise ValueError('Release directory exists and is not a clean checkout of this commit.')
    else:
        run('git', '-C', str(repo), 'worktree', 'add', '--detach', str(release), sha)
    env = {**os.environ, 'PYTHONPATH': str(release)}
    run(str(python), '-c', 'from inference_exchange.coordinator.main import create_app', cwd=release, env=env)
    run('/bin/zsh', '-n', '-c', updated)
    stamp = time.strftime('%Y%m%d-%H%M%S', time.gmtime())
    backups = launcher.parent / 'backups'
    backups.mkdir(mode=0o700, exist_ok=True)
    previous = backups / f'coordinator-{stamp}-{time.time_ns()}.sh'
    database_backup = backups / f'exchange-{stamp}-{time.time_ns()}.db'
    previous.write_text(old)
    previous.chmod(0o600)
    backup_database(db, database_backup)
    try:
        atomic_write(launcher, updated)
        run('launchctl', 'kickstart', '-k', service)
        ready(args.url.rstrip('/'))
    except Exception:
        atomic_write(launcher, old)
        try:
            run('launchctl', 'kickstart', '-k', service)
        except Exception:
            pass
        print('Deployment failed. Previous launcher restored; check the service logs.', file=sys.stderr)
        raise
    print(f'Coordinator deployed: {sha}')
    print(f'Database backup: {database_backup}')
    print(f'Launcher backup: {previous}')
    print('Rollback code (keeps current database):')
    print(f'cp {shlex.quote(str(previous))} {shlex.quote(str(launcher))} && chmod 700 {shlex.quote(str(launcher))} && launchctl kickstart -k {shlex.quote(service)}')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not print captured subprocess output: it may contain deployment secrets.
        message = str(error) if isinstance(error, ValueError) else f'{type(error).__name__}. Check the configuration and service logs.'
        print(f'Deployment stopped: {message}', file=sys.stderr)
        sys.exit(1)
