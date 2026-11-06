# Publish a news post

News posts are Markdown files in `web/content/news/`.
The landing page shows the latest three posts.
The News page shows all published posts.

## Write a post

1. Create a file such as `web/content/news/my-update.md`.
2. Use lowercase letters, numbers, and hyphens in the filename.
3. Start with this template:

```markdown
---
title: My update
date: 2026-11-05
summary: One sentence about the update.
draft: true
---
Write the post here.

## A heading

Add paragraphs, lists, images, and links as needed.
```

The filename defines the URL: `/news/my-update`.
Keep the filename after publication so links remain valid.
Use the publication date in `YYYY-MM-DD` format.
Write one metadata field per line.
The supported fields are `title`, `date`, `summary`, and optional `draft`.
These fields use plain single-line text or JSON double-quoted strings.
Do not use multiline YAML values or YAML comments in metadata.
Start body headings at `##`; the page already shows the title.
Use site paths for internal links, such as `[Getting Started](/start)`.
Put images in `web/public/news/` and link to them as `![Description](/news/image.jpg)`.
Embedded HTML is not rendered.

## Review and publish

1. Set `draft: false`, or remove the draft field, to publish.
2. Run `cd web && npm ci && npm run build` from the repository root.
3. Commit the Markdown file and merge the pull request.
4. Pull and rebuild the site on the host that serves the frontend.

The date orders posts; it does not schedule publication.
A post with a future date appears as soon as its build is deployed.
A draft is hidden from the lists and post pages.
Draft source is still included in the repository and frontend build.
Keep confidential drafts outside the repository.

The sample post is `web/content/news/a-simpler-way-to-get-started.md`.
Edit or remove it as needed.
