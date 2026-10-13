# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/). The notes of the earlier
versions are in the GitHub Releases of the repository.

Describe each change under `## [Unreleased]` as you make it.

## [Unreleased]

### Changed

- The robots are refreshed every minute by the integration itself, as a safety
  net next to the real-time updates, instead of waiting for Gladys to ask: it
  keeps working whatever Gladys version polls them or not. Nothing to do on your
  side, and your devices and scenes stay as they are.
- Quieter logs: the account summary and the room reading of every robot are
  written once at startup, then only when they change, and a cloud or a robot
  that keeps failing is reported once, then once when it is back, instead of at
  every attempt.
- Built on version 0.15 of the Gladys integration SDK.

### Fixed

- The logs no longer show the cloud identifier of the robots: they name the
  robot instead.
