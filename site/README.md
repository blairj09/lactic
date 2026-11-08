# lactic.fit

Static landing page for Lactic, served by its own Vercel project (root directory `site`, framework Other, no build step).

The page is plain HTML + CSS (index.html, styles.css). The Download buttons start the installer for the visitor's OS and open a popup with its install steps and the other systems (download.js). Downloads go through `api/release.js` (`/api/release?get=mac|windows|appimage|deb`), which redirects to that file in the latest GitHub release. Design source: the "combined" board on https://claude.ai/artifact/8DJz3W7N3eKyksfbgUAi4i

## Feedback relay

`api/feedback.js` is a Vercel function at `https://lactic.fit/api/feedback`. The app's Send feedback dialog posts to it, and it files a GitHub issue labeled `feedback`, so riders don't need a GitHub account. Screenshots go to Vercel Blob and show in the issue.

Environment variables on the lactic-site project:

- `GITHUB_TOKEN`: a fine-grained token with only Issues: read and write on blairj09/lactic.
- `BLOB_READ_WRITE_TOKEN`: added when a Blob store is connected to the project. Without it, issues are filed without their screenshots.
- `GITHUB_REPO` (optional): defaults to `blairj09/lactic`.

Before filing, it compares the note with open `feedback` issues of the same kind (word overlap, kept strict). A clear match gets the report as a comment and a +1 instead of a new issue, and the app tells the rider.

Without `GITHUB_TOKEN` it answers 503 and the app offers "Open on GitHub instead". Tests: `npm test` here.

## Live demo in the hero

The app window on the homepage is the real Lactic app, built from `app/` in demo mode (`npm run build:demo` there, run by this folder's `npm run build` on Vercel) into `site/demo/` (not committed). It runs in the browser with an in-memory database that `app/src/demo/setup.ts` fills on every visit: a profile, a 12-week plan, twelve weeks of rides, sleep and weight, and the simulated trainer and heart rate strap paired. The coach is scripted (`app/src/demo/coach.ts`): it explains itself and proposes a weekend swap through the coach's real tool. The static picture shows until the demo says it's ready, and stays if it never loads.

The demo opens as a short tour in the style of the app's first-run tour: each stop opens a screen (Today, Plan, Progress, Health, Coach, Ride: left to right across the top bar), lights up the part it's about and explains it in a card. Back, Next and the step strip move it along; Exit tour (or a click in the window) hands the demo over to explore, and Take the tour in the title bar brings it back. The demo never takes the page's scroll: while the tour shows, or once the pointer leaves the window (or a tap lands outside it, or Done is pressed), a see-through shield covers it so the wheel and touch scroll the page. All of this is `hero.js`.
