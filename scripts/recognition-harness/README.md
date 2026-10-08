Test-only harness for `scripts/customer-recognition.test.mjs`.

It compiles the REAL `customer-recognition.service.ts` / `customer-contact.util.ts`
with `tsc` against minimal NestJS/Mongoose stand-ins (`stubs/`, `shims.d.ts`) and runs
them against an in-memory Customer model. It exists so the recognition logic can be
exercised where `pnpm install` / MongoDB are unavailable. It is NOT a substitute for
running the service against real MongoDB (see docs/PROGRESS.md, Part 1.7).
