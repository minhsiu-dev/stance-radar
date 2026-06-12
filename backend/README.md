
## 2026-06-11 schema change
Added `mentions.context_before` and `mentions.context_after` (both nullable TEXT).
For local dev volumes already containing data, run once:

```sql
ALTER TABLE mentions ADD COLUMN context_before TEXT;
ALTER TABLE mentions ADD COLUMN context_after  TEXT;
```

Fresh DBs need no action — `Base.metadata.create_all` handles them.
