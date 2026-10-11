# MeTiger-Ai Release System

## Overview

This document describes the new versioning system for MeTiger-Ai where **multiple commits are grouped into a single release**, with the version incrementing by **+0.001** only at release time, not per commit.

## Version Format

- Format: `0.XXX` where XXX is a 3-digit number
- Each release increments by **0.001** (e.g., 0.154 → 0.155)
- No version bump happens on individual commits

## Current Version

The current live version is **0.169** (as of 2026-10-11).

## How It Works

### 1. Development Phase
- Developers make commits to `main` branch as usual
- Each commit does NOT trigger a version bump
- Commits accumulate without version changes

### 2. Release Preparation
When ready to release:

```bash
npm run prepare-release
```

This script:
- Identifies all commits since the last release
- Groups them into a single release entry
- Increments version by +0.001
- Generates release notes
- Updates VERSION.md, package.json, and CHANGELOG.md

### 3. Release Commit

```bash
npm run release
```

This:
- Commits all version and changelog changes
- Creates a Git tag with the new version
- Pushes to remote

## File Structure

- `VERSION.md` - Contains the current version number
- `CHANGELOG.md` - Release history with grouped commits
- `.release-config.json` - Release system configuration
- `scripts/prepare-release.cjs` - Release preparation script

## Version History

| Version | Date | Commits Included |
|---------|------|------------------|
| 0.169 | 2026-10-11 | Latest |
| 0.168 | - | Previous |
| ... | ... | ... |

## Migration from Old System

Previously, each commit incremented the version by +0.001. Under the new system:
- Multiple commits are grouped into one release
- Only one version bump (+0.001) per release
- Release cadence is controlled, not automatic

## Benefits

1. **Cleaner version history** - Fewer version numbers
2. **Better release grouping** - Related commits released together
3. **Controlled releases** - Team decides when to release
4. **Simpler tracking** - Each version represents a meaningful set of changes

## Configuration

See `.release-config.json` for customization options:
- `changelogFile` - Path to changelog file
- `versionIncrement` - Version bump amount (default: 0.001)
- `groupCommits` - Whether to group commits (default: true)
- `releaseBranch` - Branch to release from (default: main)
- `tagPrefix` - Git tag prefix (default: v)
