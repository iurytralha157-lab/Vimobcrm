#!/usr/bin/env python3
"""Read aggregate WhatsApp webhook queue health without exposing database secrets.

Run on the Swarm manager. The existing PostgreSQL container supplies `psql` as
a client; it does not host or mutate the Vimob database. Queries are SELECT only.
"""

from __future__ import annotations

import json
import subprocess
import sys
from urllib.parse import parse_qs, unquote, urlsplit


def docker(*args: str, stdin: bytes | None = None) -> bytes:
    try:
        return subprocess.run(
            ["docker", *args], input=stdin, capture_output=True, check=True
        ).stdout
    except (OSError, subprocess.CalledProcessError) as exc:
        # Never echo a connection URL, password, query result, or Docker stderr.
        raise RuntimeError(f"Docker operation failed: {args[0]}") from exc


def main() -> None:
    services = json.loads(docker("service", "inspect", "vimob-crm_api"))
    if len(services) != 1:
        raise RuntimeError("Production API service not found")
    entries = services[0]["Spec"]["TaskTemplate"]["ContainerSpec"].get("Env", [])
    env = dict(item.split("=", 1) for item in entries if "=" in item)
    url = urlsplit(env.get("DATABASE_URL", ""))
    if url.scheme not in ("postgres", "postgresql") or not url.hostname or not url.username:
        raise RuntimeError("Production API database URL has an unexpected format")
    if not url.password or not url.path.strip("/"):
        raise RuntimeError("Production API database URL is incomplete")
    sslmode = parse_qs(url.query).get("sslmode", ["prefer"])[0]
    if sslmode not in ("disable", "allow", "prefer", "require", "verify-ca", "verify-full"):
        raise RuntimeError("Unexpected database SSL mode")

    containers = docker(
        "ps", "--filter", "label=com.docker.swarm.service.name=postgres_postgres",
        "--format", "{{.ID}}"
    ).decode().splitlines()
    if len(containers) != 1:
        raise RuntimeError("PostgreSQL client container not found")

    query = (
        "select 'recent',status,count(*) from public.whatsapp_webhook_inbox "
        "where created_at >= now() - make_interval(mins => 10) group by status "
        "union all "
        "select 'backlog',status,count(*) from public.whatsapp_webhook_inbox "
        "where status in ('pending','retry','processing') group by status "
        "union all "
        "select 'due',status,count(*) from public.whatsapp_webhook_inbox "
        "where status in ('pending','retry') and next_attempt_at <= now() group by status "
        "union all "
        "select 'older_than_24h',status,count(*) from public.whatsapp_webhook_inbox "
        "where status in ('pending','retry') and created_at < now() - make_interval(hours => 24) group by status "
        "union all "
        "select 'pending_event',event_type,count(*) from public.whatsapp_webhook_inbox "
        "where status = 'pending' group by event_type "
        "union all "
        "select 'recent_pending_event',event_type,count(*) from public.whatsapp_webhook_inbox "
        "where status = 'pending' and created_at >= now() - make_interval(mins => 10) group by event_type "
        "union all "
        "select 'recent_processed_event',event_type,count(*) from public.whatsapp_webhook_inbox "
        "where status = 'processed' and created_at >= now() - make_interval(mins => 10) group by event_type "
        "order by 1,2"
    )
    shell = (
        'IFS= read -r pgpass; export PGPASSWORD="$pgpass"; '
        'export PGSSLMODE="$5"; '
        'exec psql -X -A -t -v ON_ERROR_STOP=1 -h "$1" -p "$2" -U "$3" -d "$4" -c "$6"'
    )
    result = docker(
        "exec", "-i", containers[0], "sh", "-ec", shell, "sh", url.hostname,
        str(url.port or 5432), unquote(url.username), unquote(url.path.strip("/")),
        sslmode, query, stdin=(unquote(url.password) + "\n").encode()
    ).decode().strip()
    print(result or "No rows in the last 10 minutes or in the backlog")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as exc:
        print(f"HOLD: {exc}", file=sys.stderr)
        raise SystemExit(1) from None
