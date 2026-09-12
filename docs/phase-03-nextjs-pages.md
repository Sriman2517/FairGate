# Phase 3: Next.js movie pages

## Outcome

FairGate now has a website that displays the data from our Express API. A customer can browse movies, open one movie, and read its showtimes and ticket prices. A movie without shows has an empty-state message. Missing pages and failed requests have different messages.

The new workspace is `apps/web`. This phase introduces Next.js, React, and TypeScript for the frontend. A single plain CSS file keeps styling easy to inspect; a styling framework is not needed for these two pages. The API's source files remain as they were in Phase 2.

## Run both apps

Run `npm install` from the repository root if you have not installed the new dependencies. Then use two terminals in that same folder:

```sh
# Terminal 1
npm run dev:api
```

```sh
# Terminal 2
npm run dev:web
```

Open `http://127.0.0.1:3000`. The API uses port 4000 and the web server uses port 3000. Each server has its own logs and can be stopped with `Ctrl+C` in its terminal. We use two terminals so you can see which process does each job.

`npm run dev` still starts only the API, preserving the earlier guides' command. It does not start both apps.

## Read the code in this order

1. `apps/web/src/lib/api.ts`: calls the existing API over HTTP.
2. `apps/web/src/app/page.tsx`: renders the movie list.
3. `apps/web/src/app/movies/[movieId]/page.tsx`: loads one movie and its shows.
4. `apps/web/src/app/layout.tsx`: wraps both pages in the shared header and footer.
5. `apps/web/src/app/not-found.tsx` and `error.tsx`: handle missing pages and failed requests.
6. `apps/web/src/app/globals.css`: styles the pages, including narrow screens and keyboard focus.

The root `package.json` registers `apps/web` as another npm workspace. Its commands delegate to the API or web workspace. The web `package.json` declares Next.js and React plus their TypeScript types. `tsconfig.json` configures Next.js compilation separately from the API's NodeNext configuration.

Next.js also generated `apps/web/AGENTS.md` and `CLAUDE.md` when its development server first ran here. They direct coding assistants to the documentation bundled with the installed framework. They are not part of the running website, and the root learning agreement still applies.

## Trace a request across the system

```text
Browser requests http://127.0.0.1:3000/
  -> Next.js runs src/app/page.tsx on the server
  -> getMovies() fetches http://127.0.0.1:4000/movies
  -> Express reads its in-memory movie array and returns JSON
  -> Next.js renders the movie list
  -> Browser displays the page
```

The `page.tsx` files are React Server Components by default. That is why they can be `async` functions and await API data before returning JSX. JSX is the HTML-like syntax React uses to describe the page; braces insert JavaScript values into it.

The movie list uses `movies.map(...)` to create one list item per movie. React's `key={movie.id}` gives each repeated item a stable identity. `Link` provides navigation between Next.js routes.

The browser does not call Express directly in this implementation. Next.js makes the API request from its server. Therefore these reads do not need browser CORS configuration. If we later move a request into browser code, we will revisit that boundary.

The frontend declares its own response types and never imports the API's fixture arrays. That keeps HTTP as the connection between the two apps. The small `Movie` and `Show` interfaces repeat the API contract for now; they must stay in sync. We can extract a shared contract when it has enough consumers to justify another package.

## Fetching data and handling failure

`api.ts` imports `server-only`, which makes accidental use from a Client Component a build error. Its API address comes from `FAIRGATE_API_URL`, with a local default. An optional `.env.local` belongs inside `apps/web`; restart Next.js after changing it. The example contains no secret.

The `request` function adds two fetch options:

- `cache: "no-store"` asks Next.js to fetch from the API instead of reusing its persistent data cache for this request.
- `AbortSignal.timeout(5000)` limits how long a request can wait before it fails.

This does not push updates to an already open browser tab. Reload the page to fetch changed fixtures. Client navigation and development behavior can also reuse route data; use a full reload for the exercise.

`fetch` does not throw just because a response has status `404` or `500`. We check the status explicitly before reading JSON. A network failure or timeout does throw. The helper functions let these failures reach Next.js's error boundary.

Our type annotations describe the expected JSON shape; they do not validate JSON at runtime. We control both sides of this small API today. Runtime schemas can be introduced when user input or external data makes them necessary.

## Dynamic routes and missing movies

The folder `movies/[movieId]` creates a dynamic route. When the browser visits `/movies/the-last-signal`, Next.js provides the value through `params`:

```ts
const { movieId } = await params;
```

In this Next.js version, `params` is a Promise. This differs from Express's synchronous `request.params` in Phase 2.

The page looks up the movie first. If the API returns `404`, `getMovie()` returns `null` and the page calls `notFound()`. That stops rendering and asks Next.js to show `not-found.tsx`. An unavailable API is not treated as a missing movie: network errors and server failures reach `error.tsx` instead.

Only after finding the movie do we request its shows. This adds a second sequential request, but makes the existence check straightforward to follow. We can revisit parallel fetching if measurements show the extra round trip matters.

An empty shows array is still successful data. The page displays **No shows scheduled yet** instead of an error.

## Dates, prices, and honest controls

The API stores UTC timestamps. `Intl.DateTimeFormat` formats them explicitly in `Asia/Kolkata`, and the page labels the timezone as IST. The display does not depend on the web server's local timezone.

The API stores prices in paise. The page divides by 100 and uses `Intl.NumberFormat` to display INR. `32000` paise becomes `₹320.00`. The `Show` contract currently supports only INR.

Showtimes are informational rows. They are not booking buttons yet, because we have not implemented seat holds or reservations. The footer identifies the fixtures as demo data. We have also kept poster artwork and visual effects outside this first frontend learning phase.

## Why error.tsx says "use client"

Next.js error boundaries must be Client Components. The retry button also needs a browser click handler, so `error.tsx` starts with `"use client"`.

Its handler calls `window.location.reload()`. This simple retry reloads the current URL and makes a new server request. It does not silently retry forever or show raw server error details to a customer. We can use more advanced recovery later if retaining browser state becomes important.

The other pages do not need React hooks or client state yet. They describe what to render from server data.

## Verify the behavior

| Action | Expected result |
| --- | --- |
| Open `/` on port 3000 | Three movie entries from the API. |
| Open The Last Signal | Its synopsis, two showtimes, and prices in INR. |
| Open Second Sunrise | Its own showtime, without another movie's shows. |
| Open After the Rain | Movie details and an empty-show message. |
| Open `/movies/unknown-movie` | The missing-page message with a link back. |
| Stop the API, then reload a page | A failure message with a retry button. |
| Restart the API, then click Try again | Listings load again. |
| Narrow the browser window | Movie cards stack vertically; show rows fit the width. |

Run these checks from the root:

```sh
npm run typecheck
npm run build
```

The type-check command runs `next typegen` before `tsc` in the web workspace, so it also works before your first dev-server launch. Next.js creates `next-env.d.ts` and route types under `.next/`. Generated output and TypeScript build caches are ignored by Git; the lockfile is tracked.

The build can run without the API. Data is fetched when these pages are requested. To try production mode, stop the development servers, run `npm run build`, then run `npm run start:api` and `npm run start:web` in separate terminals. Return to development mode before editing files if you want automatic reloads.

## Small exercise

With both development servers running, add one show for `after-the-rain` in the **API's** `catalog.ts`, just as in the Phase 2 exercise. Reload its page in the browser. The empty-state message should become a show row without changing any frontend code.

Then change that show's price in paise and predict the displayed INR amount before reloading. Check that The Last Signal still shows only its own screenings.

## Learning checkpoint

Before your commit, be able to explain:

- What runs in the browser, what runs in Next.js, and what runs in Express.
- How a folder creates a route and where `movieId` comes from.
- Why the pages await API calls, and why `fetch` needs a status check.
- How a missing movie, an empty show list, and an unavailable API differ.
- Why changing API fixtures changes the page without editing JSX.
- Why `no-store` is not the same thing as live updates.

Review the diff, ask about any unclear lines, and make the commit yourself. We will start the next phase only after you are ready.

## Official references

- [Next.js installation and scripts](https://nextjs.org/docs/app/getting-started/installation)
- [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Dynamic route parameters](https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes)
- [Fetch options](https://nextjs.org/docs/app/api-reference/functions/fetch)
- [Missing resources with notFound](https://nextjs.org/docs/app/api-reference/functions/not-found)
- [Error boundaries](https://nextjs.org/docs/app/api-reference/file-conventions/error)
