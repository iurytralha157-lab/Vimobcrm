#!/usr/bin/env python3
"""Copy the isolated Evo canary license key into a Swarm secret without printing it.

Run on the Swarm manager after /license/status reports active. The key never
appears in an argument, environment variable, local file, or script output.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys


CANARY_DB = "evogo_calls_canary_postgres"
CANARY_EVO = "evogo_calls_canary_evolution_go_canary"
PROD_API = "vimob-crm_api"
PROD_EVO = "evolution_go_evolution_go"
SECRET = "vimob_evogo_canary_api_key"


def docker(*args: str, input_bytes: bytes | None = None) -> bytes:
    try:
        result = subprocess.run(
            ["docker", *args], input=input_bytes, capture_output=True, check=True
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        # Docker may include a value in stderr. Do not echo captured output.
        raise RuntimeError(f"Docker operation failed: {args[0]}") from exc
    return result.stdout


def service(name: str) -> dict:
    items = json.loads(docker("service", "inspect", name))
    if len(items) != 1 or items[0].get("Spec", {}).get("Name") != name:
        raise RuntimeError(f"Unexpected service identity: {name}")
    return items[0]


def environment(spec: dict) -> dict[str, str]:
    values = spec["Spec"]["TaskTemplate"]["ContainerSpec"].get("Env", [])
    return dict(item.split("=", 1) for item in values if "=" in item)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--create", action="store_true", help="Create the Swarm secret after validation")
    args = parser.parse_args()

    if docker("secret", "ls", "--format", "{{.Name}}").decode().splitlines().count(SECRET):
        raise RuntimeError(f"Swarm secret already exists: {SECRET}")

    canary = service(CANARY_EVO)
    canary_env = environment(canary)
    if canary_env.get("CONNECT_ON_STARTUP") != "false" or canary_env.get("EVOGO_CALLS_ENABLED") != "false":
        raise RuntimeError("Canary must still have WhatsApp startup and calls disabled")
    if canary["Spec"].get("Labels", {}).get("traefik.enable") != "false":
        raise RuntimeError("Canary public router must still be disabled")

    containers = docker(
        "ps", "--filter", f"label=com.docker.swarm.service.name={CANARY_DB}",
        "--format", "{{.ID}}"
    ).decode().splitlines()
    if len(containers) != 1:
        raise RuntimeError("Expected exactly one isolated canary PostgreSQL container")

    query = "SELECT value FROM runtime_configs WHERE key = 'api_key'"
    key = docker(
        "exec", containers[0], "psql", "-U", "evogo_canary", "-d", "evogo_canary", "-Atc", query
    ).decode().strip()
    if not re.fullmatch(r"[0-9a-fA-F]{64}", key):
        raise RuntimeError("Canary license key is missing or malformed")

    production_keys = [
        environment(service(PROD_API)).get("EVOLUTION_GO_API_KEY"),
        environment(service(PROD_EVO)).get("GLOBAL_API_KEY"),
    ]
    production_keys = [item for item in production_keys if item]
    if not production_keys:
        raise RuntimeError("Could not verify the key is distinct from production")
    if key in production_keys:
        raise RuntimeError("Canary key matches a production key")

    if args.create:
        docker("secret", "create", SECRET, "-", input_bytes=key.encode())
        print(f"Created Swarm secret {SECRET} from the isolated canary database")
    else:
        print(f"Validated isolated canary key and distinct production key; {SECRET} is absent")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"HOLD: {exc}", file=sys.stderr)
        raise SystemExit(1) from None
