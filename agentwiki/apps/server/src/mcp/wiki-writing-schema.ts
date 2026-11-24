const schemaVersion = '1.0.0';
const pageExample = '## 回滚\n\n请参阅 [[部署指南#回滚|部署回滚步骤]]。';
const createExample = {
  spaceId: 'SPACE_ID',
  title: '发布检查清单',
  content: pageExample,
  expectedTreeRevision: '12',
};
const updateExample = {
  spaceId: 'SPACE_ID',
  pageId: 'PAGE_ID',
  expectedUpdatedAt: '2026-11-23T01:02:03.000Z',
  expectedTreeRevision: '12',
  content: '## 验证\n\n- [x] 完成部署检查。',
};

export const WIKI_WRITING_SCHEMA_URI = 'agentwiki://writing-schema';
export const WIKI_WRITING_SCHEMA_MIME = 'application/schema+json';
export const WIKI_WRITING_TOOL_DESCRIPTION = 'Read the versioned AgentWiki Markdown authoring schema and examples before drafting or updating Wiki content. Takes no arguments and needs no Space selection.';
export const WIKI_WRITING_CONTENT_DESCRIPTION = 'Raw Markdown source for the page body. Follow the syntax returned by get_writing_schema (wiki_get_writing_schema in the local gateway).';
export const WIKI_WRITING_INSTRUCTIONS = [
  'Before drafting or updating an AgentWiki Markdown page, call get_writing_schema with empty arguments.',
  'Use [[Page title|label]] for an existing page in the same Space, [label](/pages/PAGE_ID) for a verified page in another Space, and [label](https://example.com) for an external site.',
  'Use the schema to check heading and block anchors, embeds, images, tables, callouts, math, and Mermaid.',
].join(' ');

// The JSON Schema describes the body value used by the existing MCP write tools.
// Keep renderer-specific syntax and workflow in the extension so agents can inspect it as data.
export const WIKI_WRITING_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: WIKI_WRITING_SCHEMA_URI + '/v' + schemaVersion,
  title: 'AgentWiki Markdown page body',
  description: 'Pass a raw Markdown string as content. The x-agentwiki extension documents the renderer and authoring workflow.',
  type: 'string',
  examples: [pageExample],
  'x-agentwiki': {
    version: schemaVersion,
    format: 'markdown',
    tools: {
      schema: { http: 'get_writing_schema', stdio: 'wiki_get_writing_schema', arguments: {} },
      resolveSpace: 'list_spaces',
      findPage: 'search_pages',
      readPage: 'get_page',
      resolveFolder: 'list_folders',
      createDraft: 'propose_page',
      updateDraft: 'propose_page_update',
      stdioPrefix: 'wiki_',
    },
    workflow: [
      'Use the schema before composing Markdown, including when the user asks for a draft without publishing it.',
      'Confirm the destination Space with list_spaces. Search within the intended Space and read the target Page before citing its title, ID, heading, or block ID. Use a full synced path or Page ID when titles are ambiguous.',
      'For a new Page, pass the title separately from content. Use list_folders for the current treeRevision and for the target folderId. Send the revision as expectedTreeRevision; omit folderId or use null for the Space root.',
      'Before updating, read the Page and folder tree for expectedUpdatedAt and expectedTreeRevision. If changing content, send the complete edited body and preserve surrounding Markdown. Omit unchanged fields; folderId: null explicitly moves the Page to the root. The update retains the Page format; apply this schema to Markdown Pages.',
      'On success, report the returned ChangeSet status. The Space policy determines whether it publishes immediately or waits for review. After publication, read back the Page and verify references in the destination Space when possible.',
    ],
    proposalExamples: {
      note: 'Replace sample IDs and version baselines with current values from your tools. Always follow the input schema advertised by the connected client.',
      create: {
        http: { name: 'propose_page', arguments: createExample },
        stdio: {
          name: 'wiki_propose_page',
          arguments: {
            spaceId: createExample.spaceId,
            __args: {
              title: createExample.title,
              content: createExample.content,
              expectedTreeRevision: createExample.expectedTreeRevision,
            },
          },
        },
      },
      update: {
        http: { name: 'propose_page_update', arguments: updateExample },
        stdio: { name: 'wiki_propose_page_update', arguments: updateExample },
      },
    },
    syntax: [
      {
        id: 'headings',
        examples: ['# Top-level heading\n\n## 部署准备\n\n### Check prerequisites', 'First paragraph.\n\nSecond paragraph.'],
        rules: [
          'Use one to six # characters followed by a space. Use ## or deeper for sections when the UI displays the Page title above the body.',
          'Leave blank lines between paragraphs and block elements. The renderer preserves a single source newline as a visual line break in prose; keep a logical paragraph on one source line unless a break is intentional.',
        ],
      },
      {
        id: 'inline-formatting',
        examples: ['**bold** and *italic*', '~~superseded~~', '==需要复核==', '`npm run build`', 'Show the literal `[[部署指南]]`.'],
        rules: [
          'Use backticks for literal syntax, identifiers, and commands. Wiki links and highlights inside code stay literal.',
          'Use ==text== for a short, plain-text highlight on one line.',
        ],
      },
      {
        id: 'lists',
        examples: ['- Main item\n  - Subitem\n- Next item', '1. Prepare\n2. Deploy\n3. Verify'],
        rules: ['Indent nested items under the start of the parent item text. Keep a blank line before a list that follows prose.'],
      },
      {
        id: 'task-lists',
        examples: ['- [ ] Review the configuration\n- [x] Run the checks'],
        rules: ['Use a space inside unchecked boxes and x inside checked boxes. The renderer controls whether readers can toggle them.'],
      },
      {
        id: 'quotes-and-dividers',
        examples: ['> A short quotation.\n>\n> Another quoted paragraph.', 'First topic.\n\n---\n\nSecond topic.'],
        rules: ['Prefix each quoted line with >. Put a horizontal rule on its own line with blank lines around it; --- immediately after text can create a heading.'],
      },
      {
        id: 'code-fences',
        examples: ['```bash\npnpm test\n```', '````markdown\n```text\nExample containing backticks.\n```\n````'],
        rules: ['Use matching fences, a language tag when applicable, and a longer outer fence when demonstrating Markdown that contains a fence. Fenced code is displayed as source; commands are not executed.'],
      },
      {
        id: 'external-links',
        examples: [
          '[官方文档](https://example.com/docs)',
          '[API guide](https://example.com/api "API reference")',
          'See [support][help].\n\n[help]: https://example.com/support',
          '<https://example.com/status>',
        ],
        rules: [
          'Use the complete HTTPS URL for an external website. Keep the display label in brackets and the URL in parentheses. Use URL encoding for spaces.',
          'Use [label][reference] with a matching [reference]: URL definition for repeat citations. Use angle brackets for a bare Markdown autolink.',
        ],
      },
      {
        id: 'same-space-links',
        examples: [
          '[[部署指南]]',
          '[[部署指南|生产部署手册]]',
          '[[deployment-guide|部署指南]]',
          '[[pages/运维/部署指南.md|部署指南]]',
          '[[PAGE_ID|部署指南]]',
        ],
        rules: [
          'Double brackets resolve a Page in the current Space using its title, slug, synced path, or ID. | introduces a display label; it does not change the target.',
          'Use the actual target identity. When a title could match several pages or contains syntax delimiters such as #, |, or ], use the verified Page ID or a canonical Page URL. Replace PAGE_ID in all examples.',
          'Prefer Wiki links over [label](./file.md) for navigation between Pages. The renderer does not turn an arbitrary local .md path in a standard Markdown link into an AgentWiki Page.',
        ],
      },
      {
        id: 'cross-space-links',
        examples: ['[另一个空间的部署指南](/pages/PAGE_ID)', '[部署指南](https://wiki.example.com/pages/PAGE_ID)'],
        rules: [
          'Use the verified Page route /pages/PAGE_ID on the same AgentWiki site, or a copied absolute URL. Replace the sample host and ID with the actual ones.',
          'Readers must have access to the destination. Use a link for a Page in another Space; [[Space/Page]] is not a cross-Space locator and ![[...]] does not embed across Spaces.',
        ],
      },
      {
        id: 'heading-links',
        examples: [
          '[[部署指南#回滚步骤]]',
          '[[部署指南#回滚步骤|查看回滚]]',
          '## Rollback steps\n\n[Jump to rollback](#rollback-steps)',
          '[Open a copied section link](/pages/PAGE_ID#rollback-steps)',
        ],
        rules: [
          'For a Wiki link, write the actual heading text after #, without the heading markup prefix. Pick distinctive heading text so a link is unambiguous.',
          'For a same-page Markdown jump or a canonical cross-Space link to a heading, use the rendered anchor from the heading permalink. Keep the whole copied fragment when a heading has punctuation, Unicode, or duplicates.',
        ],
      },
      {
        id: 'block-links',
        examples: [
          '发布前先备份数据库。 ^database-backup',
          '[[部署指南#^database-backup|备份要求]]',
          '[本页的备份要求](#^database-backup)',
        ],
        rules: [
          'Define a block anchor at the end of a paragraph with a space followed by ^ and a unique ID. Use letters (including Unicode), digits, underscores, or hyphens; no spaces in the ID.',
          'Use [[Page#^ID|label]] to link to the target paragraph or [label](#^ID) within the same Page. Include the Page target in Wiki brackets.',
        ],
      },
      {
        id: 'page-embeds',
        examples: ['![[部署指南]]', '![[部署指南#回滚步骤]]'],
        rules: [
          'On its own line, use ![[Page]] to display the contents of an accessible Page in the same Space, or ![[Page#Heading]] to display one section.',
          'A section runs from the matched heading until the next heading of the same or a higher level. Prefer unique headings and avoid circular links between embeds and deep chains.',
          'Block embeds (![[Page#^ID]]) are unsupported. Use a block link or a section embed instead.',
        ],
      },
      {
        id: 'attachment-images',
        examples: [
          '![[diagram.png]]',
          '![[assets/架构图 (13).png|部署架构示意图]]',
          '![部署架构](<../assets/架构图 (13).png>)',
          '![部署架构](<../../assets/架构图 (13).png>)',
        ],
        rules: [
          'Reference an uploaded image in the destination Space by its exact display filename, optionally prefixed with assets/. Wiki attachment image types are PNG, JPEG (.jpg or .jpeg), WebP, and GIF.',
          'Use | for image alternative text. Size suffixes such as |300 or |300x200 are not sizing directives in AgentWiki.',
          'Standard Markdown can reference synced assets with a relative path. For pages/runbook.md use ../assets/; for pages/ops/runbook.md use ../../assets/. Wrap a destination containing spaces or parentheses in < and >.',
          'Markdown references do not upload files. After transferring a page to another Space, ensure the image is present in that Space or use an accessible HTTPS image URL. Ask for the missing asset when necessary, rather than inventing a filename or URL.',
        ],
      },
      {
        id: 'https-images',
        examples: ['![部署拓扑示意图](https://example.com/images/topology.png)', '![Status diagram](https://example.com/status.png "System status")'],
        rules: [
          'Use a direct HTTPS image URL that the intended reader can load. Use ! before the brackets to render an image, and omit it to provide a clickable link.',
          'Give informative images concise alternative text. Plain HTTP, file:, data:, and blob: are not supported as external image sources; prefer an uploaded Space attachment for private images.',
        ],
      },
      {
        id: 'tables',
        examples: ['| 环境 | 状态 | 数量 |\n| :--- | :---: | ---: |\n| 测试 | 通过 | 2 |\n| A \\| B | 待复核 | 1 |'],
        rules: [
          'Use one header row, a separator row with at least three hyphens per column, and one line per data row. A colon in the separator sets alignment.',
          'Escape a literal pipe as \\| inside a cell. To avoid conflict between the table delimiter and Wiki alias separator, prefer a standard Markdown Page link in aliased link cells. Put multiline assets and embeds outside the table.',
        ],
      },
      {
        id: 'footnotes',
        examples: ['适用范围见说明。[^scope]\n\n[^scope]: 此流程仅适用于测试环境。'],
        rules: ['Use [^id] in the body and [^id]: text for its definition. Reuse a reference ID only when it points to the same note.'],
      },
      {
        id: 'callouts',
        examples: [
          '> [!NOTE] 环境说明\n> 先确认当前空间和环境。',
          '> [!TIP]+ 展开的检查项\n> - 再次确认目标空间。',
          '> [!WARNING]- 折叠的回滚条件\n> 只有备份通过校验才执行。',
        ],
        rules: [
          'Begin a blockquote with [!TYPE]. Add an optional title after a space. Keep the > prefix on each body line, including quoted blank lines.',
          'Append + for a foldable callout open by default, or - for one closed by default. Without a sign the callout is not foldable.',
          'Known types include abstract, bug, danger, error, example, failure, info, note, question, quote, success, summary, tip, todo, and warning. Other types render with neutral styling.',
        ],
      },
      {
        id: 'math',
        examples: ['Inline $E = mc^2$.', '$$\n\\frac{1}{n}\\sum_{i=1}^{n} x_i\n$$'],
        rules: ['Use $...$ for inline TeX and $$ on separate lines for display math. Use KaTeX-supported commands. Escape literal dollar signs in ordinary prose where they would be read as math.'],
      },
      {
        id: 'mermaid',
        examples: ['```mermaid\nflowchart LR\n  A[Prepare] --> B[Deploy]\n  B --> C[Verify]\n```', '```mermaid\nsequenceDiagram\n  Agent->>Wiki: Submit proposal\n  Wiki-->>Agent: Return status\n```'],
        rules: ['Use a fenced code block with the mermaid language tag. Use diagram syntax directly and omit executable callbacks, HTML labels, and configuration overrides.'],
      },
    ],
    limitations: [
      'The schema describes Markdown authoring; it does not need to be embedded in a page or passed as an extra proposal field.',
      'Use Markdown instead of raw HTML. AgentWiki skips raw HTML in rendered page bodies and does not execute Obsidian plugins, Dataview queries, or scripts.',
      'A Page embed or attachment still depends on destination permissions and whether its target exists. A correct-looking marker is not proof the reference resolved.',
    ],
  },
} as const;
