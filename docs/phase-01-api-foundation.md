# Phase 1 API foundation

The goal of this phase is to run a TypeScript HTTP service and follow one request through the code. There are only two application source files. Most of the other files tell development tools how to run them.

## Why start here

FairGate will have a Next.js website and a backend that owns queue admission and bookings. Next.js will display the customer experience. The Node.js and Express service will enforce shared rules and later work with a background worker. Starting with that service gives us a small, visible result before adding infrastructure.

This phase has no database, authentication, seat reservations, or queue. Those capabilities should be added only when we can explain the foundation.

## Run it

Open a terminal in the FairGate folder:

```sh
npm install
npm run dev
```

Then visit `http://127.0.0.1:4000/health` in a browser. Keep the terminal running while using the API. Stop it with `Ctrl+C` when finished.

If the terminal reports `EADDRINUSE`, something is already listening on port 4000. Stop an earlier FairGate process, or change the `port` constant in `server.ts` and use that new port in the browser. The server listens on `127.0.0.1`, so this phase is reachable only from your own computer.

## Read the two source files first

### apps/api/src/app.ts

1. `import express from "express"` imports the Express library.
2. `express()` creates the object that handles incoming HTTP requests.
3. `export` makes that application available to another module.
4. `app.get("/health", ...)` registers a handler for a GET request with that path.
5. `_request` is the incoming request. We do not use it yet; the underscore communicates that intention.
6. `response.status(200).json(...)` sends a success status and a JSON response. Express sets the JSON content type.

The word `ok` means this handler responded. It does not prove that future dependencies such as Redis or PostgreSQL are healthy.

### apps/api/src/server.ts

This file imports the application, chooses port 4000, and starts listening for requests. The callback prints the address after the server starts listening.

We keep route definitions separate from startup because a later automated test can import `app` without automatically starting this particular server on port 4000.

The import says `./app.js` even though the source file is `app.ts`. Our NodeNext configuration resolves it during development and compilation, while the generated `dist/server.js` needs to import the generated `dist/app.js`. Keeping the `.js` extension makes the compiled modules work with Node's standard module rules.

## Follow one request

1. The browser sends `GET /health` to `127.0.0.1` on port 4000.
2. The server started by `server.ts` receives it and passes it to the Express application.
3. Express matches the HTTP method and path to the handler in `app.ts`.
4. The handler returns HTTP 200 and the `status` and `service` fields.
5. The browser displays the JSON response.

Try visiting `/something-else`. It returns HTTP 404 because we have not registered a matching route. Stopping the server produces a connection failure instead of an HTTP response; those are different situations.

## Understand the setup files

### Root package.json

The root package is private because we do not intend to publish it to npm. Its workspace points to `apps/api`, which is a package inside the same repository. Later, the frontend can become another workspace.

The root `dev` script forwards to the `dev` script in the package named `@fairgate/api`. The `@fairgate` prefix is a package naming scope; it does not require an npm account because this package is private and local.

The complete command chain is: root `npm run dev`, API workspace `dev`, `tsx watch src/server.ts`, then the server imports `app.ts`.

### apps/api/package.json

`express` is a runtime dependency: the compiled server needs it. TypeScript, `tsx`, and the `@types` packages are development dependencies.

- `typescript` provides `tsc`, the compiler and type checker.
- `tsx` runs TypeScript during development and restarts the process when source files change.
- `@types/express` and `@types/node` describe library and Node APIs to TypeScript. They do not add runtime behaviour.
- `"type": "module"` tells Node to treat generated `.js` files as ECMAScript modules, which use `import` and `export`.

Running through `tsx` does not replace type checking. We run `npm run typecheck` explicitly.

### apps/api/tsconfig.json

| Setting | Why it is present |
| --- | --- |
| `target: ES2022` | Selects the JavaScript language level emitted by the compiler. Our supported Node version can run it. |
| `module` and `moduleResolution: NodeNext` | Apply Node's module and import-resolution rules. |
| `rootDir: src` and `outDir: dist` | Identify the source folder and generated JavaScript folder. |
| `strict: true` | Enable stricter checks to catch mistakes before running the program. |
| `esModuleInterop: true` | Support the import style used with libraries such as Express. |
| `forceConsistentCasingInFileNames: true` | Catch import casing mistakes that may behave differently across operating systems. |
| `skipLibCheck: true` | Skip checking dependency declaration files; our application source is still checked. |
| `types: ["node"]` | Include Node's environment types rather than unrelated global types. |
| `include` | Limit the source files this compiler configuration includes. |

### Generated and ignored files

`package-lock.json` records the exact resolved dependency versions. Keep it in Git, but you do not need to read every generated entry. Once a lockfile exists, `npm ci` can install exactly that dependency set on another machine or in CI.

`node_modules` contains downloaded packages, and `dist` contains compiled JavaScript. Both are ignored by Git because they can be recreated. The ignore file also excludes local environment files and logs. There is no environment file in this phase.

`AGENTS.md` records our working agreement, including your control over commits and the pause after each learning phase.

## Check development and compiled code

Type checking and compilation are separate commands:

```sh
npm run typecheck
npm run build
```

Stop the development server, then run:

```sh
npm start
```

Open `/health` again. This time Node runs JavaScript from `dist`, rather than TypeScript through the development runner. Changing a source file requires another build before `npm start` will use that change.

## Your small exercise

With the development server running, add a `message` field to the JSON response in `app.ts`. Save the file and refresh `/health`. Observe the development server restart and the new response.

Then run the type checker. Decide whether you want to keep your new field or remove it before your commit. The exercise has intentionally not been completed for you.

## Review checkpoint

You should be comfortable explaining these questions in your own words:

- Which file defines the response, and which file starts listening?
- How does a command from the root reach the API workspace?
- Why is the import extension `.js` in a TypeScript source file?
- Why can the development server run even when a separate type check finds an error?
- What is the difference between HTTP 404 and a stopped server?
- Which files are generated, and which should you review and commit?

Only commit when the phase is clear to you. A possible message is `chore: add TypeScript API foundation`. We will stop here until you ask questions or say you are ready for the next phase.

## References

- [Express hello world](https://expressjs.com/en/starter/hello-world/)
- [TypeScript module reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html)
- [TypeScript configuration reference](https://www.typescriptlang.org/tsconfig/)
