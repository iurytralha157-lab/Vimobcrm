#!/usr/bin/env python3
"""Manage an isolated, HTTP-only Evolution Go webhook bridge on the Swarm manager.

No environment values are printed or written to disk. The source service's
environment is passed to ``docker service create`` through a Linux memfd.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from contextlib import contextmanager
from typing import Any, Iterator


SOURCE = "vimob-crm_api"
BRIDGE = "vimob-whatsapp-webhook-bridge-cli"
PORTAINER_BRIDGE = "vimob-crm_whatsapp_webhook_bridge"
TRAEFIK = "traefik_traefik"
IMAGE_PATTERN = re.compile(
    r"^ghcr\.io/iurytralha157-lab/vimob-crm-api:([0-9a-f]{40})@sha256:[0-9a-f]{64}$"
)
ENV_KEY_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
WORKER_OVERRIDES = {
    "API_BACKGROUND_WORKERS_ENABLED": "false",
    "API_WHATSAPP_CALL_RECORDING_ONLY_WORKER_ENABLED": "false",
}
ROUTER = "vimob-whatsapp-webhook-bridge-cli"
ROUTE_LABELS = {
    "traefik.enable": "true",
    "traefik.docker.network": "public",
    f"traefik.http.routers.{ROUTER}.rule": (
        "Host(`api.vimobcrm.com.br`) && Path(`/v1/whatsapp/webhook/evolution-go`)"
    ),
    f"traefik.http.routers.{ROUTER}.priority": "1000",
    f"traefik.http.routers.{ROUTER}.entrypoints": "websecure",
    f"traefik.http.routers.{ROUTER}.tls": "true",
    f"traefik.http.routers.{ROUTER}.tls.certresolver": "letsencryptresolver",
    f"traefik.http.routers.{ROUTER}.service": ROUTER,
    f"traefik.http.services.{ROUTER}.loadbalancer.server.port": "8081",
}


class BridgeError(RuntimeError):
    pass


def docker(*args: str, pass_fds: tuple[int, ...] = ()) -> str:
    try:
        result = subprocess.run(
            ["docker", *args],
            check=True,
            capture_output=True,
            text=True,
            pass_fds=pass_fds,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        # Docker's stderr may contain a rejected environment value. Never echo it.
        raise BridgeError(f"Docker command failed: {args[0]} {args[1] if len(args) > 1 else ''}") from exc
    return result.stdout


def docker_json(*args: str) -> Any:
    try:
        return json.loads(docker(*args))
    except json.JSONDecodeError as exc:
        raise BridgeError("Docker returned invalid JSON") from exc


def inspect_service(name: str, *, required: bool = True) -> dict[str, Any] | None:
    # A separate lookup makes an absent bridge distinguishable from a broken CLI.
    names = docker("service", "ls", "--format", "{{.Name}}").splitlines()
    if name not in names:
        if required:
            raise BridgeError(f"Required service is missing: {name}")
        return None
    items = docker_json("service", "inspect", name)
    if not isinstance(items, list) or len(items) != 1 or items[0].get("Spec", {}).get("Name") != name:
        raise BridgeError(f"Unexpected Docker service inspect result: {name}")
    return items[0]


def inspect_network(name: str) -> str:
    items = docker_json("network", "inspect", name)
    if not isinstance(items, list) or len(items) != 1:
        raise BridgeError(f"Network is missing: {name}")
    network = items[0]
    if network.get("Name") != name or network.get("Driver") != "overlay" or network.get("Scope") != "swarm":
        raise BridgeError(f"Network has an unexpected configuration: {name}")
    return network["Id"]


def parse_env(spec: dict[str, Any]) -> dict[str, str]:
    entries = spec.get("TaskTemplate", {}).get("ContainerSpec", {}).get("Env", [])
    if not isinstance(entries, list):
        raise BridgeError("Service environment has an unexpected format")
    env: dict[str, str] = {}
    for entry in entries:
        if not isinstance(entry, str) or "=" not in entry:
            raise BridgeError("Service environment contains an invalid entry")
        key, value = entry.split("=", 1)
        if not ENV_KEY_PATTERN.fullmatch(key) or key in env or "\n" in value or "\r" in value or "\0" in value:
            raise BridgeError("Service environment cannot be copied safely")
        env[key] = value
    return env


def expected_bridge_env(source: dict[str, Any]) -> dict[str, str]:
    env = parse_env(source["Spec"])
    if env.get("API_ENV") != "production":
        raise BridgeError("Source API is not configured for production")
    if env.get("API_BACKGROUND_WORKERS_ENABLED") != "true":
        raise BridgeError("Source API worker setting changed; review before bridging")
    if env.get("WHATSAPP_WEBHOOK_PROCESSOR_MODE") != "native":
        raise BridgeError("Source API webhook mode changed; review before bridging")
    for required in ("DATABASE_URL", "SUPABASE_PROJECT_URL", "EVOLUTION_GO_API_URL"):
        if not env.get(required):
            raise BridgeError(f"Source API is missing required setting: {required}")
    return env | WORKER_OVERRIDES


def network_targets(service: dict[str, Any]) -> set[str]:
    return {
        attachment.get("Target", "")
        for attachment in service["Spec"].get("TaskTemplate", {}).get("Networks", [])
    }


def validate_source(source: dict[str, Any]) -> tuple[dict[str, str], set[str]]:
    spec = source["Spec"]
    task = spec.get("TaskTemplate", {})
    container = task.get("ContainerSpec", {})
    if spec.get("Name") != SOURCE or spec.get("Labels", {}).get("com.docker.stack.namespace") != "vimob-crm":
        raise BridgeError("Source service identity changed")
    if spec.get("Mode", {}).get("Replicated", {}).get("Replicas") != 1:
        raise BridgeError("Source API replica count changed")
    if container.get("Secrets") or container.get("Mounts") or container.get("Configs"):
        raise BridgeError("Source API now has mounts, configs, or secrets; review the copy plan")
    if not IMAGE_PATTERN.fullmatch(container.get("Image", "")):
        raise BridgeError("Source API image is not pinned to the expected repository and digest")
    labels = spec.get("Labels", {})
    if labels.get("traefik.http.routers.vimob-api.rule") != "Host(`api.vimobcrm.com.br`)":
        raise BridgeError("Source API public router changed")
    networks = {inspect_network("vimob"), inspect_network("public")}
    if network_targets(source) != networks:
        raise BridgeError("Source API networks changed")
    return expected_bridge_env(source), networks


def validate_traefik(public_network_id: str) -> None:
    traefik = inspect_service(TRAEFIK)
    assert traefik is not None
    if public_network_id not in network_targets(traefik):
        raise BridgeError("Traefik is not attached to the public network")
    args = traefik["Spec"].get("TaskTemplate", {}).get("ContainerSpec", {}).get("Args", [])
    if "--providers.docker.exposedbydefault=false" not in args or "--providers.docker.swarmMode=true" not in args:
        raise BridgeError("Traefik provider settings changed")


def validate_image(image: str) -> str:
    match = IMAGE_PATTERN.fullmatch(image)
    if match is None:
        raise BridgeError("API image must use a 40-character commit tag and pinned sha256 digest")
    return match.group(1)


@contextmanager
def environment_memfd(env: dict[str, str]) -> Iterator[int]:
    if not hasattr(os, "memfd_create"):
        raise BridgeError("Linux memfd support is required on the Swarm manager")
    fd = os.memfd_create("vimob-api-bridge-env", flags=os.MFD_CLOEXEC)
    try:
        # The fd is inherited only by the child Docker CLI; no temporary file or
        # environment value appears in this script's argv, stdout, or logs.
        payload = "".join(f"{key}={value}\n" for key, value in sorted(env.items())).encode()
        with os.fdopen(os.dup(fd), "wb") as stream:
            stream.write(payload)
        os.lseek(fd, 0, os.SEEK_SET)
        yield fd
    finally:
        os.close(fd)


def bridge_labels(bridge: dict[str, Any]) -> dict[str, str]:
    labels = bridge["Spec"].get("Labels", {})
    if not isinstance(labels, dict):
        raise BridgeError("Bridge labels have an unexpected format")
    if labels in ({"traefik.enable": "false"}, ROUTE_LABELS | {"traefik.enable": "false"}):
        return labels
    if labels != ROUTE_LABELS:
        raise BridgeError("Bridge Traefik labels differ from the reviewed route")
    return labels


def validate_bridge(bridge: dict[str, Any], expected_env: dict[str, str], networks: set[str]) -> str:
    spec = bridge["Spec"]
    task = spec.get("TaskTemplate", {})
    container = task.get("ContainerSpec", {})
    if spec.get("Name") != BRIDGE:
        raise BridgeError("Bridge service identity changed")
    image_sha = validate_image(container.get("Image", ""))
    if spec.get("Mode", {}).get("Replicated", {}).get("Replicas") not in (1, 2):
        raise BridgeError("Bridge replica count must be one or two")
    if parse_env(spec) != expected_env:
        raise BridgeError("Bridge environment differs from source plus worker overrides")
    if container.get("Secrets") or container.get("Mounts") or container.get("Configs"):
        raise BridgeError("Bridge unexpectedly has a mount, config, or secret")
    if network_targets(bridge) != networks:
        raise BridgeError("Bridge networks changed")
    if spec.get("EndpointSpec", {}).get("Ports"):
        raise BridgeError("Bridge unexpectedly publishes a port")
    bridge_labels(bridge)
    return image_sha


def running_container_ids(service: str) -> list[str]:
    return docker(
        "ps", "--filter", f"label=com.docker.swarm.service.name={service}", "--format", "{{.ID}}"
    ).splitlines()


def task_ids(service: str) -> set[str]:
    return set(
        docker("service", "ps", service, "--filter", "desired-state=running", "-q", "--no-trunc").splitlines()
    )


def require_healthy(service: dict[str, Any], expected_release: str | None = None) -> None:
    name = service["Spec"]["Name"]
    replicas = service["Spec"].get("Mode", {}).get("Replicated", {}).get("Replicas")
    containers = running_container_ids(name)
    if not isinstance(replicas, int) or len(containers) != replicas or len(task_ids(name)) != replicas:
        raise BridgeError(f"Service does not have all replicas running: {name}")
    for container_id in containers:
        items = docker_json("inspect", container_id)
        state = items[0].get("State", {}) if isinstance(items, list) and len(items) == 1 else {}
        if not state.get("Running") or state.get("Health", {}).get("Status") != "healthy":
            raise BridgeError(f"Service has a task that is not healthy: {name}")
        if expected_release is not None:
            try:
                ready = json.loads(docker("exec", container_id, "wget", "-q", "-O", "-", "http://127.0.0.1:8081/readyz"))
            except json.JSONDecodeError as exc:
                raise BridgeError("Bridge /readyz returned invalid JSON") from exc
            if ready.get("status") != "ready" or ready.get("release") != expected_release:
                raise BridgeError("Bridge /readyz is not ready on the expected release")


def ensure_no_other_bridge() -> None:
    if inspect_service(PORTAINER_BRIDGE, required=False) is not None:
        raise BridgeError("The Portainer bridge already exists; choose one rollout path")


def plan(image: str, replicas: int) -> tuple[dict[str, str], set[str]]:
    validate_image(image)
    if replicas not in (1, 2):
        raise BridgeError("Bridge replica count must be one or two")
    source = inspect_service(SOURCE)
    assert source is not None
    env, networks = validate_source(source)
    validate_traefik(inspect_network("public"))
    ensure_no_other_bridge()
    if inspect_service(BRIDGE, required=False) is not None:
        raise BridgeError("CLI bridge already exists; inspect it with status")
    require_healthy(source)
    print(f"DRY RUN: source={SOURCE}, bridge={BRIDGE}, replicas={replicas}, image={image}")
    print(f"Environment keys copied in memory: {len(env)}; workers=false; recording-only=false")
    print("Networks: vimob, public; published ports: none; Traefik: disabled")
    return env, networks


def create(image: str, replicas: int, dry_run: bool) -> None:
    env, _ = plan(image, replicas)
    if dry_run:
        return
    with environment_memfd(env) as fd:
        docker(
            "service", "create", "--detach=true", "--name", BRIDGE,
            "--replicas", str(replicas), "--network", "vimob", "--network", "public",
            "--env-file", f"/proc/self/fd/{fd}",
            "--label", "traefik.enable=false", "--limit-memory", "768m",
            "--reserve-memory", "128m", "--restart-condition", "any",
            image, pass_fds=(fd,),
        )
    print(f"Created {BRIDGE} with Traefik disabled. Run status, then enable after readiness checks.")


def status() -> None:
    source = inspect_service(SOURCE)
    assert source is not None
    env, networks = validate_source(source)
    bridge = inspect_service(BRIDGE, required=False)
    if bridge is None:
        print("Bridge: absent; source API configuration is recognized")
        return
    release = validate_bridge(bridge, env, networks)
    enabled = bridge_labels(bridge).get("traefik.enable") == "true"
    print(f"Bridge: present; replicas={bridge['Spec']['Mode']['Replicated']['Replicas']}; route_enabled={enabled}; release={release}")
    try:
        require_healthy(bridge, release)
    except BridgeError as exc:
        print(f"Health: not ready ({exc})")
    else:
        print("Health: all bridge tasks healthy; /readyz reports the pinned release")


def update_route(enable: bool) -> None:
    bridge = inspect_service(BRIDGE)
    assert bridge is not None
    source_before = inspect_service(SOURCE)
    assert source_before is not None
    source_task_before = source_before["Spec"].get("TaskTemplate")
    source_ids_before = task_ids(SOURCE)
    if not enable:
        before_task = bridge["Spec"].get("TaskTemplate")
        before_ids = task_ids(BRIDGE)
        docker("service", "update", "--detach=true", "--label-add", "traefik.enable=false", BRIDGE)
        after = inspect_service(BRIDGE)
        assert after is not None
        source_after = inspect_service(SOURCE)
        assert source_after is not None
        if (after["Spec"].get("TaskTemplate") != before_task or task_ids(BRIDGE) != before_ids
                or source_after["Spec"].get("TaskTemplate") != source_task_before
                or task_ids(SOURCE) != source_ids_before):
            raise BridgeError("Route disabled, but bridge task identity changed; inspect Swarm")
        print("Bridge route disabled; production API service was not updated")
        return

    source = source_before
    env, networks = validate_source(source)
    validate_traefik(inspect_network("public"))
    ensure_no_other_bridge()
    release = validate_bridge(bridge, env, networks)
    if bridge_labels(bridge).get("traefik.enable") == "true":
        raise BridgeError("Bridge route is already enabled")
    require_healthy(source)
    require_healthy(bridge, release)
    before_task = bridge["Spec"].get("TaskTemplate")
    before_ids = task_ids(BRIDGE)
    label_args = [item for key, value in ROUTE_LABELS.items() for item in ("--label-add", f"{key}={value}")]
    docker("service", "update", "--detach=true", *label_args, BRIDGE)
    after = inspect_service(BRIDGE)
    assert after is not None
    try:
        source_after = inspect_service(SOURCE)
        assert source_after is not None
        if (after["Spec"].get("TaskTemplate") != before_task or task_ids(BRIDGE) != before_ids
                or source_after["Spec"].get("TaskTemplate") != source_task_before
                or task_ids(SOURCE) != source_ids_before):
            raise BridgeError("Label update changed bridge tasks")
        validate_bridge(after, env, networks)
    except BridgeError:
        # Emergency rollback only changes a service label, never the source API.
        docker("service", "update", "--detach=true", "--label-add", "traefik.enable=false", BRIDGE)
        raise
    print("Bridge webhook route enabled; source API task was not updated")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("plan", "create"):
        command = commands.add_parser(name)
        command.add_argument("--image", required=True, help="Pinned GHCR API image with commit tag and digest")
        command.add_argument("--replicas", type=int, default=1, choices=(1, 2))
        if name == "create":
            command.add_argument("--dry-run", action="store_true")
    for name in ("status", "enable", "disable"):
        commands.add_parser(name)
    args = parser.parse_args()
    try:
        if args.command == "plan":
            plan(args.image, args.replicas)
        elif args.command == "create":
            create(args.image, args.replicas, args.dry_run)
        elif args.command == "status":
            status()
        elif args.command == "enable":
            update_route(True)
        else:
            update_route(False)
    except BridgeError as exc:
        print(f"HOLD: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
