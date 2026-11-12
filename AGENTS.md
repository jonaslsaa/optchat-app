# OptChat app

The app for pi-optchat. `README.md` has the design, `docs/server.md` the server and its protocol.

- **Layout:** `src/protocol.ts` is the one schema between server and UI (typebox; types are inferred from it, and it imports nothing from Node). `src/client.ts` is the typed client. `src/server/` is the Node server.
- **A client, never a second brain.** Memory is read through `pi-optchat/core`; agents run in `pi --mode rpc`. `src/server/disk.ts` is the only file that knows pi-optchat's files, and nothing here writes a profile.
- **Plain TypeScript on Node**, run without a build step (`node file.ts`), so only erasable syntax: no enums, no parameter properties. No `any`. npm, `node --test`, the fewest dependencies that do the job.
- **When unsure how to solve something, look at T3 Code first** (`~/Downloads/t3code`, MIT, read-only) and take its solution where it fits: components and solutions, not its thread-per-task architecture, Effect or monorepo. Code copied from it gets an entry in `THIRD_PARTY_NOTICES.md`.
- **Safety:** tests and every manual run use a throwaway `OPTCHAT_HOME` under `/tmp` (`test/support.ts`). Never open, lock or write the real `~/.optchat`, and kill only processes you started.
- `npm run check`, `npm test`, and `npm run test:live` for real turns through Pi (`PI_OPTCHAT=<checkout>` to run a pi-optchat checkout).
