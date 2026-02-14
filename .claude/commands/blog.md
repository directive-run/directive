---
description: Scaffold a new blog post with frontmatter and structure
---

# Blog Post

Scaffold a new blog post in the website.

## Step 1: Title

**Use AskUserQuestion:** What's the blog post title?

## Step 2: Description

**Use AskUserQuestion:** Short description (1-2 sentences) for SEO and previews.

## Step 3: Tags

Read an existing blog post to get the frontmatter format. Use the Read tool to read the first 10 lines of `website/src/app/blog/introducing-directive/page.md`.

**Use AskUserQuestion:** Which categories/tags? Show options from existing posts (e.g., Architecture, State Management, AI, Tutorial, etc.) and allow custom input.

## Step 4: Generate Slug

Convert the title to a URL slug:
- Lowercase
- Replace spaces with hyphens
- Remove special characters
- e.g., "Building AI Agents with Directive" -> `building-ai-agents-with-directive`

## Step 5: Create Blog Post

Create the file at `website/src/app/blog/<slug>/page.md`:

```markdown
---
title: <Title>
description: <Description>
layout: blog
date: <today YYYY-MM-DD>
dateModified: <today YYYY-MM-DD>
slug: <slug>
author: jason-comes
categories: [<categories>]
---

<Introduction paragraph – hook the reader, state the problem.>

---

## <Section 1>

<Body content.>

## <Section 2>

<Body content.>

---

## Wrapping up

<Conclusion – key takeaways, call to action.>
```

## Step 6: Report

Show:
- Created file path
- URL path: `/blog/<slug>`
- Reminder to update `website/src/lib/navigation.ts` if blog posts are listed there
- Next step: write the content and run `cd website && pnpm dev` to preview
