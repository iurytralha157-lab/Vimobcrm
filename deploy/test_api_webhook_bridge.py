"""Local, Docker-free safety checks for api-webhook-bridge.py."""

import os
import runpy
import subprocess
import unittest
from pathlib import Path
from unittest import mock


bridge = runpy.run_path(str(Path(__file__).with_name("api-webhook-bridge.py")))


class BridgeSafetyTests(unittest.TestCase):
    def test_environment_copy_overrides_only_worker_gates(self):
        source = {
            "Spec": {
                "TaskTemplate": {
                    "ContainerSpec": {
                        "Env": [
                            "API_ENV=production",
                            "API_BACKGROUND_WORKERS_ENABLED=true",
                            "WHATSAPP_WEBHOOK_PROCESSOR_MODE=native",
                            "DATABASE_URL=postgres://user:private@host/db",
                            "SUPABASE_PROJECT_URL=https://supabase.example",
                            "EVOLUTION_GO_API_URL=https://evo.example",
                            "OTHER_SECRET=has=equals",
                        ]
                    }
                }
            }
        }
        env = bridge["expected_bridge_env"](source)
        self.assertEqual(env["API_BACKGROUND_WORKERS_ENABLED"], "false")
        self.assertEqual(env["API_WHATSAPP_CALL_RECORDING_ONLY_WORKER_ENABLED"], "false")
        self.assertEqual(env["OTHER_SECRET"], "has=equals")

    def test_environment_file_rejects_multiline_and_duplicate_values(self):
        for entries in (["TOKEN=first", "TOKEN=second"], ["TOKEN=first\nsecond"]):
            with self.subTest(entries=entries):
                with self.assertRaises(bridge["BridgeError"]):
                    bridge["parse_env"]({"TaskTemplate": {"ContainerSpec": {"Env": entries}}})

    def test_labels_allow_disabled_recovery_but_reject_broad_route(self):
        labels = bridge["ROUTE_LABELS"]
        for known in ({"traefik.enable": "false"}, labels | {"traefik.enable": "false"}, labels):
            self.assertEqual(bridge["bridge_labels"]({"Spec": {"Labels": known}}), known)
        with self.assertRaises(bridge["BridgeError"]):
            bridge["bridge_labels"]({"Spec": {"Labels": labels | {
                f"traefik.http.routers.{bridge['ROUTER']}.rule": "Host(`api.vimobcrm.com.br`)"
            }}})

    def test_image_must_be_immutable_and_from_expected_repository(self):
        sha = "a" * 40
        image = f"ghcr.io/iurytralha157-lab/vimob-crm-api:{sha}@sha256:{'b' * 64}"
        self.assertEqual(bridge["validate_image"](image), sha)
        for invalid in (image.split("@", 1)[0], image.replace("vimob-crm-api", "other-api")):
            with self.assertRaises(bridge["BridgeError"]):
                bridge["validate_image"](invalid)

    def test_docker_failure_does_not_echo_secret_stderr(self):
        failure = subprocess.CalledProcessError(1, ["docker", "service", "create"], stderr="TOKEN=secret-value")
        with mock.patch.object(bridge["subprocess"], "run", side_effect=failure):
            with self.assertRaises(bridge["BridgeError"]) as caught:
                bridge["docker"]("service", "create")
        self.assertNotIn("secret-value", str(caught.exception))

    @unittest.skipUnless(hasattr(os, "memfd_create"), "Linux memfd is required")
    def test_environment_memfd_is_inherited_without_disk_file(self):
        with bridge["environment_memfd"]({"TOKEN": "private"}) as fd:
            result = subprocess.run(
                ["cat", f"/proc/self/fd/{fd}"],
                check=True,
                capture_output=True,
                text=True,
                pass_fds=(fd,),
            )
            self.assertEqual(result.stdout, "TOKEN=private\n")


if __name__ == "__main__":
    unittest.main()
