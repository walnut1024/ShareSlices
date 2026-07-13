from __future__ import annotations

import base64
from io import BytesIO
from pathlib import Path
import time
from typing import Any
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile

import requests
import yaml


SPEC_PATH = Path(__file__).with_name("artifact-flow.yaml")


def read_path(data: Any, dotted_path: str) -> Any:
    current = data
    for part in dotted_path.split("."):
        current = current[int(part)] if isinstance(current, list) else current[part]
    return current


def render(value: Any, context: dict[str, Any]) -> Any:
    if isinstance(value, str):
        return value.format_map(context)
    if isinstance(value, list):
        return [render(item, context) for item in value]
    if isinstance(value, dict):
        return {key: render(item, context) for key, item in value.items()}
    return value


def build_archive(entries: dict[str, Any]) -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        for path, value in entries.items():
            if isinstance(value, dict):
                content = base64.b64decode(value["base64"])
            else:
                content = value.encode("utf-8")
            archive.writestr(path, content)
    return buffer.getvalue()


def response_json(response: requests.Response) -> Any:
    content_type = response.headers.get("content-type", "")
    return response.json() if "application/json" in content_type else None


def assert_response(case: dict[str, Any], response: requests.Response) -> None:
    expected = case["expect"]
    assert response.status_code == expected["status"], (
        f"{case['id']}: expected {expected['status']}, got {response.status_code}: {response.text[:500]}"
    )

    for name, value in expected.get("headers", {}).items():
        assert response.headers.get(name) == value, case["id"]

    body = response_json(response)
    for path, value in expected.get("json_paths", {}).items():
        assert read_path(body, path) == value, case["id"]
    for path in expected.get("json_absent_paths", []):
        try:
            read_path(body, path)
        except (KeyError, IndexError, TypeError):
            continue
        raise AssertionError(f"{case['id']}: expected {path} to be absent")

    if "body_contains" in expected:
        assert expected["body_contains"] in response.text, case["id"]


def run_contract(spec_path: Path = SPEC_PATH) -> None:
    with spec_path.open("r", encoding="utf-8") as handle:
        contract = yaml.safe_load(handle)

    base_url = contract["base_url"]
    archives = {
        name: build_archive(entries) for name, entries in contract["archives"].items()
    }
    context: dict[str, Any] = {"run_id": uuid4().hex[:8]}
    cookies: dict[str, requests.cookies.RequestsCookieJar] = {}

    with requests.Session() as session:
        session.trust_env = False
        for raw_case in contract["cases"]:
            case = render(raw_case, context)
            request = case["request"]
            path = request["path"]
            url = path if path.startswith(("http://", "https://")) else f"{base_url}{path}"
            request_cookies = cookies.get(request.get("cookie_ref"))
            isolated_session = None
            requester = session
            if request.get("omit_session_cookies"):
                isolated_session = requests.Session()
                isolated_session.trust_env = False
                requester = isolated_session
            files = None
            data = None

            if multipart := request.get("multipart"):
                archive_name = multipart["archive"]
                files = {"file": (f"{archive_name}.zip", archives[archive_name], "application/zip")}
                data = {key: value for key, value in multipart.items() if key != "archive"}

            deadline = time.monotonic() + case.get("poll", {}).get("timeout_seconds", 0)
            while True:
                response = requester.request(
                    request["method"],
                    url,
                    json=request.get("json"),
                    data=data,
                    files=files,
                    headers=request.get("headers"),
                    cookies=request_cookies,
                    timeout=15,
                )
                poll = case.get("poll")
                if not poll or (
                    response.status_code == case["expect"]["status"]
                    and read_path(response_json(response), poll["json_path"])
                    == poll["equals"]
                ):
                    break
                if time.monotonic() >= deadline:
                    break
                time.sleep(0.25)

            if isolated_session is not None:
                isolated_session.close()

            assert_response(case, response)
            body = response_json(response)
            for name, path in case.get("save", {}).items():
                context[name] = read_path(body, path)
            if cookie_name := case.get("save_cookie"):
                cookies[cookie_name] = response.cookies.copy()


def test_artifact_flow_contract() -> None:
    run_contract()


if __name__ == "__main__":
    run_contract()
