let mermaidLib: typeof import("mermaid")["default"] | null = null;
let mermaidLoading: Promise<typeof import("mermaid")["default"]> | null = null;
let mermaidInitializedTheme: "default" | "dark" | null = null;

async function getMermaid(themeName: "default" | "dark") {
  if (mermaidLib) return mermaidLib;
  if (!mermaidLoading) {
    mermaidLoading = import("mermaid").then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        theme: themeName,
        securityLevel: "strict",
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
      });
      mermaidInitializedTheme = themeName;
      mermaidLib = mod.default;
      return mod.default;
    });
  }
  return mermaidLoading;
}

export async function renderMermaidBlocks(root: ParentNode, theme: "default" | "dark"): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLPreElement>("pre.mdv-mermaid:not(.is-rendered)"));
  if (blocks.length === 0) return;
  const mermaid = await getMermaid(theme);
  if (mermaidInitializedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      theme,
      securityLevel: "strict",
      fontFamily: "JetBrains Mono, ui-monospace, monospace",
    });
    mermaidInitializedTheme = theme;
  }

  for (const pre of blocks) {
    const code = pre.querySelector("code")?.textContent ?? "";
    const id = pre.id || `mdv-mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const { svg } = await mermaid.render(`${id}-svg`, code);
      pre.innerHTML = svg;
      pre.classList.add("is-rendered");
    } catch (err) {
      console.error("marka.md: mermaid render failed", err);
      pre.replaceChildren();
      const codeEl = document.createElement("code");
      codeEl.className = "mdv-mermaid__error";
      codeEl.textContent = code;
      pre.appendChild(codeEl);
      pre.classList.add("is-rendered", "is-error");
    }
  }
}

export async function renderMermaidInHtml(html: string, theme: "default" | "dark"): Promise<string> {
  if (!html.includes("mdv-mermaid")) return html;
  if (typeof document === "undefined") return html;

  const template = document.createElement("template");
  template.innerHTML = html;
  await renderMermaidBlocks(template.content, theme);
  return template.innerHTML;
}
