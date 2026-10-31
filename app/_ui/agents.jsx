import { ClaudeMark, CursorMark, CopilotMark, WindsurfMark } from './brands';
import { PlugIcon } from './icons';

// The clients Stash's setup guide covers, in one place, so the homepage, the
// connect prompt and the setup guide never disagree about what is supported
// or how to connect it. `code(url, key)` is the exact config to paste.

export const PLACEHOLDER_KEY = 'YOUR_STASH_KEY';

const json = (o) => JSON.stringify(o, null, 2);

export const CLIENTS = [
  {
    key: 'claude-code',
    name: 'Claude Code',
    short: 'Claude',
    maker: 'Anthropic',
    Mark: ClaudeMark,
    tone: '#d97757',
    where: 'In your terminal',
    workflow: 'Checks Stash before it adds a dependency or starts a feature, then explains its pick.',
    window: 'claude — ~/projects/landing',
    file: 'Terminal',
    steps: [
      <>Run this once in your terminal. Stash is then available in every project.</>,
    ],
    reload: <>Start a new Claude Code session, then type <b>/mcp</b>. Stash should be listed as connected.</>,
    code: (url, key) => 'claude mcp add --transport http stash ' + url + ' \\\n  --header "Authorization: Bearer ' + key + '"',
  },
  {
    key: 'cursor',
    name: 'Cursor',
    short: 'Cursor',
    maker: 'Anysphere',
    Mark: CursorMark,
    tone: '#efefeb',
    where: 'In the editor’s agent',
    workflow: 'Asks Stash for a fitting library while it plans an edit, with install steps from real docs.',
    window: 'Cursor — Agent',
    file: '~/.cursor/mcp.json',
    steps: [
      <>Open <b>~/.cursor/mcp.json</b> for every project, or <b>.cursor/mcp.json</b> for one, and add:</>,
    ],
    reload: <>Open Cursor Settings and find <b>stash</b> in the MCP list. If it is missing, reload the window.</>,
    code: (url, key) => json({ mcpServers: { stash: { url, headers: { Authorization: 'Bearer ' + key } } } }),
  },
  {
    key: 'vscode',
    name: 'GitHub Copilot',
    short: 'Copilot',
    maker: 'GitHub, in VS Code',
    Mark: CopilotMark,
    tone: '#efefeb',
    where: 'In VS Code agent mode',
    workflow: 'Copilot’s agent mode calls Stash as a tool, so suggestions start from vetted options.',
    window: 'Copilot Chat — Agent',
    file: '.vscode/mcp.json',
    steps: [
      <>Create <b>.vscode/mcp.json</b> in your project, or run <b>MCP: Open User Configuration</b> for every project, and add:</>,
    ],
    reload: <>Run <b>MCP: List Servers</b> from the Command Palette, start <b>stash</b>, then turn it on in agent mode&apos;s tool list.</>,
    code: (url, key) => json({ servers: { stash: { type: 'http', url, headers: { Authorization: 'Bearer ' + key } } } }),
  },
  {
    key: 'claude',
    name: 'Claude',
    short: 'Claude',
    maker: 'Anthropic, desktop and web',
    Mark: ClaudeMark,
    tone: '#d97757',
    where: 'On desktop and the web',
    workflow: 'Add Stash as a custom connector and Claude can search it from any chat.',
    window: 'Claude',
    file: 'Settings, Connectors',
    steps: [
      <>In Claude, open <b>Settings</b>, then <b>Connectors</b>, then <b>Add custom connector</b>.</>,
      <>Name it <b>Stash</b> and paste this address. Claude connectors take a URL only, so the key travels in it: treat the address like a password.</>,
    ],
    reload: <>Start a new chat and switch Stash on from the tools menu.</>,
    code: (url, key) => url + '?key=' + key,
  },
  {
    key: 'windsurf',
    name: 'Windsurf',
    short: 'Windsurf',
    maker: 'Windsurf',
    Mark: WindsurfMark,
    tone: '#efefeb',
    where: 'In Cascade',
    workflow: 'Cascade can search Stash while it plans a change.',
    window: 'Windsurf — Cascade',
    file: '~/.codeium/windsurf/mcp_config.json',
    steps: [<>Open <b>~/.codeium/windsurf/mcp_config.json</b> and add:</>],
    reload: <>Refresh the MCP servers list in Cascade&apos;s settings, or restart Windsurf.</>,
    code: (url, key) => json({ mcpServers: { stash: { serverUrl: url, headers: { Authorization: 'Bearer ' + key } } } }),
  },
  {
    key: 'other',
    name: 'Other MCP clients',
    short: 'MCP',
    maker: 'Remote MCP over HTTP',
    Mark: PlugIcon,
    tone: '#efefeb',
    where: 'Anywhere MCP runs',
    workflow: 'Any client that supports remote MCP servers over HTTP can use Stash.',
    window: 'MCP client',
    file: 'Your client’s MCP settings',
    steps: [<>Any client that supports remote MCP servers over HTTP works. Use this address and header:</>],
    reload: <>Restart the client or reload its MCP servers.</>,
    code: (url, key) => 'URL     ' + url + '\nHeader  Authorization: Bearer ' + key,
  },
];

/** The three the homepage stars. */
export const HERO_AGENTS = ['claude-code', 'cursor', 'vscode'];

export const clientOf = (key) => CLIENTS.find((c) => c.key === key) || CLIENTS[0];

/** A friendly name for the clientInfo.name an agent sends on initialize. */
export function clientLabel(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s) return null;
  if (s.includes('claude-code') || s.includes('claude code')) return 'Claude Code';
  if (s.includes('claude')) return 'Claude';
  if (s.includes('cursor')) return 'Cursor';
  if (s.includes('visual studio code') || s.includes('vscode') || s.includes('copilot')) return 'VS Code';
  if (s.includes('windsurf')) return 'Windsurf';
  return raw;
}
