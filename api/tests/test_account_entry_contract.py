from __future__ import annotations

import os
from pathlib import Path
import subprocess
import time
from typing import Any
from uuid import uuid4

import pytest
import requests
import yaml


ROOT = Path(__file__).parent
SPEC_PATH = ROOT / "account-entry.yaml"
PROJECT_ROOT = ROOT.parent.parent


def read_path(data: dict[str, Any], dotted_path: str) -> Any:
    current: Any = data
    for part in dotted_path.split("."):
        current = current[part]
    return current


def render_templates(value: Any, run_id: str) -> Any:
    if isinstance(value, str):
        return value.format(run_id=run_id)
    if isinstance(value, list):
        return [render_templates(item, run_id) for item in value]
    if isinstance(value, dict):
        return {key: render_templates(item, run_id) for key, item in value.items()}
    return value


@pytest.fixture(scope="session")
def contract() -> dict[str, Any]:
    with SPEC_PATH.open("r", encoding="utf-8") as handle:
        loaded = yaml.safe_load(handle)
    assert isinstance(loaded, dict)
    return loaded


@pytest.fixture(scope="session")
def failure_server(contract: dict[str, Any]) -> str:
    base_url = contract["failure_base_url"]
    environment = os.environ.copy()
    environment.update(
        {
            "DATABASE_URL": "postgres://shareslices:shareslices@127.0.0.1:5432/shareslices",
            "BETTER_AUTH_SECRET": "contract-fixture-secret-at-least-32-bytes",
            "BETTER_AUTH_URL": base_url,
            "WEB_ORIGIN": "http://127.0.0.1:5173",
            "PORT": "7457",
            "NODE_ENV": "test",
        }
    )
    process = subprocess.Popen(
        [
            "mise",
            "exec",
            "--",
            "pnpm",
            "--dir",
            "api",
            "exec",
            "tsx",
            "tests/contract-failure-server.ts",
        ],
        cwd=PROJECT_ROOT,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if process.poll() is not None:
                output = process.stdout.read() if process.stdout else ""
                raise RuntimeError(f"Failure server exited before startup:\n{output}")
            try:
                response = requests.get(f"{base_url}/health", timeout=0.25)
                if response.status_code == 200:
                    break
            except requests.RequestException:
                time.sleep(0.05)
        else:
            raise RuntimeError("Failure server did not become ready within 10 seconds")

        yield base_url
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def test_account_entry_contract(contract: dict[str, Any], failure_server: str) -> None:
    rendered_contract = render_templates(contract, uuid4().hex[:8])
    default_base_url = rendered_contract["base_url"]
    saved: dict[str, Any] = {}
    cookies: dict[str, requests.cookies.RequestsCookieJar] = {}
    responses: dict[str, dict[str, Any]] = {}

    with requests.Session() as session:
        session.trust_env = False
        for case in rendered_contract["cases"]:
            request_spec = case["request"]
            method = request_spec["method"].lower()
            base_url = failure_server if case.get("server") == "failure" else default_base_url
            url = f"{base_url}{request_spec['path']}"
            request_cookies = None

            if "cookie_ref" in request_spec:
                request_cookies = cookies[request_spec["cookie_ref"]]

            response = session.request(
                method,
                url,
                json=request_spec.get("json"),
                cookies=request_cookies,
                timeout=10,
            )

            expect = case["expect"]
            assert response.status_code == expect["status"], case["id"]

            if expect.get("set_cookie"):
                assert response.headers.get("set-cookie"), case["id"]

            if expect.get("no_set_cookie"):
                assert response.headers.get("set-cookie") is None, case["id"]

            body = response.json()

            if "json" in expect:
                assert body == expect["json"], case["id"]

            for path, expected_value in expect.get("json_paths", {}).items():
                assert read_path(body, path) == expected_value, case["id"]

            if "same_error_as" in expect:
                other = responses[expect["same_error_as"]]
                assert body["error"]["code"] == other["error"]["code"], case["id"]
                assert body["error"]["message"] == other["error"]["message"], case["id"]

            for name, path in case.get("save", {}).items():
                saved[name] = read_path(body, path)

            if "save_cookie" in case:
                cookies[case["save_cookie"]] = response.cookies.copy()

            responses[case["id"]] = body

    assert saved["user_id"]
