# Independent ShareSlices Skill release

Status: backlog

## Goal

Publish the official platform-neutral ShareSlices Skill through an independently authorized workflow after the manual CLI `0.2.0` release has proven the package and compatibility gates.

## Boundary

The workflow may package and publish the checked Skill artifact. It must not install the CLI, mutate local agent directories, contact the ShareSlices Server, change Server compatibility policy, or activate the Skill as a build side effect.

## Issues

- [01 - Add an independent Skill release workflow](./issues/01-independent-skill-release-workflow.md)
