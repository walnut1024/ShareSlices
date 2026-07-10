from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


OPENAPI_PATH = Path(__file__).parents[1] / "openapi" / "openapi.yaml"
ARTIFACT_PATHS = {
    "/api/artifact-upload-policies/current",
    "/api/artifacts",
    "/api/artifacts/{artifactId}",
    "/api/artifacts/{artifactId}/upload-sessions",
    "/api/upload-sessions/{uploadSessionId}:retry",
    "/api/versions/{versionId}/content/",
    "/api/versions/{versionId}/content/{assetPath}",
    "/api/artifacts/{artifactId}/publications",
    "/api/artifacts/{artifactId}/publications/{publicationId}",
    "/a/{shareSlug}/",
    "/a/{shareSlug}/{assetPath}",
}
ARTIFACT_OPERATIONS = {
    ("get", "/api/artifact-upload-policies/current"),
    ("get", "/api/artifacts"),
    ("post", "/api/artifacts"),
    ("get", "/api/artifacts/{artifactId}"),
    ("patch", "/api/artifacts/{artifactId}"),
    ("post", "/api/artifacts/{artifactId}/upload-sessions"),
    ("post", "/api/upload-sessions/{uploadSessionId}:retry"),
    ("get", "/api/versions/{versionId}/content/"),
    ("get", "/api/versions/{versionId}/content/{assetPath}"),
    ("post", "/api/artifacts/{artifactId}/publications"),
    ("delete", "/api/artifacts/{artifactId}/publications/{publicationId}"),
    ("get", "/a/{shareSlug}/"),
    ("get", "/a/{shareSlug}/{assetPath}"),
}


def resolve_local_ref(document: dict[str, Any], reference: str) -> Any:
    assert reference.startswith("#/"), reference
    current: Any = document
    for part in reference[2:].split("/"):
        current = current[part.replace("~1", "/").replace("~0", "~")]
    return current


def walk(value: Any) -> list[str]:
    if isinstance(value, dict):
        references = [value["$ref"]] if "$ref" in value else []
        return references + [ref for child in value.values() for ref in walk(child)]
    if isinstance(value, list):
        return [ref for child in value for ref in walk(child)]
    return []


def test_openapi_artifact_contract_and_local_references() -> None:
    document = yaml.safe_load(OPENAPI_PATH.read_text(encoding="utf-8"))

    assert document["openapi"] == "3.1.0"
    assert document["info"]["version"] == "0.0.1"
    assert ARTIFACT_PATHS <= document["paths"].keys()
    assert ARTIFACT_OPERATIONS == {
        (method, path)
        for path in ARTIFACT_PATHS
        for method in document["paths"][path]
        if method != "parameters"
    }

    for reference in walk(document):
        resolve_local_ref(document, reference)

    no_store = document["components"]["headers"]["NoStore"]["schema"]
    assert no_store["enum"] == ["no-store"]

    schemas = document["components"]["schemas"]
    assert schemas["UploadPolicyResponse"]["example"]["policy"] == {
        "revision": "v0.0.1-default",
        "maxArchiveBytes": 52_428_800,
        "maxExpandedBytes": 209_715_200,
        "maxFileCount": 1_000,
        "maxFileBytes": 52_428_800,
        "enabledExtensions": [".html", ".css", ".js", ".png"],
    }
    assert schemas["ArtifactAcceptedResponse"]["example"]["uploadSessionId"]
    assert schemas["Artifact"]["example"]["id"] == "artifact-example"
    assert schemas["PublicationResponse"]["example"]["publication"]["versionId"] == "version-example"
