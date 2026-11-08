# lactic.fit

Static landing page for Lactic, served by its own Vercel project (root directory `site`, framework Other, no build step).

Right now it's a "coming soon" placeholder. Mocks for the real page: https://claude.ai/artifact/8DJz3W7N3eKyksfbgUAi4i

## Feedback relay

`api/feedback.js` is a Vercel function at `https://lactic.fit/api/feedback`. The app's Send feedback dialog posts to it, and it files a GitHub issue labeled `feedback`, so riders don't need a GitHub account. Screenshots go to Vercel Blob and show in the issue.

Environment variables on the lactic-site project:

- `GITHUB_TOKEN`: a fine-grained token with only Issues: read and write on blairj09/lactic.
- `BLOB_READ_WRITE_TOKEN`: added when a Blob store is connected to the project. Without it, issues are filed without their screenshots.
- `GITHUB_REPO` (optional): defaults to `blairj09/lactic`.

Before filing, it compares the note with open `feedback` issues of the same kind (word overlap, kept strict). A clear match gets the report as a comment and a +1 instead of a new issue, and the app tells the rider.

Without `GITHUB_TOKEN` it answers 503 and the app offers "Open on GitHub instead". Tests: `npm test` here.
