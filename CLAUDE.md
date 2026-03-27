# Health Credit — Backend

## Product
Private health document sharing platform. Users upload health documents (STI results, vaccinations, blood work), generate expiring private links to share with others. Privacy-first: encrypted storage, granular sharing controls, auto-expiry.

**Sub-line: HC Trust** — sexual health vertical targeting dating contexts.

## Tech Stack
- Node.js + Express + TypeScript
- MongoDB + Mongoose
- JWT authentication
- S3-compatible object storage (for encrypted documents)
- Railway deployment

## Key Architecture
- `src/routes/` — Express route handlers
- `src/models/` — Mongoose schemas
- `src/middleware/` — auth, validation, error handling
- `src/services/` — business logic, storage, link generation
- `src/utils/` — helpers, crypto utilities

## API Design
- REST API
- All document blobs stored encrypted (server never sees plaintext)
- Expiring share links with configurable TTL and view limits
- Access audit log for every shared link view

## Anti-Goals
- No over-engineering — ship fast, iterate
- No server-side decryption (zero-knowledge — client handles all crypto)
- No verification claims in Phase 1
- No lab integrations in Phase 1

## Commands
```bash
npm install        # install deps
npm run dev        # local dev server with hot reload
npm run build      # compile TypeScript
npm run start      # production server
npm test           # run tests
```

## Deploy
Railway — auto-deploy on push to main.

## Related
- Frontend: https://github.com/wkliwk/health-credit-frontend
- Board: https://github.com/users/wkliwk/projects/7

## Decisions
Log non-obvious decisions in `decisions.jsonl` (one JSON object per line):
```json
{"date":"2026-03-27","decision":"Zero-knowledge encryption — server stores only encrypted blobs","reason":"Core privacy differentiator; server compromise does not expose user health data"}
```
