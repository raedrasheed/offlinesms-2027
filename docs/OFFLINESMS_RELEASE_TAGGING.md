# Release Tagging Guide

---

## Tag Naming Convention

```
v<major>.<minor>.<patch>
```

| Segment | When to increment |
|---|---|
| `major` | Breaking change to data model, auth flow, or public API |
| `minor` | New feature added in a backwards-compatible way |
| `patch` | Bug fix, copy change, documentation-only change |

Examples: `v1.0.0`, `v1.1.0`, `v1.0.3`

Pre-release tags (staging builds):
```
v1.0.0-rc.1   # release candidate 1
v1.0.0-beta.2 # beta 2
```

---

## Creating a Release Tag

```bash
# Ensure you are on main and up to date
git checkout main
git pull origin main

# Confirm the build is green
npm run validate

# Create an annotated tag
git tag -a v1.0.0 -m "Release v1.0.0 — controlled production rollout"

# Push the tag
git push origin v1.0.0
```

---

## Release Notes Template

```markdown
## v<X.Y.Z> — <Date>

### Summary
<One paragraph describing the release focus>

### Changes since <previous-tag>
- <Bullet list from git log --oneline <prev-tag>..HEAD>

### Deployment notes
- Firestore rules updated: <yes/no>
- Indexes updated: <yes/no>
- Functions updated: <yes/no>
- Dashboard updated: <yes/no>
- Environment variables added/changed: <list or "none">

### Known issues
- <List any known non-blocking issues, or "none">

### Rollback tag
If rollback is needed, redeploy from: `<previous-tag>`
```

---

## Rollback Tag Strategy

Before every production deploy, record the last stable tag:

```bash
# Record the current HEAD tag before deploying
git describe --tags --abbrev=0
# e.g.: v0.9.2
```

Keep this value in the deployment ticket or runbook entry.
If rollback is needed, redeploy each layer from the previous tag:

```bash
# Check out the previous stable tag
git checkout v0.9.2

# Redeploy functions, rules, and hosting from that tag
firebase deploy --only functions,firestore:rules,hosting
```

See `OFFLINESMS_ROLLBACK_RUNBOOK.md` for full rollback procedures.

---

## Tagging Schedule

| Milestone | Tag example |
|---|---|
| Staging release candidate | `v1.0.0-rc.1` |
| Production go-live | `v1.0.0` |
| Post-launch hotfix | `v1.0.1` |
| Minor feature release | `v1.1.0` |

---

## GitHub Release (optional)

After pushing the tag, create a GitHub Release for visibility:

```bash
gh release create v1.0.0 \
  --title "v1.0.0 — Controlled Production Rollout" \
  --notes-file RELEASE_NOTES_v1.0.0.md
```

Attach any build artifacts if required by the distribution process.
