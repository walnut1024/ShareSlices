import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeRetirement,
  buildRetirementSequence,
  inspectReleaseInventory,
} from "./inventory.mjs";

const markers = { installation: "example", release: "release-2" };
const inventory = [
  { logicalId: "runtime/api", owner: "deployment-module", retention: "active" },
  { logicalId: "runtime/previous", owner: "deployment-module", retention: "rollback" },
  { logicalId: "postgresql/external", owner: "external-prerequisite", retention: "external" },
];

test("classifies matching resources, digest drift, and untrusted orphans", () => {
  const result = inspectReleaseInventory({
    inventory,
    ownershipMarkers: markers,
    observedResources: [
      {
        logicalId: "runtime/api",
        ownershipMarkers: markers,
        desiredDigest: "api-2",
        observedDigest: "api-1",
      },
      {
        logicalId: "runtime/previous",
        ownershipMarkers: { ...markers, installation: "another" },
      },
      { logicalId: "unknown/resource", ownershipMarkers: markers },
    ],
  });
  assert.deepEqual(result.known, ["runtime/api"]);
  assert.deepEqual(result.drift, [{
    logicalId: "runtime/api",
    desiredDigest: "api-2",
    observedDigest: "api-1",
  }]);
  assert.deepEqual(result.orphans, [
    { logicalId: "runtime/previous", reasonCode: "ownership_marker_mismatch" },
    { logicalId: "unknown/resource", reasonCode: "resource_absent_from_inventory" },
  ]);
});

test("retires only positively owned active resources outside rollback retention", () => {
  const result = inspectReleaseInventory({
    inventory,
    ownershipMarkers: markers,
    retainedRollbackIds: ["release-1"],
    observedResources: [
      {
        logicalId: "runtime/api",
        ownershipMarkers: markers,
        superseded: true,
        releaseId: "release-0",
        trafficAttached: true,
        scheduleAttached: true,
        scheduleSafetyWindowSeconds: 900,
      },
      {
        logicalId: "runtime/previous",
        ownershipMarkers: markers,
        superseded: true,
        releaseId: "release-1",
      },
      {
        logicalId: "postgresql/external",
        ownershipMarkers: markers,
        superseded: true,
      },
    ],
  });
  assert.deepEqual(result.retirementCandidates, [{
    logicalId: "runtime/api",
    trafficAttached: true,
    scheduleAttached: true,
    scheduleSafetyWindowSeconds: 900,
  }]);
});

test("orders traffic and schedule detachment before inactivity proof and removal", () => {
  assert.deepEqual(
    buildRetirementSequence({
      logicalId: "runtime/api",
      trafficAttached: true,
      scheduleAttached: true,
      scheduleSafetyWindowSeconds: 900,
    }),
    {
      logicalId: "runtime/api",
      scheduleSafetyWindowSeconds: 900,
      steps: [
        "detach_traffic",
        "detach_schedule",
        "wait_schedule_safety_window",
        "verify_inactive",
        "remove_owned_resource",
      ],
    },
  );
});

test("ordinary retirement refuses unowned and retained resources", () => {
  const result = {
    orphans: [{ logicalId: "unknown/resource" }],
    retirementCandidates: [{
      logicalId: "runtime/api",
      trafficAttached: false,
      scheduleAttached: false,
      scheduleSafetyWindowSeconds: 0,
    }],
  };
  assert.deepEqual(authorizeRetirement(result, "unknown/resource", { releaseVerified: true }), {
    authorized: false,
    reasonCode: "resource_ownership_unproven",
  });
  assert.deepEqual(authorizeRetirement(result, "postgresql/external", { releaseVerified: true }), {
    authorized: false,
    reasonCode: "resource_retirement_not_permitted",
  });
  assert.deepEqual(authorizeRetirement(result, "runtime/api"), {
    authorized: false,
    reasonCode: "replacement_release_not_verified",
  });
  assert.equal(authorizeRetirement(result, "runtime/api", { releaseVerified: true }).authorized, true);
});

test("refuses scheduled retirement without a qualified safety window", () => {
  const result = {
    orphans: [],
    retirementCandidates: [{
      logicalId: "runtime/jobs",
      trafficAttached: false,
      scheduleAttached: true,
      scheduleSafetyWindowSeconds: null,
    }],
  };
  assert.deepEqual(
    authorizeRetirement(result, "runtime/jobs", { releaseVerified: true }),
    { authorized: false, reasonCode: "retirement_safety_window_unknown" },
  );
});
