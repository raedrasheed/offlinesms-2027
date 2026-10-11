# Shipped local-DB schema snapshots

`vN/schema.ts` + `vN/migrations.ts` are byte-for-byte copies of
`src/localdb/{schema,migrations}.ts` at the last commit where
`SCHEMA_VERSION` was N — i.e. exactly what an existing user on that version
has on their phone:

| Version | Commit | Note |
|---|---|---|
| v1 | 36ed698 | first local DB |
| v2 | 7dbd809 | reactions + receipt counts |
| v3 | 9740e15 | media columns |
| v4 | d7721c9 | external members |
| v5 | 2a61167 | reply snapshot + mentions — **current production (app 2.3.18, main)** |

Used by `__tests__/localdb/upgradeExistingUsers.sqlite.test.ts` to build each
historical database on real SQLite and upgrade it with today's app code.
Do not edit; add a new snapshot when a new schema version ships.
