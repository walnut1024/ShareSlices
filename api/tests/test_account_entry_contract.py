from __future__ import annotations

from contextlib import ExitStack
import os
from pathlib import Path
import re
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


def runtime_setting(name: str, default: str) -> str:
    return os.environ.get(name, default)


def replace_string(value: Any, old: str, new: str) -> Any:
    if isinstance(value, str):
        return value.replace(old, new)
    if isinstance(value, list):
        return [replace_string(item, old, new) for item in value]
    if isinstance(value, dict):
        return {key: replace_string(item, old, new) for key, item in value.items()}
    return value


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


def substitute_runtime_values(value: Any, saved: dict[str, Any], mailpit_code: str | None = None) -> Any:
    if isinstance(value, str):
        if value == "$mailpit_code":
            assert mailpit_code is not None
            return mailpit_code
        if value.startswith("$saved."):
            return saved[value.removeprefix("$saved.")]
        result = value
        for name, saved_value in saved.items():
            result = result.replace(f"$saved.{name}", str(saved_value))
        return result
    if isinstance(value, list):
        return [substitute_runtime_values(item, saved, mailpit_code) for item in value]
    if isinstance(value, dict):
        return {key: substitute_runtime_values(item, saved, mailpit_code) for key, item in value.items()}
    return value


def wait_for_mailpit_code(mailpit_url: str, email: str, subject: str) -> str:
    deadline = time.monotonic() + 30
    query = f'to:"{email}" subject:"{subject}"'
    while time.monotonic() < deadline:
        response = requests.get(
            f"{mailpit_url}/view/latest.txt",
            params={"query": query},
            timeout=1,
        )
        if response.status_code == 200:
            match = re.search(r"\b\d{6}\b", response.text)
            if match:
                return match.group(0)
        time.sleep(0.1)
    raise AssertionError(f"Mailpit did not receive a six-digit code for {email}")


@pytest.fixture(scope="session")
def contract() -> dict[str, Any]:
    with SPEC_PATH.open("r", encoding="utf-8") as handle:
        loaded = yaml.safe_load(handle)
    assert isinstance(loaded, dict)
    loaded["base_url"] = runtime_setting("SHARESLICES_ACCOUNT_DEFAULT_URL", loaded["base_url"])
    loaded["failure_base_url"] = runtime_setting("SHARESLICES_ACCOUNT_FAILURE_URL", loaded["failure_base_url"])
    loaded["smtp_base_url"] = runtime_setting("SHARESLICES_ACCOUNT_SMTP_URL", loaded["smtp_base_url"])
    loaded["mailpit_url"] = runtime_setting("SHARESLICES_TEST_MAILPIT_URL", loaded["mailpit_url"])
    return replace_string(
        loaded,
        "http://127.0.0.1:5173",
        runtime_setting("SHARESLICES_TEST_WEB_ORIGIN", "http://127.0.0.1:5173"),
    )


@pytest.fixture(scope="session")
def failure_server(contract: dict[str, Any]) -> str:
    base_url = contract["failure_base_url"]
    environment = os.environ.copy()
    environment.update(
        {
            "DATABASE_URL": runtime_setting("SHARESLICES_TEST_DATABASE_URL", "postgres://shareslices:shareslices@127.0.0.1:5432/shareslices_test"),
            "BETTER_AUTH_SECRET": "contract-fixture-secret-at-least-32-bytes",
            "BETTER_AUTH_URL": base_url,
            "WEB_ORIGIN": runtime_setting("SHARESLICES_TEST_WEB_ORIGIN", "http://127.0.0.1:5173"),
            "API_ORIGIN": base_url,
            "VIEWER_ORIGIN": base_url,
            "S3_ENDPOINT": runtime_setting("SHARESLICES_TEST_S3_ENDPOINT", "http://127.0.0.1:9000"),
            "S3_REGION": "us-east-1",
            "S3_BUCKET": "shareslices-artifacts",
            "S3_ACCESS_KEY_ID": "shareslices",
            "S3_SECRET_ACCESS_KEY": "shareslices-local-secret",
            "S3_FORCE_PATH_STYLE": "true",
            "WORKER_JOB_POLL_INTERVAL_MS": "1000",
            "WORKER_JOB_LEASE_SECONDS": "30",
            "WORKER_JOB_HEARTBEAT_SECONDS": "10",
            "WORKER_JOB_MAX_ATTEMPTS": "3",
            "CONTENT_FINGERPRINT_KEY_CURRENT": "contract-content-fingerprint-key-at-least-32-bytes",
            "CONTENT_FINGERPRINT_KEY_CURRENT_REVISION": "key-v1",
            "IDEMPOTENCY_ENCRYPTION_KEY_CURRENT": "contract-idempotency-encryption-key-at-least-32-bytes",
            "IDEMPOTENCY_ENCRYPTION_KEY_CURRENT_REVISION": "key-v1",
            "CONTENT_IDENTITY_REVISION": "content-v1",
            "ARTIFACT_PROCESSING_REVISION": "processing-v1",
            "ARTIFACT_RENDERER_REVISION": "renderer-v2",
            "MINIMUM_CLI_VERSION": "0.1.0",
            "REQUIRE_EMAIL_VERIFICATION": "false",
            "AUTH_EMAIL_ENCRYPTION_KEY": "contract-email-encryption-key-at-least-32-bytes",
            "AUTH_EMAIL_SMTP_URL": runtime_setting("SHARESLICES_TEST_SMTP_URL", "smtp://127.0.0.1:1025"),
            "AUTH_EMAIL_FROM": "ShareSlices <no-reply@shareslices.local>",
            "AUTH_EMAIL_RETRY_DELAY_SECONDS": "1",
            "PORT": base_url.rsplit(":", 1)[1],
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


@pytest.fixture(scope="session")
def live_servers(contract: dict[str, Any]) -> dict[str, str]:
    mailpit_url = contract["mailpit_url"]
    response = requests.get(f"{mailpit_url}/readyz", timeout=2)
    assert response.status_code == 200, "Mailpit is not ready"
    subprocess.run(
        [
            "docker", "compose", "exec", "-T", "postgres", "psql", "-U", "shareslices", "-d", "shareslices_test",
            "-c", "delete from authentication_email_delivery; delete from password_reset_grant; delete from email_verification_attempt; update authentication_email_circuit_breaker set state = 'closed', reason_code = null, opened_at = null, resume_at = null;",
        ],
        cwd=PROJECT_ROOT,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    processes: list[subprocess.Popen[str]] = []

    for name, verification in [("default", "false"), ("smtp", "true")]:
        base_url = contract["base_url"] if name == "default" else contract["smtp_base_url"]
        port = base_url.rsplit(":", 1)[1]
        environment = os.environ.copy()
        environment.update(
            {
                "DATABASE_URL": runtime_setting("SHARESLICES_TEST_DATABASE_URL", "postgres://shareslices:shareslices@127.0.0.1:5432/shareslices_test"),
                "BETTER_AUTH_SECRET": "contract-live-secret-at-least-32-bytes",
                "BETTER_AUTH_URL": base_url,
                "WEB_ORIGIN": runtime_setting("SHARESLICES_TEST_WEB_ORIGIN", "http://127.0.0.1:5173"),
                "API_ORIGIN": base_url,
                "VIEWER_ORIGIN": base_url,
                "S3_ENDPOINT": runtime_setting("SHARESLICES_TEST_S3_ENDPOINT", "http://127.0.0.1:9000"),
                "S3_REGION": "us-east-1",
                "S3_BUCKET": "shareslices-artifacts",
                "S3_ACCESS_KEY_ID": "shareslices",
                "S3_SECRET_ACCESS_KEY": "shareslices-local-secret",
                "S3_FORCE_PATH_STYLE": "true",
                "WORKER_JOB_POLL_INTERVAL_MS": "1000",
                "WORKER_JOB_LEASE_SECONDS": "30",
                "WORKER_JOB_HEARTBEAT_SECONDS": "10",
                "WORKER_JOB_MAX_ATTEMPTS": "3",
                "CONTENT_FINGERPRINT_KEY_CURRENT": "contract-content-fingerprint-key-at-least-32-bytes",
                "CONTENT_FINGERPRINT_KEY_CURRENT_REVISION": "key-v1",
                "IDEMPOTENCY_ENCRYPTION_KEY_CURRENT": "contract-idempotency-encryption-key-at-least-32-bytes",
                "IDEMPOTENCY_ENCRYPTION_KEY_CURRENT_REVISION": "key-v1",
                "CONTENT_IDENTITY_REVISION": "content-v1",
                "ARTIFACT_PROCESSING_REVISION": "processing-v1",
                "ARTIFACT_RENDERER_REVISION": "renderer-v2",
                "MINIMUM_CLI_VERSION": "0.1.0",
                "REQUIRE_EMAIL_VERIFICATION": verification,
                "AUTH_EMAIL_ENCRYPTION_KEY": "contract-email-encryption-key-at-least-32-bytes",
                "AUTH_EMAIL_SMTP_URL": runtime_setting("SHARESLICES_TEST_SMTP_URL", "smtp://127.0.0.1:1025"),
                "AUTH_EMAIL_FROM": "ShareSlices <no-reply@shareslices.local>",
                "AUTH_EMAIL_RETRY_DELAY_SECONDS": "1",
                "PORT": port,
                "NODE_ENV": "test",
            }
        )
        process = subprocess.Popen(
            ["mise", "exec", "--", "pnpm", "--dir", "api", "exec", "tsx", "src/main.ts"],
            cwd=PROJECT_ROOT,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        processes.append(process)

    try:
        for base_url, process in zip([contract["base_url"], contract["smtp_base_url"]], processes, strict=True):
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    output = process.stdout.read() if process.stdout else ""
                    raise RuntimeError(f"Live API exited before startup:\n{output}")
                try:
                    if requests.get(f"{base_url}/health", timeout=0.25).status_code == 200:
                        break
                except requests.RequestException:
                    time.sleep(0.05)
            else:
                raise RuntimeError(f"Live API did not become ready at {base_url}")
        yield {"default": contract["base_url"], "smtp": contract["smtp_base_url"], "mailpit": mailpit_url}
    finally:
        for process in processes:
            process.terminate()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def test_account_entry_contract(
    contract: dict[str, Any], failure_server: str, live_servers: dict[str, str]
) -> None:
    rendered_contract = render_templates(contract, uuid4().hex[:8])
    default_base_url = rendered_contract["base_url"]
    saved: dict[str, Any] = {}
    cookies: dict[str, requests.cookies.RequestsCookieJar] = {}
    responses: dict[str, dict[str, Any]] = {}

    with ExitStack() as stack:
        clients: dict[str, requests.Session] = {}

        def browser(name: str) -> requests.Session:
            if name not in clients:
                clients[name] = stack.enter_context(requests.Session())
                clients[name].trust_env = False
            return clients[name]

        for case in rendered_contract["cases"]:
            request_spec = case["request"]
            method = request_spec["method"].lower()
            server = case.get("server", "default")
            base_url = failure_server if server == "failure" else live_servers[server]
            mailpit_code = None
            if "mailpit_code_for" in request_spec:
                mailpit_code = wait_for_mailpit_code(
                    live_servers["mailpit"],
                    request_spec["mailpit_code_for"],
                    request_spec["mailpit_subject"],
                )
            runtime_request = substitute_runtime_values(request_spec, saved, mailpit_code)
            url = f"{base_url}{runtime_request['path']}"
            request_cookies = None
            session = browser(request_spec.get("client", "default"))

            if "cookie_ref" in request_spec:
                request_cookies = cookies[request_spec["cookie_ref"]]

            response = session.request(
                method,
                url,
                json=runtime_request.get("json"),
                cookies=request_cookies,
                headers=runtime_request.get("headers"),
                timeout=10,
            )

            expect = case["expect"]
            assert response.status_code == expect["status"], case["id"]

            if expect.get("set_cookie"):
                assert response.headers.get("set-cookie"), case["id"]

            if expect.get("no_set_cookie"):
                assert response.headers.get("set-cookie") is None, case["id"]

            for name, value in expect.get("headers", {}).items():
                assert response.headers.get(name) == value, case["id"]

            set_cookie_values = response.raw.headers.getlist("Set-Cookie")
            if "set_cookie_count" in expect:
                assert len(set_cookie_values) == expect["set_cookie_count"], case["id"]

            for value in expect.get("set_cookie_each_contains", []):
                assert set_cookie_values, case["id"]
                assert all(value in cookie for cookie in set_cookie_values), case["id"]

            for value in expect.get("set_cookie_contains", []):
                assert any(value in cookie for cookie in set_cookie_values), case["id"]

            for name in expect.get("cookies_absent", []):
                assert session.cookies.get(name) is None, case["id"]

            if expect.get("empty_body"):
                assert response.content == b"", case["id"]
                body: dict[str, Any] = {}
            else:
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
