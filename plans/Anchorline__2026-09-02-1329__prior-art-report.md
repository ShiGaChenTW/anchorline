# Anchorline — Prior Art 搜尋完整報告

- **日期**：2026-09-02
- **執行者**：Miles（PriorArt skill · Search workflow）
- **輸入**：`docs/PRD.md`（逆向生成草稿 v0.3）＋ README.md ＋ package.json
- **本專案授權**：MIT（`LICENSE`，Copyright (c) 2026 ShiGaChenTW）
- **摘要已回寫**：`docs/PRD.md` §7 Prior Art（v0.4 修訂列）
- **本檔用途**：完整留存所有搜尋原始結果，避免資料遺失。PRD 裡只有精簡版。

---

## 1. 結論（一句話）

**沒有現成的可直接採用；全新開發（現行路線）成立。** 27 組 GitHub 關鍵字 ＋ 3 次 WebSearch，去重後最接近的 8 個候選全部停在「部分滿足」，沒有任何一個同時做到：（1）跨四種身分的錨點 join key、（2）`authorAgentFamily` 族系隔離＋治理 replay、（3）ADHD-first 編輯台＋UAT 結果寫回 markdown。

市場觀察：2026 的 spec-driven development（SDD）工具全在解「讓 agent 跑更多」；治理／稽核層只有 TrustedAutonomy 與幾個 < 10 stars 的 audit-trail 小專案在做，而且全在 runtime 層（檔案 staging、hash-chained log），沒有人做文件治理層。

---

## 2. 輸入：從 PRD 抽出的需求要點

| 欄位 | 內容 |
|---|---|
| 做什麼 | 給每個工作單元一個穩定錨點（`<!-- anc:t=XXXXXXXX -->`），把 PRD、簽核、plan checkbox、git commit、openspec change 串成可 replay 的治理鏈，外加落在磁碟上的 append-only 稽核軌跡 |
| 給誰 | vibe coding 時代帶著一隊 AI agent 開發的單人 PM／顧問 |
| 為何現在 | agent 寫掉大部分程式碼後，「怎麼證明 agent 做的事被治理過」是缺口 |
| 技術路線 | Tauri（Rust 殼）＋ 無框架 TypeScript 多頁 HTML；bun；MIT |
| 核心迴圈 | PRD 編輯台（引導撰寫＋結構 gate）→ 送審（預檢→逐關指派→commit 快照）→ 簽核（族系隔離擋自審）→ UAT（結果寫回 `plans/uat-*.md`）→ openspec 治理（官方 CLI `--json`）→ commits → PR → release |
| 明確不做 | 瀏覽器版、自建 openspec parser、Kanban／拖曳／指派／到期日、agent 派工執行、PR diff 檢視器、SQLite、雲端同步 |

---

## 3. 搜尋關鍵字組（全部 27 組）與原始結果

工具：`gh search repos "<q>" --sort stars --limit 8 --json fullName,description,stargazersCount,license,updatedAt`。欄位：stars／repo／license key／最後更新／描述。**空白 = 該組零結果**（GitHub 搜尋為 AND 語義）。

### 第一輪（15 組）

**spec-driven development**

| stars | repo | 授權 | 更新 | 描述 |
|---|---|---|---|---|
| 132859 | github/spec-kit | mit | 2026-09-01 | Toolkit to help you get started with Spec-Driven Development |
| 66931 | Fission-AI/OpenSpec | mit | 2026-09-01 | Spec-driven development (SDD) for AI coding assistants |
| 64609 | gsd-build/get-shit-done | mit | 2026-09-01 | Meta-prompting, context engineering and spec-driven development system for Claude |
| 7769 | gsd-build/gsd-2 | mit | 2026-09-01 | Meta-prompting, context engineering and SDD system enabling agents to work |
| 5359 | buildermethods/agent-os | mit | 2026-09-01 | Injecting codebase standards and writing better specs for SDD |
| 4293 | Pimzino/spec-workflow-mcp | gpl-3.0 | 2026-09-01 | MCP server providing structured SDD workflow tools |
| 3855 | Pimzino/claude-code-spec-workflow | mit | 2026-08-31 | Automated workflows for Claude Code; SDD Requirements → Design |
| 3720 | gemini-cli-extensions/conductor | apache-2.0 | 2026-09-01 | Plugin for AI coding agents (Antigravity, Claude Code) enabling SDD |

**spec driven development tool**

| stars | repo | 授權 | 更新 | 描述 |
|---|---|---|---|---|
| 131 | cameronsjo/spec-compare | mit | 2026-08-31 | Interactive comparison of SDD tools — lockstep walkthroughs, scoring heatmap |
| 15 | davidpv/opsx-spec-driven-development-toolkit | null | 2026-07-17 | — |
| 3 | cjgaliana/specifico | mit | 2026-04-28 | Spec Driven Development tools |
| 2 | mituso89/Spec-Driven-Development-toolkits | null | 2026-07-29 | — |
| 2 | stringsync/spec | apache-2.0 | 2026-07-16 | spec driven development tools |
| 2 | eitatech/gatomia-vscode | mit | 2026-07-31 | GatomiA - Agentic SDD Tool |
| 2 | seerkong/depa-codument | mit | 2026-08-30 | SDD Tool for AI Coding Assistants |
| 2 | prem23247/spec-forge | null | 2026-09-01 | AI-Powered SDD Tool — Multi-Agent Code Review & Automation |

**PRD generator ai agent** — 零結果

**PRD editor markdown** — 零結果

**openspec**

| stars | repo | 授權 | 更新 | 描述 |
|---|---|---|---|---|
| 66931 | Fission-AI/OpenSpec | mit | 2026-09-01 | SDD for AI coding assistants |
| 2395 | hawk86104/three-vue-tres | apache-2.0 | 2026-08-31 | （三維可視化框架，不相關，僅名稱撞字） |
| 780 | MageByte-Zero/spec-superflow | mit | 2026-09-01 | 源碼級融合 OpenSpec 規劃引擎 + Superpowers 執行紀律的 AI 編程工作流插件 |
| 598 | ForceInjection/OpenSpec-practise | apache-2.0 | 2026-09-01 | OpenSpec Practical Guide |
| 393 | rihebty/flow-kit | mit | 2026-09-01 | 融合 bmad、spec-kit、OpenSpec、GSD、claude-task-master、superpowers 的流程 |
| 383 | itmisx/deepx-code | mit | 2026-08-29 | deepseek coding agent（不相關） |
| 279 | gokulrajaram/ProductSpec | mit | 2026-09-01 | Open standard for software intent in the AI agent era |
| 231 | holtwood/awesome-cursorrules-zh | mit | 2026-09-01 | Cursor 規則精選（不相關） |

**spec kit specification**

| stars | repo | 授權 | 更新 | 描述 |
|---|---|---|---|---|
| 68 | WangX0111/superspec | mit | 2026-08-31 | Superpowers Bridge for Spec-Kit |
| 0 | OC-ComputerScience/todospeckit | null | 2026-08-26 | demo |
| 0 | l0r3zz/AISM | mit | 2026-01-12 | spec-kit to assembly via LLM |
| 0 | loxoron218/coding-template | gpl-3.0 | 2026-08-21 | template with opencode + spec-kit |
| 0 | gardvori/spec-to-test | mit | 2026-05-14 | Auto-generate test suites from spec-kit specs |
| 0 | jrubiosainz/spec-audit | mit | 2026-03-18 | CLI scoring quality of Spec Kit specs |
| 0 | ChunTi-Chou/WaveformAnnotator | null | 2025-10-30 | demo |

**ai agent governance audit** — 零結果

**agent audit trail**

| stars | repo | 授權 | 更新 | 描述 |
|---|---|---|---|---|
| 7 | Trusted-Autonomy/TrustedAutonomy | apache-2.0 | 2026-08-28 | Run any AI agent. Audit trail + independent validation before anything is real |
| 4 | kanson1996/agent-audit-trail | apache-2.0 | 2026-08-30 | 防篡改審計溯源系統，hash-chained JSONL logs |
| 3 | wdh107/agent-audit-trail | mit | 2026-06-21 | Open specification and reference SDK for recording AI Agent decision chains |
| 2 | Dnakitare/imara | apache-2.0 | 2026-07-14 | Runtime governance for AI agents: audit trails, policy enforcement for MCP tool calls |
| 1 | roosch269/agent-audit-trail | mit | 2026-04-23 | Tamper-evident hash-chained audit logging; OpenClaw skill |
| 1 | naveenbansal00/agent-audit-trail | mit | 2026-08-06 | Plain-language activity log for AI agents — filters, kill-switch, flag/comment review |
| 1 | AiAgentKarl/agent-audit-trail-mcp | mit | 2026-08-09 | Immutable audit logging — hash-chained, EU AI Act compliance |
| 1 | dtjohnson83/DANZUS | null | 2026-07-27 | product hub（不相關） |

**human in the loop approval agent**（全部 0 stars，皆 LangGraph 練習專案）

| stars | repo | 授權 | 更新 | 描述 |
|---|---|---|---|---|
| 0 | yogita-khanna/human-in-the-loop-approval-agent | null | 2026-08-29 | — |
| 0 | pragati243/Praxis-Human-in-the-Loop-Approval-Agent- | null | 2026-08-04 | LangGraph durable interruptible workflow |
| 0 | cdalton316/Langraph_Task_Agent | null | 2026-01-29 | — |
| 0 | TarunSinghChauhan/hitl-approval-agent | null | 2026-07-29 | — |
| 0 | aadeshmahesh/hr-onboarding-agent | null | 2026-08-22 | — |
| 0 | rupam13/copilot-studio-hitl-approvals | mit | 2026-08-18 | Copilot Studio Teams/Outlook approvals |
| 0 | subinrajs/dispatch-copilot | mit | 2026-08-06 | CopilotKit demo |
| 0 | SabbellaLaharika/Collaborative-AI-Agent-Framework | null | 2026-08-22 | — |

**local-first project management markdown** — 零結果

**tauri project management**

| stars | repo | 授權 | 更新 | 描述 |
|---|---|---|---|---|
| 0 | cavareal/Tauri_Project_Management | null | 2024-12-10 | — |

**ai coding agent workflow tracker** — 零結果

**markdown task tracker checkbox** — 零結果

**architecture decision records tool**

| stars | repo | 授權 | 更新 | 描述 |
|---|---|---|---|---|
| 127 | joshrotenberg/adrs | apache-2.0 | 2026-09-01 | Architectural Decision Record tool in Rust |
| 2 | grizzdank/porque | null | 2026-05-10 | ADR tool for AI-assisted development |
| 0 | msaranda/adr-tool | null | 2021-12-20 | — |
| 0 | jph98/pyadr | null | 2019-03-21 | — |

**vibe coding governance**

| stars | repo | 授權 | 更新 | 描述 |
|---|---|---|---|---|
| 16 | 4pixeltechBR/VibeDev | mit | 2026-08-05 | Governance framework for AI-assisted development (Vibe Coding) |
| 10 | Chappygo-OS/Atomic-Spec | mit | 2026-08-23 | Stop your AI from vibe-coding. Governance layer forcing 17 agents through gates |
| 5 | ASMN-96/ai-agents-skills-toolkit | mit | 2026-07-19 | vibe-coding governance toolkit, source provenance, validation hooks |
| 0 | ssuminnnn/VibeCoding-Governance-System | null | 2026-02-19 | 韓文；敏感資訊偵測／遮罩 |
| 0 | ayushbishtdev/vibe-coding-governance-enterprise | null | 2026-05-30 | Governance gates, checklists & KPI stack mapped to NIST |
| 0 | seamory/vibe-coding-governance-skill | null | 2026-05-08 | — |

### 第二輪（12 組，英文同義詞）

**spec workflow dashboard** — 零結果

**task-master ai**

| stars | repo | 授權 | 更新 | 描述 |
|---|---|---|---|---|
| 41 | aamanbhagat/TaskMaster-AI | null | 2026-08-24 | KendoReact 專案管理 app（不相關） |
| 15 | aemal/vibebox | mit | 2026-08-19 | Claude Code + Cursor + Task Master 三 agent 環境 |
| 9 | longmaba/task-master-ai-gemini | null | 2025-08-31 | — |
| 7 | niabhail/claude-devcontainer-bootstrap | null | 2026-06-14 | — |
| 4 | aemal/claude-code-boilerplate | mit | 2026-06-10 | — |
| 2 | hanish9193/TaskMaster_AI | null | 2025-08-18 | to-do app（不相關） |
| 1 | subhrangshudas05/TaskMasterAi | null | 2026-04-28 | — |
| 1 | hatish2001/TaskMaster-AI | null | 2026-07-06 | VS Code extension: codebase → PM-grade documentation |

**backlog markdown cli** — 零結果

**markdown project tracker**

| stars | repo | 授權 | 更新 | 描述 |
|---|---|---|---|---|
| 0 | chill0121/project_tracker | null | 2025-12-04 | Simple markdown project tracker with chart generator |
| 0 | kayodebristol/svelte-markdown-project-tracker | null | 2022-02-09 | — |
| 0 | ahmeetdeeniz/stone | mpl-2.0 | 2026-08-22 | Self-hosted Markdown project tracking + notes workspace |

**PRD ai**

| stars | repo | 授權 | 更新 | 描述 |
|---|---|---|---|---|
| 2 | shizhen-yi/ai-pm-skill | null | 2026-08-04 | AI PM 產品總監 Skill：產品決策、PRD、上線評審 |
| 2 | xiaokonglong10086/product-lifecycle-coach | mit | 2026-08-11 | Product lifecycle coach Skill for solo PMs |
| 0 | racx3/PrdctAI | mit | 2026-04-19 | 不相關 |
| 0 | praviAlan/prdAIProject | null | 2026-04-30 | — |
| 0 | xiaoxiaoxiaoxiaowu/PRdovoiceAI | other | 2026-05-13 | — |
| 0 | praviAlan/prdAIProject2 | null | 2026-04-30 | — |
| 0 | suhyunlim37/PRD-AI- | null | 2026-07-17 | — |
| 0 | pedrogalhardi-code/ProductOS | null | 2026-07-28 | PRD AI Builder |

**product requirements document tool** — 零結果

**agent orchestration desktop tauri** — 零結果

**claude code gui desktop**

| stars | repo | 授權 | 更新 | 描述 |
|---|---|---|---|---|
| 0 | Bo-Tao/Cloak | mit | 2026-08-17 | Claude Code GUI Desktop |
| 0 | babafish12/claude-code-gui | null | 2026-04-24 | — |
| 0 | happy-token/HappyCode | null | 2026-05-30 | Electron + React |

**signoff workflow markdown** — 零結果

**spec review approval ai** — 零結果

**ai coding governance layer** — 零結果

**agentic workflow dashboard local** — 零結果

### 第三輪（指名搜尋，7 組）

**Backlog.md**

| stars | repo | 授權 | 更新 | 描述 |
|---|---|---|---|---|
| 6602 | MrLesk/Backlog.md | mit | 2026-09-01 | Managing project collaboration between humans and AI Agents in a git ecosystem |
| 50 | jpoley/flowspec | apache-2.0 | 2026-08-31 | Implementation of spec-kit & backlog md with task memory |
| 18 | ysamlan/vscode-backlog-md | mit | 2026-08-11 | VS Code extension |
| 15 | u-ichi/backlog.md-hub | mit | 2026-09-01 | Cross-repo Backlog.md task hub |
| 12 | yandod/md2backlog | null | 2021-08-09 | 不相關（Backlog wiki 轉換） |

**claude-task-master**

| stars | repo | 授權 | 更新 | 描述 |
|---|---|---|---|---|
| 28041 | eyaltoledano/claude-task-master | other（NOASSERTION） | 2026-09-01 | AI-powered task-management system for Cursor, Lovable, Windsurf, Roo |
| 543 | QuantaAlpha/RepoMaster | null | 2026-08-20 | 不相關 |
| 393 | rihebty/flow-kit | mit | 2026-09-01 | （同上） |
| 98 | DevDreed/claude-task-master-extension | mit | 2026-07-24 | — |
| 27 | endlessblink/master-plan | mit | 2026-08-14 | Track tasks in MASTER_PLAN.md — pick, save, ship |

**spec-workflow-mcp**

| stars | repo | 授權 | 更新 | 描述 |
|---|---|---|---|---|
| 4293 | Pimzino/spec-workflow-mcp | gpl-3.0 | 2026-09-01 | （同上） |
| 127 | kingkongshot/specs-workflow-mcp | mit | 2026-05-20 | Intelligent spec workflow management MCP server |
| 36 | mybolide/mcp-probe-kit | mit | 2026-08-31 | SDD workflow MCP for Cursor |
| 31 | Lumiaqian/openspec-mcp | mit | 2026-08-26 | MCP server for OpenSpec — dashboard and approval workflow |
| 21 | kevinlin/spec-coding-mcp | null | 2026-05-16 | Kiro-style spec workflow for other IDEs |

**vibe-kanban**

| stars | repo | 授權 | 更新 | 描述 |
|---|---|---|---|---|
| 27979 | BloopAI/vibe-kanban | apache-2.0 | 2026-09-01 | Get 10X more out of Claude Code, Codex or any coding agent |
| 90 | knowsuchagency/fulcrum | other | 2026-08-31 | Openclaw + Vibe Kanban + Vibetunnel + Dokploy |
| 89 | automagik-dev/forge | apache-2.0 | 2026-08-01 | Orchestrate multiple AI agents, isolated attempts |
| 75 | ariaghora/korlap | null | 2026-08-25 | Kanban board |
| 47 | halilbarim/vibe-stack | null | 2026-07-05 | Docker setup |

**dvalincode**

| stars | repo | 授權 | 更新 | 描述 |
|---|---|---|---|---|
| 113 | arthurpanhku/dvalincode | mit | 2026-09-01 | Independent security verification for code written by humans and AI agents |

**re_gent agent version control** — 零結果

**ai agent policy enforcement human approval**

| stars | repo | 授權 | 更新 | 描述 |
|---|---|---|---|---|
| 0 | dapzthelegend/agent-os | null | 2026-04-13 | Governance layer: policy enforcement, human approval gates, audit trails |

另有 3 組（`claudia claude code gui`、`agent approval gate`、第一次跑的 `vibe-kanban`）因 gh API rate limit 回傳失敗，重跑後補上 vibe-kanban；前兩組未重跑（預期為 GUI 殼與 0-star 練習專案，不影響結論）。

---

## 4. WebSearch（3 次）

### 4.1 「spec-driven development tools comparison 2026 open source spec-kit OpenSpec BMAD conductor」

摘要：SDD 在 2025 興起、2026 每家主要工具（GitHub Spec Kit、AWS Kiro、Claude Code、Cursor、OpenSpec、BMAD、Tessl、Google Antigravity）都有自己的 SDD。Spec Kit：project-wide constitution，每份 spec 繼承；OpenSpec：delta specs 最輕、適合 brownfield；BMAD-METHOD（48.4k stars）：多 persona（Analyst / PM / Architect / PO / Dev / QA）模擬整個 agile team。建議：BMAD 給複雜／受監管的 greenfield，OpenSpec 給 brownfield，Spec Kit 是 scaling team 的安全預設。

來源：
- https://www.augmentcode.com/tools/best-spec-driven-development-tools
- https://www.thebcms.com/blog/spec-driven-development/
- https://codemyspec.com/blog/best-spec-driven-development-tools
- https://ranthebuilder.cloud/blog/i-tested-three-spec-driven-ai-tools-here-s-my-honest-take/
- https://www.braingrid.ai/blog/spec-driven-development-tools
- https://tooltwist.com/insights/spec-driven-frameworks-cxo-guide
- https://reenbit.com/bmad-vs-spec-kit-vs-openspec-choosing-your-spec-driven-ai-framework/
- https://jgcarmona.com/en/moving-toward-spec-driven-development/

### 4.2 「open source AI coding agent governance approval audit trail local-first desktop workbench」

摘要提到的工具（皆 runtime 層治理，非文件治理）：
- **DvalinCode** — local-first coding agent，org policy engine、網路 egress 管制、hash-chained audit trail、inline diff approval、單一 binary Web GUI
- **OpenWorker** — 桌面 AI coworker，每個動作被治理與記錄
- **Sandbase Harness** — self-hosted agent runtime，MCP tools、sandbox、approvals、audit trails、replay
- **re_gent** — 專為 AI agent 活動設計的版本控制，`rgt log` / `rgt blame` / `rgt show`（gh 搜尋找不到 repo）
- **Cordum** — out-of-process governance control plane，pre-dispatch policy、approval gates、signed audit trails

來源：
- https://github.com/andyrewlee/awesome-agent-orchestrators
- https://github.com/bradagi/awesome-cli-coding-agents
- https://github.com/kyrolabs/awesome-agents
- https://www.openhands.dev/blog/open-source-ai-coding-agents
- https://github.com/aloth/awesome-ai-agents
- https://github.com/topics/agent-governance

### 4.3 「markdown-native task tracker for AI agents open source Backlog.md claude-task-master alternatives」

摘要：Backlog.md 把任何 git 資料夾變成 markdown 檔驅動的專案板，支援 Claude Code / Gemini CLI / Codex / Kiro，有 AC 與 DoD、milestones、dependencies、終端 Kanban、Web UI。另提到 **tkr**：git-native、純 markdown、無 server 的任務追蹤器。

來源：
- https://github.com/MrLesk/Backlog.md
- https://github.com/bradcstevens/backlog.md（fork）
- https://shivamagarwal7.medium.com/tkr-a-git-native-task-tracker-built-for-ai-coding-agents-90d62e5c5b88
- https://selfhostedworld.com/software/backlog-md
- https://www.everydev.ai/tools/backlog-md
- https://ht-x.com/posts/2025/09/backlog-md-markdown-native-task-manager-and-kanban/

---

## 5. 候選 README 精讀（8 個）

授權與最後 push 來自 `gh api repos/<r>`（`license.spdx_id`、`pushed_at`），非搜尋結果的 `updatedAt`（那個會被 star／fork 動到）。

### 5.1 Pimzino/spec-workflow-mcp — 4293 ★ · GPL-3.0 · push 2026-07-03 · TypeScript

- README 首行宣告：「I HAVE TAKEN A SMALL BREAK FROM THIS REPO FOR PERSONAL REASONS」
- 形態：MCP server ＋ 即時 Web dashboard（port 5000）＋ VS Code extension
- 功能：Requirements → Design → Tasks 順序式 spec；**approval workflow 含修訂**；task 進度條；**implementation logs**（可搜尋、含 code 統計）；11 語系
- 與本專案的差距：不是本機 App；沒有錨點 join key；沒有 agent 族系概念；沒有 replay；沒有 UAT 寫回；沒有 PRD 編輯台
- 授權判斷：GPL-3.0 引入 MIT 專案不是「法律禁止」，是**合規成本不划算**——引用其程式碼會讓整個衍生作品須以 GPL 釋出，與本專案 MIT 定位衝突。決策：只看 README 與畫面，不讀原始碼。

### 5.2 Lumiaqian/openspec-mcp — 31 ★ · MIT · push 2026-01-12 · TypeScript

- 形態：MCP server 包住 OpenSpec CLI ＋ `--with-dashboard`
- 功能：Review System（add / reply / resolve review comments on proposals/designs）、tasks.md 解析與進度、**Approval Workflow（request / approve / reject change proposals）**、cross-service docs、Web dashboard with Markdown rendering
- 與本專案的差距：只有 openspec 這一段；沒有 PRD、簽核關卡、UAT、稽核鏈；8 個月沒 push，標「可能棄坑」
- 授權：MIT，相容。但實用價值有限，本專案 D10 已決定只走官方 CLI `--json`。

### 5.3 MrLesk/Backlog.md — 6602 ★ · MIT · push 2026-09-01 · TypeScript

- 核心論述：「AI agents can now produce more plausible code in an hour than you can carefully read in a day. The bottleneck is your attention.」
- **三道 review checkpoint**：(1) review the spec（agent 拆任務＋AC＋milestones）、(2) review the plan（agent 寫實作計畫進 task，核准才寫 code）、(3) review the code（one task = one context window = one PR）
- 功能：markdown-native tasks、AC ＋ DoD checklist、milestones ＋ dependencies、終端 Kanban、Web UI（drag-and-drop）、fuzzy search、local-first、MIT
- 自證：幾乎全部程式碼由 agent 透過 Backlog.md 本身寫成，task ledger 在 repo 內
- 與本專案的差距：Kanban 形狀（本專案 `docs/SCOPE.md` 明確不做）；沒有簽核關卡、族系隔離、append-only 稽核軌跡、PRD 編輯台
- 借用價值：三道 checkpoint 的敘事可作簽核關卡設計的對照

### 5.4 Trusted-Autonomy/TrustedAutonomy — 7 ★ · Apache-2.0 · push 2026-08-28 · Rust

- 核心：agent 在專案的 **staging copy** 上用原生工具工作（對 agent 隱形），完成後產生 Draft Package（semantic diff ＋ agent rationale），人類**逐檔** approve / reject / discuss，只有核准的 delta 才複製回真實專案
- 定位：「不是 orchestrator、不是 Agent OS VM、不是 UI-first product」；是 policy-enforced MCP gateway ＋ staging and AI+Human review system
- 狀態：0.17.0-alpha，241 個 plan phase 完成 226；安全模型未經獨立審計
- 與本專案的差距：解的是 **runtime 檔案層**（哪些檔案變更可以落地），本專案解的是**文件治理層**（PRD 誰寫誰簽、任務進度、UAT 結果）。兩者可疊加而非競爭。無 UI、Rust。
- 借用價值：「產出先審後落地」與本專案 `landed: pending` 的 agent 結果機制同構，可對照其 Draft Package 的 per-file 決策模型

### 5.5 Chappygo-OS/Atomic-Spec — 10 ★ · MIT · push 2026-08-23 · Shell/Python

- 口號：「Spec-kit taught AI agents a workflow. Atomic Spec makes them obey it.」
- **Nine Prime Directives**：Directory Supremacy（每個 feature 必有 `index.md` ＋ `traceability.md`）、Atomic Injunction（tasks/ 目錄、一 task 一檔）、Context Pinning（implement 時禁讀 plan.md）、Gate Compliance（gate 未過不得進站）、Knowledge Routing、**Human-In-The-Loop（plan 階段 4 個 checkpoint 必停）**、Project Defaults Registry、Self-Contained Tasks、Orientation Read Surface（跨 provider handoff）
- 心智模型：assembly line ＋ stations ＋ gates；「no gate pass → no proceeding」
- 自帶比較表對 AGENTS.md / aider / continue.dev / spec-kit：只有它有 enforcement、context isolation、audit trail（registry-level）
- 與本專案的差距：prompt/CLI 框架，無 GUI；「audit trail」是 traceability 矩陣不是 append-only 事件軌跡；無族系概念；無 UAT
- 借用價值：gate 語意與本專案「結構 gate 未過擋核准」同構；traceability.md 可對照錨點 join key 的用途

### 5.6 Fission-AI/OpenSpec — 66931 ★ · MIT · push 2026-09-01 · TypeScript

- 本專案既有上游依賴（D10：只走官方 CLI `--json`；D10a：`tasks.md` checkbox 本地讀寫例外）
- 負責 change 生命週期（propose → apply → archive），不負責簽核、UAT、稽核

### 5.7 github/spec-kit — 132859 ★ · MIT · push 2026-09-01 · Python

- constitution ＋ spec 範本，agent-agnostic；無 GUI、無簽核、無軌跡

### 5.8 BloopAI/vibe-kanban — 27979 ★ · Apache-2.0 · push 2026-09-01

- agent 派工／並行執行／isolated attempts，正是本專案「不做」的格子（agent 派工執行、Kanban）；判「不相關」

### 其他只覆蓋單一段的

- **eyaltoledano/claude-task-master** — 28041 ★ · **NOASSERTION**（LICENSE 非標準 SPDX 條文）· push 2026-04-28 · JavaScript。LICENSE 檔存在但為非標準條文（GitHub License API 比不到 SPDX），本輪未逐條核對，**未核對前不引用程式碼**；架構參考不受限，但本輪不投入核對成本。（原版誤寫成「預設保留所有權利」的法律結論——判定來源只是 `spdx_id`，沒開過那份 LICENSE；tiamat-fe 交叉比對抓到，已改。）
- **gemini-cli-extensions/conductor** — 3720 ★ · Apache-2.0。Context → Spec & Plan → Implement 的 agent plugin（Antigravity / Claude Code），無 GUI。
- **joshrotenberg/adrs** — 127 ★ · Apache-2.0 · Rust ADR CLI。只對應 Q3（為什麼變成這樣）一段。
- **arthurpanhku/dvalincode** — 113 ★ · MIT。安全驗證層（scan / repair / prove），非文件治理。

---

## 6. 比較表（PRD §7 同款）

| repo | stars | 授權 | 最後 push | 功能覆蓋度 | 與需求的差距 |
|---|---|---|---|---|---|
| Pimzino/spec-workflow-mcp | 4.3k | **GPL-3.0** | 2026-07-03（作者暫停） | 部分滿足 | 最像：dashboard＋簽核＋修訂＋task 進度＋實作 log；但 MCP＋網頁，無錨點、無族系、無 replay；GPL 進 MIT 合規成本不划算 |
| Lumiaqian/openspec-mcp | 31 | MIT | 2026-01-12（可能棄坑） | 部分滿足 | OpenSpec 的 dashboard＋approval＋review comment，只有 openspec 一段 |
| MrLesk/Backlog.md | 6.6k | MIT | 2026-09-01 | 部分滿足 | 三道 review checkpoint 理念相鄰；但 Kanban 形狀（明確不做），無簽核關卡、族系隔離、稽核軌跡 |
| Trusted-Autonomy/TrustedAutonomy | 7 | Apache-2.0 | 2026-08-28 | 部分滿足 | 精神最接近 Q4，但解 runtime 檔案層（staging＋diff 審），非文件治理層；Rust alpha 無 UI |
| Chappygo-OS/Atomic-Spec | 10 | MIT | 2026-08-23 | 部分滿足 | gate 未過不得進站＋4 個 sign-off 點＋traceability 矩陣；純 prompt 框架，無 GUI、無 append-only 軌跡、無族系 |
| Fission-AI/OpenSpec | 66.9k | MIT | 2026-09-01 | 部分滿足 | 已是上游依賴，只管 change 生命週期 |
| github/spec-kit | 132.9k | MIT | 2026-09-01 | 部分滿足 | 範本＋constitution，無 GUI、簽核、軌跡 |
| BloopAI/vibe-kanban | 28k | Apache-2.0 | 2026-09-01 | 不相關 | agent 派工執行，正是「不做」那格 |

---

## 7. 決策（兩道閘門）

**覆蓋度閘門**：無「幾乎全滿足」→ 不走採用線。所有候選皆「部分滿足」→ 進借用線評估。

**授權閘門（借用線）**：
- MIT（Backlog.md、Atomic-Spec、openspec-mcp、spec-kit、OpenSpec）：相容，可引用；但實際上本專案已建成，沒有可直接 fork 的區塊，**降為架構參考**
- Apache-2.0（TrustedAutonomy、conductor、adrs、vibe-kanban）：相容（需保留 NOTICE），同上降為架構參考
- GPL-3.0（spec-workflow-mcp）：合規成本不划算，**只看 README 與畫面，不讀原始碼**
- NOASSERTION（claude-task-master）：LICENSE 非標準條文，未核對前不引用程式碼；架構參考不受限，本輪不投入核對成本

**最終**：
- 採用線：無
- 借用線：只作架構參考，不引用程式碼——Backlog.md 三道 checkpoint、Atomic-Spec gate 語意、spec-workflow-mcp 實作 log 呈現、TrustedAutonomy per-file 決策模型
- 排除：vibe-kanban、claude-task-master（落在明確不做的格子／授權不明）；openspec-mcp（半年沒動、只包一段）
- 全新開發（現行路線）成立

**本專案三項無人做到的差異化**（對應 PRD §2.3 目標 1、2）：
1. 跨 plan checkbox / commit / 簽核 / openspec change 四種身分的穩定錨點 join key
2. `authorAgentFamily` 族系隔離——同族 agent 不得核准同族文件，replay 會標違規
3. ADHD-first 編輯台（反轉揭露、卡住時變安靜）＋ UAT 結果寫回同一份 markdown 讓 agent 讀回

**重跑條件**：若出現同時做「文件治理 ＋ 族系隔離 ＋ 本機 App」的專案，再跑一次 PriorArt。可用本檔 §3 的 27 組關鍵字直接重跑。

---

## 8. 已落地的變更

- `docs/PRD.md`：新增 `## 7. Prior Art（2026-09-02，PriorArt 搜尋）`（第 157 行起，補上原本跳號的第 7 節）；§1.2 修訂紀錄加 v0.4 列（第 37 行）；檔案 193 → 227 行。**仍為 untracked**，尚未進 git。
- 本檔：`plans/Anchorline__2026-09-02-1329__prior-art-report.md`

---

## 9. 附錄：同日跨 session 邊界確認（tiamat-fe）

介面改版線 `tiamat-fe`（worktree `~/orca/workspaces/Project_Anchorline/tiamat`，分支 `redesign-ui-aidesigner`）來訊確認邊界，本 session 回覆內容：

- 本 session（主 repo）唯一改動：`docs/PRD.md`（untracked）。未碰 `src/lib/plan-parser.ts`、`src/lib/flow-layers.ts`、`src/pages/openspec.ts`、`onboarding.html`、`shared.css`。
- `openspec/`：`add-vibe-route` 已在 `6dcd5c9` 落地；之後只有 `openspec archive add-vibe-route`，等 8 題 UAT 過。P2 / P3 已規劃未開工。
- 短期會進 main 的兩件：PRD 草稿 add（等 Scott 審）、openspec archive（等 UAT）。皆只動 `docs/` 與 `openspec/`。main 領先 origin 3 commit，push 要問過 Scott。
- 對方回覆：零風險；他們不新增主題，落點 `shared.css` 與 `src/pages/dashboard.ts`，動到建案流程或 route 卡片前會先知會。
- ⚠️ 對方提到主 repo 上另有一條 `project-anchorline-3b` session 也在做 add-vibe-route（名稱不同，內容同指 `6dcd5c9`）。若為舊 session 殘留，兩條同在主 repo 工作樹寫 `docs/PRD.md` 或跑 `openspec archive` 會撞。**待 Scott 確認是否關掉。**
