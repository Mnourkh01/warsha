// App-chrome strings, one typed English table. The Arabic locale switch was removed
// (2026-07-24): chrome localization was not worth its complexity for a terminal surface
// that stays LTR English regardless. User-named content (sessions, workspaces) still
// renders Arabic correctly via dir="auto" / bidi-auto, and terminal OUTPUT keeps its
// Arabic shaping (arabicGlyphs.ts) - neither depends on a UI locale.

const en = {
  // sidebar header
  newWorkspace: "New workspace",
  newSession: "New session",
  toggleTheme: "Toggle theme",
  toggleThemeAria: "Toggle light or dark theme",
  settings: "Settings",
  hideSidebar: "Hide sidebar (Ctrl+Shift+B)",
  hideSidebarAria: "Hide sidebar",
  showSidebar: "Show sidebar (Ctrl+Shift+B)",
  showSidebarAria: "Show sidebar",
  treeEmpty: "No sessions yet. Press the + button above, or Ctrl K, to open your first terminal.",

  // workspace rows
  expandWorkspace: "Expand workspace",
  collapseWorkspace: "Collapse workspace",
  workspaceName: "Workspace name",
  workspaceFull: (max: number) => `Workspace full (${max})`,
  newSessionHere: "New session here",
  newSessionIn: (name: string) => `New session in ${name}`,
  rename: "Rename",
  renameWorkspaceNamed: (name: string) => `Rename workspace ${name}`,
  deleteWorkspace: "Delete workspace",
  deleteWorkspaceNamed: (name: string) => `Delete workspace ${name}`,
  deleteWorkspaceConfirm: (name: string, count: number) =>
    `Delete "${name}" and close its ${count} session(s)?`,
  sessionsNeedAttention: (n: number) => `${n} sessions need attention`,
  setWorkspaceFolder: "Set project folder",
  setWorkspaceFolderFor: (name: string) => `Set project folder for ${name}`,
  workspaceFolderTitle: (path: string) => `Project folder: ${path}`,
  chooseWorkspaceFolder: (name: string) => `Choose the project folder for ${name}`,

  // workspace templates
  templatesGroup: "Templates",
  saveAsTemplate: "Save as template",
  saveAsTemplateNamed: (name: string) => `Save ${name} as a template`,
  openTemplateTitle: (name: string, n: number) =>
    `Open ${name} as a new workspace (${n} session${n === 1 ? "" : "s"})`,
  deleteTemplate: "Delete template",
  deleteTemplateNamed: (name: string) => `Delete template ${name}`,
  deleteTemplateConfirm: (name: string) =>
    `Delete the template "${name}"? Open workspaces are not affected.`,
  cmdOpenTemplate: (name: string) => `Open template: ${name}`,
  hintTemplate: "template",

  // session rows and panes
  sessionName: "Session name",
  restart: "Restart",
  restartNamed: (name: string) => `Restart ${name}`,
  renameNamed: (name: string) => `Rename ${name}`,
  closeSession: "Close session",
  closeNamed: (name: string) => `Close ${name}`,
  changeFolder: "Change folder (no restart)",
  changeFolderNamed: (name: string) => `Change folder for ${name}`,
  changeFolderTitle: (name: string) => `Choose a new folder for ${name}`,
  statusRunning: "Running",
  statusExited: "Exited",
  statusIdle: "Idle",
  needsAttention: "Needs attention",
  attentionHint: "Finished or waiting for input",
  maximizePane: "Maximize pane (Ctrl+Shift+M)",
  restorePane: "Restore pane (Ctrl+Shift+M)",
  maximizeNamed: (name: string) => `Maximize ${name}`,
  restoreNamed: (name: string) => `Restore ${name}`,

  // empty workspace
  emptyWorkspaceTitle: "This workspace is empty.",
  emptyHintPress: "Press",
  emptyHintOr: "or the",
  emptyHintEnd: "button to start a session.",
  startClaudeHere: "Start Claude Code here",

  // find bar
  findInTerminal: "Find in terminal",
  searchText: "Search text",
  findPlaceholder: "Find...",
  prevMatch: "Previous match (Shift+Enter)",
  prevMatchAria: "Previous match",
  nextMatch: "Next match (Enter)",
  nextMatchAria: "Next match",
  closeFindBar: "Close find bar",
  close: "Close",

  // command palette
  commandPalette: "Command palette",
  searchCommands: "Search commands",
  palettePlaceholder: "Type a command, workspace, or session name...",
  paletteEmpty: "No matching commands.",
  cmdNewPicker: "New session in a folder...",
  cmdNewPs: "New PowerShell session",
  cmdNewCmd: "New Command Prompt session",
  cmdNewWsl: "New WSL session",
  cmdNewBash: "New Bash session",
  cmdCloseActive: "Close active session",
  cmdRestartActive: "Restart active session",
  cmdMaximize: "Maximize / restore active pane",
  cmdFontUp: "Increase terminal font size",
  cmdFontDown: "Decrease terminal font size",
  cmdToggleSidebar: "Toggle sidebar",
  cmdShortcuts: "Keyboard shortcuts",
  cmdToggleTheme: "Toggle light / dark theme",
  cmdSettings: "Open settings",
  cmdSwitchTo: (name: string) => `Switch to: ${name}`,
  cmdOpen: (name: string) => `Open: ${name}`,
  hintLayout: "layout",
  hintSession: "session",
  hintWorkspace: "workspace",

  // settings dialog
  closeSettings: "Close settings",
  appTheme: "App theme",
  themeDark: "Dark",
  themeLight: "Light",
  themeSystem: "System",
  terminalColors: "Terminal colors",
  terminalColorsHint: "(keep dark so CLIs like Claude look right)",
  matchApp: "Match app",
  terminalFontSize: "Terminal font size",
  smaller: "Smaller",
  larger: "Larger",
  decreaseFont: "Decrease font size",
  increaseFont: "Increase font size",
  terminalTextWeight: "Terminal text weight",
  weightNormal: "Normal",
  weightBold: "Bold",
  terminalTextColor: "Terminal text color",
  themeDefault: "Theme default",
  defaultShellLabel: "Default shell for new sessions",
  customShell: (program: string) => `Custom (${program})`,
  defaultFolderLabel: "Default project folder",
  defaultFolderHint: "(new sessions can start here in one click)",
  notSet: "Not set",
  browse: "Browse",
  clear: "Clear",
  pickerFailed: "Could not open the folder picker. Try again.",
  chooseDefaultFolder: "Choose your default project folder",

  // new session wizard
  whereStart: (label: string) => `Where should ${label} start?`,
  stepOf: (n: number) => `step ${n} of 3`,
  pickShellHint: "pick a terminal type",
  pickAiTitle: "Add an AI assistant?",
  pickAiHint: (shell: string) => `it will run inside ${shell}`,
  aiNoneLabel: "Just the shell",
  pickFolderHint: "pick a folder",
  back: "Back",
  backToShells: "Back to terminal types",
  backToAi: "Back to AI choice",
  notInstalled: (label: string) => `${label} is not installed. Run this to add it:`,
  copy: "Copy",
  copyInstall: "Copy install command",
  checkFailed: (label: string) => `Could not check whether ${label} is installed. Try again.`,
  defaultFolderBtn: "Default folder",
  chooseFolderBtn: "Choose a folder...",
  opensFolderBrowser: "opens a folder browser",
  noFolderBtn: "No folder (start in home)",
  chooseFolderFor: (label: string) => `Choose a folder for ${label}`,
  workspaceFullMsg: (max: number) =>
    `This workspace already has ${max} sessions. Make a new workspace or close one.`,
  sessionsOpenNote: (max: number) => `Sessions open in the active workspace (up to ${max}).`,

  // update toast
  updateAvailable: (version: string) => `Warsha ${version} is available`,
  updateDownload: "Download",
  updateLater: "Later",

  // shortcuts dialog
  keyboardShortcuts: "Keyboard shortcuts",
  closeShortcuts: "Close shortcuts",
  scPalette: "Command palette",
  scSidebar: "Toggle sidebar",
  scFind: "Find in the active terminal",
  scMaximize: "Maximize / restore the active pane",
  scCopy: "Copy selection in the terminal",
  scPaste: "Paste into the terminal",
  scEscape: "Close the topmost dialog or the find bar",
  scSigint: "Stays SIGINT for the shell (not copy)",
};

export type Strings = typeof en;

/** Strings for components. Kept as a hook-shaped helper so a future locale could return. */
export function useStrings(): Strings {
  return en;
}

/** Strings for actions and native dialog titles (non-component call sites). */
export function strings(): Strings {
  return en;
}
