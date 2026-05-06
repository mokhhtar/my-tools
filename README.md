# DevToolbox — my-tools

Personal toolkit hosted at **https://mokhhtar.github.io/my-tools/**

Built with [Jekyll](https://jekyllrb.com/) and deployed via GitHub Pages. All tools run entirely in the browser — no server, no login required.

## Tools

| Tool | Description | Status |
|------|-------------|--------|
| Reddit → JSON | Convert any public Reddit post + comments into a clean JSON file | ✅ Stable |

## Adding a new tool

1. **Register it in `_config.yml`** under the `tools:` list — give it a unique `id`, `slug`, `name`, `icon` (Tabler icon class), `description`, `category`, and set `status: stable`.
2. **Create the page**: add `tools/your-slug.html` with front matter:
   ```yaml
   ---
   layout: tool
   title: "Tool Name"
   description: "One-line description."
   category: "Category"
   status: stable
   ---
   ```
3. **Add the JS logic** in `assets/js/your-tool.js` and reference it at the bottom of the page.
4. Commit and push — GitHub Pages rebuilds automatically.

## Local development

```bash
bundle install
bundle exec jekyll serve --livereload
# Open http://localhost:4000/my-tools/
```

## Structure

```
my-tools/
├── _config.yml          # Site config + tools registry
├── _layouts/
│   ├── default.html     # Main layout with sidebar
│   └── tool.html        # Tool page wrapper (extends default)
├── assets/
│   ├── css/main.css     # All styles
│   └── js/
│       └── reddit-converter.js
├── index.html           # Homepage
└── tools/
    └── reddit-to-json.html
```
