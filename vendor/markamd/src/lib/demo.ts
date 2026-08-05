export const DEMO_MARKDOWN = `# welcome to marka.md

![](/mascot/write.png)

write markdown, preview it live, and turn notes into clean ai context.

open a folder, star the files you keep using, stage a few notes, then copy one tidy context bundle with token counts. everything stays local.

---

## quick tour

- **tabs** keep drafts, docs, and csv files open side by side. press **⌘T** / **ctrl+t** for a new tab, then **⌘1..9** / **ctrl+1..9** to jump.
- **reading mode** gives the preview room to breathe. press **⌘.** / **ctrl+.**.
- **themes** include neutral, catppuccin, crafted palettes, and ai-inspired colors.
- **context tray** appears only when files are staged, so the sidebar stays quiet.
- **export** makes clean PDFs without browser headers.

> tiny workflow: write -> preview -> stage -> copy context -> ask your model.

---

## diagrams that move ideas

mermaid renders live:

\`\`\`mermaid
flowchart LR
  Notes[markdown notes] --> Stage[stage files]
  Stage --> Count[token count]
  Count --> Bundle[copy context bundle]
  Bundle --> Model[chatgpt / claude / cursor]
  Model --> Draft[better draft]
\`\`\`

plantuml is explicit-load, so remote diagram rendering only happens when you ask for it:

\`\`\`plantuml
@startuml
Writer -> Marka: open notes
Marka -> Writer: live preview
Writer -> Marka: stage files
Marka -> Writer: ai-ready bundle
@enduml
\`\`\`

---

## code, tasks, and tiny docs

shiki highlights every code block — colors follow the active theme:

\`\`\`ts
type ContextFile = {
  path: string;
  tokens: number;
};

function summarize(files: ContextFile[]): string {
  return files
    .map((file) => \`\${file.path}: \${file.tokens} tok\`)
    .join("\\n");
}
\`\`\`

- [x] write the draft
- [x] preview diagrams
- [x] stage supporting notes
- [ ] ship the post

You can also ==mark important phrases==, ~~cut old ideas~~, and keep lists readable.

---

## data notes

Open a \`.csv\` file and marka.md shows a light read-only table preview. Handy for quick content calendars, tiny datasets, and launch checklists.

Markdown image syntax can also point at local video or audio files, and marka.md turns those into playable preview controls.

| channel | idea | status |
| --- | --- | --- |
| x | 5k downloads update | draft |
| reddit | build-in-public notes | later |
| docs | changelog polish | done |

---

![](/mascot/excite.png)

ready when you are.

**⌘T** for a fresh tab. **⌘1..9** to switch tabs. **⌘⇧O** to open a folder. **⌘K** for the command palette.

_marka.md · open source · MIT_
`;
