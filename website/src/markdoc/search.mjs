import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import Markdoc from "@markdoc/markdoc";
import { slugifyWithCounter } from "@sindresorhus/slugify";
import glob from "fast-glob";
import { createLoader } from "simple-functional-loader";

const __filename = url.fileURLToPath(import.meta.url);
const slugify = slugifyWithCounter();

function nodeToString(node) {
  let str =
    node.type === "text" && typeof node.attributes?.content === "string"
      ? node.attributes.content
      : "";
  if ("children" in node) {
    for (const child of node.children) {
      str += nodeToString(child);
    }
  }
  return str;
}

function extractSections(node, sections, isRoot = true) {
  if (isRoot) {
    slugify.reset();
  }
  if (node.type === "heading" || node.type === "paragraph") {
    const content = nodeToString(node).trim();
    if (node.type === "heading" && node.attributes.level <= 2) {
      // Only add if content is not empty
      if (content) {
        const hash = node.attributes?.id ?? slugify(content);
        sections.push([content, hash, []]);
      }
    } else {
      if (sections.length > 0 && sections.at(-1) && content) {
        sections.at(-1)[2].push(content);
      }
    }
  } else if ("children" in node) {
    for (const child of node.children) {
      extractSections(child, sections, false);
    }
  }
}

export default function withSearch(nextConfig = {}) {
  const cache = new Map();

  return Object.assign({}, nextConfig, {
    webpack(config, options) {
      config.module.rules.push({
        test: __filename,
        use: [
          createLoader(function () {
            const pagesDir = path.resolve("./src/app");
            this.addContextDependency(pagesDir);

            const files = glob.sync("**/page.md", {
              cwd: pagesDir,
              ignore: ["**/docs/v[0-9]*/**"],
            });
            const data = files.map((file) => {
              const url =
                file === "page.md"
                  ? "/"
                  : `/${file.replace(/\/page\.md$/, "")}`;
              const md = fs.readFileSync(path.join(pagesDir, file), "utf8");

              let sections;

              if (cache.get(file)?.[0] === md) {
                sections = cache.get(file)[1];
              } else {
                const ast = Markdoc.parse(md);
                const title =
                  ast.attributes?.frontmatter?.match(
                    /^title:\s*(.*?)\s*$/m,
                  )?.[1];
                sections = [[title, null, []]];
                extractSections(ast, sections);
                cache.set(file, [md, sections]);
              }

              return { url, sections };
            });

            // When this file is imported within the application
            // the following module is loaded:
            return `
              import FlexSearch from 'flexsearch'

              let sectionIndex = new FlexSearch.Document({
                tokenize: 'full',
                document: {
                  id: 'url',
                  index: 'content',
                  store: ['title', 'pageTitle', 'content'],
                },
                context: {
                  resolution: 9,
                  depth: 2,
                  bidirectional: true
                }
              })

              let data = ${JSON.stringify(data)}

              for (let { url, sections } of data) {
                for (let [title, hash, content] of sections) {
                  sectionIndex.add({
                    url: url + (hash ? ('#' + hash) : ''),
                    title,
                    content: [title, ...content].join('\\n'),
                    pageTitle: hash ? sections[0][0] : undefined,
                  })
                }
              }

              function getPreview(content, query, maxLength = 120) {
                if (!content || !query) return ''
                const lowerContent = content.toLowerCase()
                const lowerQuery = query.toLowerCase()
                const queryIndex = lowerContent.indexOf(lowerQuery)

                if (queryIndex === -1) {
                  // Return the beginning if no match found
                  return content.slice(0, maxLength) + (content.length > maxLength ? '...' : '')
                }

                // Find a good start position (try to start at word boundary)
                let start = Math.max(0, queryIndex - 40)
                if (start > 0) {
                  const spaceIndex = content.indexOf(' ', start)
                  if (spaceIndex !== -1 && spaceIndex < queryIndex) {
                    start = spaceIndex + 1
                  }
                }

                // Find a good end position
                let end = Math.min(content.length, start + maxLength)
                if (end < content.length) {
                  const spaceIndex = content.lastIndexOf(' ', end)
                  if (spaceIndex > queryIndex + query.length) {
                    end = spaceIndex
                  }
                }

                let preview = content.slice(start, end)
                if (start > 0) preview = '...' + preview
                if (end < content.length) preview = preview + '...'

                return preview
              }

              export function search(query, options = {}) {
                let result = sectionIndex.search(query, {
                  ...options,
                  enrich: true,
                })
                if (result.length === 0) {
                  return []
                }
                return result[0].result.map((item) => ({
                  url: item.id,
                  title: item.doc.title,
                  pageTitle: item.doc.pageTitle,
                  preview: getPreview(item.doc.content, query),
                }))
              }
            `;
          }),
        ],
      });

      if (typeof nextConfig.webpack === "function") {
        return nextConfig.webpack(config, options);
      }

      return config;
    },
  });
}
