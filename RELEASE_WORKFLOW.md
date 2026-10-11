# Release Workflow

This document describes the team workflow for creating releases under the new grouped-commit system.

## Daily Development

1. **Make changes** - Work on features/bugs in your branch
2. **Commit** - Commit changes to `main` via PR or direct commit
3. **No version bump** - Individual commits do NOT increment version

## Preparing a Release

### Step 1: Check Commits

```bash
# See what commits will be included
git log --oneline
```

### Step 2: Prepare Release

```bash
npm run prepare-release
```

This will:
- Show all commits since last release
- Display the new version number (current + 0.001)
- Generate release notes
- Update VERSION.md, package.json, CHANGELOG.md

### Step 3: Review Changes

```bash
# Check what files were modified
git status

# Review the changelog
git diff CHANGELOG.md
```

### Step 4: Commit and Tag

```bash
npm run release
```

This will:
- Commit version and changelog changes
- Create a Git tag (e.g., v0.170)
- Push to remote

## Release Checklist

- [ ] Run `npm run prepare-release`
- [ ] Review generated release notes
- [ ] Verify version number is correct
- [ ] Check CHANGELOG.md formatting
- [ ] Run `npm run release`
- [ ] Verify tag was created (`git tag -l`)
- [ ] Push tags to remote (`git push --tags`)

## Emergency Release

For hotfixes:

1. Make the fix commit(s) to main
2. Run `npm run prepare-release`
3. Run `npm run release`

The fix will be included in the next version with +0.001 bump.

## Version Correction

If a version needs to be corrected (e.g., wrong version in files):

1. Manually edit VERSION.md
2. Manually edit package.json
3. Commit with message: "fix: correct version to X.XXX"
4. Do NOT create a tag for version corrections

## Branch Protection

The `main` branch is protected. To push release changes:

```bash
# After npm run release, if push fails:
git push origin main
git push --tags origin main
```

## Automated Release (Future)

Consider setting up GitHub Actions to:
- Auto-run prepare-release on schedule
- Auto-create release PRs
- Auto-publish releases

## Troubleshooting

### "No new commits" message

This means no commits since last release. Either:
- Wait for more commits
- Make a new commit first

### Version not incrementing

Check:
- VERSION.md exists and is readable
- File permissions allow writing
- Current version format is correct (0.XXX)

### Git tag conflicts

```bash
# Delete local tag
git tag -d v0.XXX

# Delete remote tag
git push origin :refs/tags/v0.XXX
```
