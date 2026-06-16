/*
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => SideNote
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/commentManager.ts
async function generateHash(text) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (error) {
    try {
      const nodeCrypto = require("crypto");
      return nodeCrypto.createHash("sha256").update(text).digest("hex");
    } catch (e) {
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      return Math.abs(hash).toString(16);
    }
  }
}
var CommentManager = class {
  constructor(comments) {
    __publicField(this, "comments");
    __publicField(this, "MIN_TEXT_LENGTH", 3);
    this.comments = comments;
  }
  getCommentsForFile(filePath) {
    return this.comments.filter((comment) => comment.filePath === filePath);
  }
  async addComment(newComment) {
    if (!newComment.selectedTextHash) {
      newComment.selectedTextHash = await generateHash(newComment.selectedText);
    }
    this.comments.push(newComment);
  }
  editComment(timestamp, newCommentText, newColor) {
    const commentToEdit = this.comments.find((comment) => comment.timestamp === timestamp);
    if (commentToEdit) {
      commentToEdit.comment = newCommentText;
      if (newColor) commentToEdit.color = newColor;
    }
  }
  deleteComment(timestamp) {
    const indexToDelete = this.comments.findIndex((comment) => comment.timestamp === timestamp);
    if (indexToDelete > -1) {
      this.comments.splice(indexToDelete, 1);
    }
  }
  deleteOrphanedComments() {
    const initialLength = this.comments.length;
    for (let i = this.comments.length - 1; i >= 0; i--) {
      if (this.comments[i].isOrphaned) {
        this.comments.splice(i, 1);
      }
    }
    return initialLength - this.comments.length;
  }
  getOrphanedComments() {
    return this.comments.filter((comment) => comment.isOrphaned);
  }
  getOrphanedCommentCount() {
    return this.comments.filter((comment) => comment.isOrphaned).length;
  }
  renameFile(oldPath, newPath) {
    this.comments.forEach((comment) => {
      if (comment.filePath === oldPath) {
        comment.filePath = newPath;
      }
    });
  }
  updateComments(newComments) {
    this.comments = newComments;
  }
  getComments() {
    return this.comments;
  }
  // --- 核心定位逻辑重构 ---
  /**
   * 将绝对索引转换为行号和列号
   */
  getPositionFromIndex(content, index) {
    if (index < 0) return { line: 0, ch: 0 };
    if (index > content.length) index = content.length;
    const textBefore = content.substring(0, index);
    const lines = textBefore.split("\n");
    const line = lines.length - 1;
    const ch = lines[lines.length - 1].length;
    return { line, ch };
  }
  /**
   * 根据行号和列号估算在当前文档中的绝对索引位置
   * 用于在有多个匹配项时，找到离原位置最近的那个
   */
  getApproximateIndex(content, line, char) {
    const lines = content.split("\n");
    let index = 0;
    for (let i = 0; i < Math.min(line, lines.length); i++) {
      index += lines[i].length + 1;
    }
    return index + char;
  }
  /**
   * 更新评论坐标的核心方法
   * 新策略：
   * 1. 优先信任 absoluteFrom/absoluteTo，并校验当前位置文字。
   * 2. 在相同标题块内找候选，降低重复文字跨章节误匹配。
   * 3. 对所有候选做综合评分：文本、上下文、标题路径、旧位置、重复序号。
   * 4. 分数不足或第一、第二候选差距过小时，标记为孤儿，避免错误高亮。
   */
  async updateCommentCoordinatesForFile(fileContent, filePath) {
    const fileComments = this.comments.filter((comment) => comment.filePath === filePath);
    for (const comment of fileComments) {
      const selectedText = comment.selectedText || "";
      if (!selectedText) {
        comment.isOrphaned = true;
        continue;
      }
      if (this.isOffsetMatch(fileContent, comment)) {
        this.applyMatch(comment, fileContent, comment.absoluteFrom, selectedText);
        continue;
      }
      const estimatedOldIndex = typeof comment.absoluteFrom === "number" ? comment.absoluteFrom : this.getApproximateIndex(fileContent, comment.startLine, comment.startChar);
      const scope = this.getSearchScope(fileContent, comment);
      const candidates = this.collectCandidates(fileContent, comment, scope);
      if (candidates.length === 0) {
        comment.isOrphaned = true;
        continue;
      }
      const scored = candidates.map((candidate) => ({
        ...candidate,
        score: this.scoreCandidate(fileContent, candidate.index, candidate.text, comment, estimatedOldIndex)
      })).sort((a, b) => b.score - a.score);
      const best = scored[0];
      const second = scored[1];
      const hasRepeatedText = this.countOccurrences(fileContent, selectedText) > 1;
      const clearWinner = !second || best.score - second.score >= (hasRepeatedText ? 12 : 6);
      const scoreEnough = best.score >= (hasRepeatedText ? 82 : 62);
      if (scoreEnough && clearWinner) {
        this.applyMatch(comment, fileContent, best.index, best.text);
      } else {
        comment.isOrphaned = true;
      }
    }
  }
  isOffsetMatch(content, comment) {
    if (typeof comment.absoluteFrom !== "number" || typeof comment.absoluteTo !== "number") return false;
    if (comment.absoluteFrom < 0 || comment.absoluteTo > content.length || comment.absoluteFrom >= comment.absoluteTo) return false;
    return content.slice(comment.absoluteFrom, comment.absoluteTo) === comment.selectedText;
  }
  applyMatch(comment, content, index, text) {
    const newStart = this.getPositionFromIndex(content, index);
    const newEnd = this.getPositionFromIndex(content, index + text.length);
    comment.startLine = newStart.line;
    comment.startChar = newStart.ch;
    comment.endLine = newEnd.line;
    comment.endChar = newEnd.ch;
    comment.absoluteFrom = index;
    comment.absoluteTo = index + text.length;
    comment.selectedText = text;
    comment.isOrphaned = false;
  }
  collectCandidates(content, comment, scope) {
    const candidates = /* @__PURE__ */ new Map();
    const selectedText = comment.selectedText || "";
    let searchPos = scope.start;
    while (selectedText && searchPos <= scope.end) {
      const found = content.indexOf(selectedText, searchPos);
      if (found === -1 || found + selectedText.length > scope.end) break;
      candidates.set(found, { index: found, text: selectedText, source: "exact" });
      searchPos = found + 1;
    }
    if (comment.contextBefore && comment.contextAfter) {
      const beforeSnippet = comment.contextBefore.slice(-40);
      const afterSnippet = comment.contextAfter.slice(0, 40);
      if (beforeSnippet && afterSnippet) {
        const escapedBefore = this.escapeRegExp(beforeSnippet);
        const escapedAfter = this.escapeRegExp(afterSnippet);
        const maxMiddle = Math.max(selectedText.length + 120, 160);
        const regex = new RegExp(`${escapedBefore}([\\s\\S]{0,${maxMiddle}}?)${escapedAfter}`, "g");
        const scopedText = content.slice(scope.start, scope.end);
        for (const match of scopedText.matchAll(regex)) {
          if (match.index === void 0 || match[1] === void 0) continue;
          const whole = match[0];
          const middle = match[1];
          const localMiddleStart = match.index + whole.indexOf(middle);
          const index = scope.start + localMiddleStart;
          if (!candidates.has(index)) {
            candidates.set(index, { index, text: middle, source: "context" });
          }
        }
      }
    }
    return [...candidates.values()];
  }
  scoreCandidate(content, index, text, comment, estimatedOldIndex) {
    var _a;
    let score = 0;
    const selectedText = comment.selectedText || "";
    if (text === selectedText) score += 55;
    else score += this.similarity(text, selectedText) * 35;
    const beforeNow = content.slice(Math.max(0, index - 60), index);
    const afterNow = content.slice(index + text.length, Math.min(content.length, index + text.length + 60));
    if (comment.contextBefore) {
      score += this.similarity(comment.contextBefore.slice(-60), beforeNow) * 28;
    }
    if (comment.contextAfter) {
      score += this.similarity(comment.contextAfter.slice(0, 60), afterNow) * 28;
    }
    if ((_a = comment.headingPath) == null ? void 0 : _a.length) {
      const position = this.getPositionFromIndex(content, index);
      const currentHeadingPath = this.getHeadingPath(content, position.line);
      if (this.sameStringArray(currentHeadingPath, comment.headingPath)) score += 20;
      else score += this.headingPathSimilarity(currentHeadingPath, comment.headingPath) * 10;
    }
    if (typeof comment.occurrenceIndex === "number" && selectedText) {
      const occurrence = this.getOccurrenceIndex(content, selectedText, index);
      if (occurrence === comment.occurrenceIndex) score += 16;
      else if (occurrence >= 0) score += Math.max(0, 8 - Math.abs(occurrence - comment.occurrenceIndex) * 3);
    }
    const distance = Math.abs(index - estimatedOldIndex);
    score += Math.max(0, 18 - distance / 120);
    return score;
  }
  getSearchScope(content, comment) {
    var _a;
    if (!((_a = comment.headingPath) == null ? void 0 : _a.length)) return { start: 0, end: content.length };
    const range = this.findHeadingRange(content, comment.headingPath);
    return range || { start: 0, end: content.length };
  }
  findHeadingRange(content, headingPath) {
    const lines = content.split("\n");
    let offset = 0;
    let startLine = -1;
    let startOffset = -1;
    let level = -1;
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const path = this.getHeadingPath(content, i);
        if (this.sameStringArray(path, headingPath)) {
          startLine = i;
          startOffset = offset;
          level = match[1].length;
          break;
        }
      }
      offset += lines[i].length + 1;
    }
    if (startLine < 0) return null;
    let endOffset = content.length;
    offset = 0;
    for (let i = 0; i < lines.length; i++) {
      if (i <= startLine) {
        offset += lines[i].length + 1;
        continue;
      }
      const match = lines[i].match(/^(#{1,6})\s+(.*)$/);
      if (match && match[1].length <= level) {
        endOffset = offset;
        break;
      }
      offset += lines[i].length + 1;
    }
    return { start: startOffset, end: endOffset };
  }
  getHeadingPath(content, line) {
    const lines = content.split("\n");
    const stack = [];
    for (let i = 0; i <= Math.min(line, lines.length - 1); i++) {
      const match = lines[i].match(/^(#{1,6})\s+(.*)$/);
      if (!match) continue;
      const level = match[1].length;
      const text = match[2].trim();
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, text });
    }
    return stack.map((item) => item.text);
  }
  getOccurrenceIndex(content, selectedText, targetIndex) {
    if (!selectedText) return -1;
    let count = 0;
    let searchPos = 0;
    while (true) {
      const found = content.indexOf(selectedText, searchPos);
      if (found === -1) return -1;
      if (found === targetIndex) return count;
      count++;
      searchPos = found + 1;
    }
  }
  countOccurrences(content, selectedText) {
    if (!selectedText) return 0;
    let count = 0;
    let searchPos = 0;
    while (true) {
      const found = content.indexOf(selectedText, searchPos);
      if (found === -1) break;
      count++;
      searchPos = found + 1;
    }
    return count;
  }
  similarity(a, b) {
    if (a === b) return 1;
    if (!a || !b) return 0;
    const bigrams = (text) => {
      const normalized = text.replace(/\s+/g, " ").trim();
      const set = /* @__PURE__ */ new Set();
      for (let i = 0; i < normalized.length - 1; i++) set.add(normalized.slice(i, i + 2));
      if (set.size === 0 && normalized) set.add(normalized);
      return set;
    };
    const aSet = bigrams(a);
    const bSet = bigrams(b);
    if (aSet.size === 0 || bSet.size === 0) return 0;
    let intersection = 0;
    aSet.forEach((item) => {
      if (bSet.has(item)) intersection++;
    });
    return 2 * intersection / (aSet.size + bSet.size);
  }
  headingPathSimilarity(a, b) {
    if (this.sameStringArray(a, b)) return 1;
    const max = Math.max(a.length, b.length);
    if (max === 0) return 0;
    let same = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] === b[i]) same++;
    }
    return same / max;
  }
  sameStringArray(a, b) {
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }
  escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
};

// src/main.ts
var import_view = require("@codemirror/view");
var import_state = require("@codemirror/state");
async function generateHash2(text) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (error) {
    try {
      const nodeCrypto = require("crypto");
      return nodeCrypto.createHash("sha256").update(text).digest("hex");
    } catch (e) {
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      return Math.abs(hash).toString(16);
    }
  }
}
async function generateBinaryHash(buffer) {
  try {
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (error) {
    const nodeCrypto = require("crypto");
    return nodeCrypto.createHash("sha256").update(Buffer.from(buffer)).digest("hex");
  }
}
var forceUpdateEffect = import_state.StateEffect.define();
var DEFAULT_SETTINGS = {
  commentSortOrder: "position",
  showHighlights: true,
  markdownFolder: "side-note-comments",
  attachmentFolder: "side-note-attachments",
  highlightColor: "#FFC800",
  highlightOpacity: 0.2,
  enableSelectionToolbar: true,
  commentsDataFolder: "side-note-data"
};
var SHORTCUT_COMMANDS = [
  { label: "\u52A0\u7C97", commandName: "\u4E3A\u9009\u4E2D\u5185\u5BB9\u6DFB\u52A0\u52A0\u7C97" },
  { label: "\u9AD8\u4EAE", commandName: "\u4E3A\u9009\u4E2D\u5185\u5BB9\u6DFB\u52A0\u9AD8\u4EAE" },
  { label: "\u6279\u6CE8", commandName: "\u4E3A\u9009\u4E2D\u5185\u5BB9\u6DFB\u52A0\u6279\u6CE8 (\u5F39\u51FA\u8F93\u5165\u6846)" },
  { label: "\u4E0B\u5212\u7EBF", commandName: "\u4E3A\u9009\u4E2D\u5185\u5BB9\u6DFB\u52A0\u4E0B\u5212\u7EBF" }
];
var SideNoteView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin, file = null) {
    super(leaf);
    __publicField(this, "file", null);
    __publicField(this, "plugin");
    __publicField(this, "activeCommentTimestamp", null);
    __publicField(this, "searchQuery", "");
    __publicField(this, "allCollapsed", false);
    // 新增：用于记录重绘前的滚动位置
    __publicField(this, "lastScrollTop", 0);
    this.plugin = plugin;
    this.file = file;
  }
  getViewType() {
    return "sidenote-view";
  }
  getDisplayText() {
    return "Side Note";
  }
  getIcon() {
    return "message-square";
  }
  async onOpen() {
    await Promise.resolve();
    if (!this.file) {
      this.file = this.app.workspace.getActiveFile();
    }
    this.renderView();
  }
  async setState(state, result) {
    if (state.filePath) {
      const file = this.app.vault.getAbstractFileByPath(state.filePath);
      if (file instanceof import_obsidian.TFile) {
        this.file = file;
        this.renderView();
      }
    }
    await super.setState(state, result);
  }
  updateActiveFile(file) {
    this.file = file;
    this.renderView();
  }
  highlightComment(timestamp) {
    this.activeCommentTimestamp = timestamp;
    this.renderView();
    setTimeout(() => {
      const commentEl = this.containerEl.querySelector(`[data-comment-timestamp="${timestamp}"]`);
      if (commentEl) {
        commentEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }, 100);
  }
  renderView() {
    var _a, _b;
    (_b = (_a = this.plugin).unloadMarkdownRenderComponentsUnder) == null ? void 0 : _b.call(_a, this.containerEl);
    const currentContainer = this.containerEl.querySelector(".sidenote-comments-list-wrapper");
    if (currentContainer) {
      this.lastScrollTop = currentContainer.scrollTop;
    }
    this.containerEl.empty();
    this.containerEl.addClass("sidenote-view-container");
    const toolbar = this.containerEl.createDiv("sidenote-toolbar");
    const searchInput = toolbar.createEl("input", {
      type: "text",
      placeholder: "Search comments..."
    });
    searchInput.value = this.searchQuery;
    searchInput.oninput = (e) => {
      const target = e.target;
      this.searchQuery = target.value.toLowerCase();
      this.renderCommentsList(commentsContainer);
    };
    const exportBtn = toolbar.createEl("button", { cls: "clickable-icon" });
    exportBtn.setAttribute("aria-label", "Export to Markdown");
    (0, import_obsidian.setIcon)(exportBtn, "file-up");
    exportBtn.onclick = async () => {
      await this.exportCommentsToMarkdown();
    };
    const sortBtn = toolbar.createEl("button", { cls: "clickable-icon" });
    sortBtn.setAttribute("aria-label", this.plugin.settings.commentSortOrder === "position" ? "Sort by Time" : "Sort by Position");
    (0, import_obsidian.setIcon)(sortBtn, this.plugin.settings.commentSortOrder === "position" ? "arrow-down-narrow-wide" : "clock");
    sortBtn.onclick = async () => {
      this.plugin.settings.commentSortOrder = this.plugin.settings.commentSortOrder === "position" ? "timestamp" : "position";
      await this.plugin.saveData();
      (0, import_obsidian.setIcon)(sortBtn, this.plugin.settings.commentSortOrder === "position" ? "arrow-down-narrow-wide" : "clock");
      sortBtn.setAttribute("aria-label", this.plugin.settings.commentSortOrder === "position" ? "Sort by Time" : "Sort by Position");
      this.renderCommentsList(commentsContainer);
    };
    const collapseBtn = toolbar.createEl("button", { cls: "clickable-icon" });
    collapseBtn.setAttribute("aria-label", this.allCollapsed ? "Expand All" : "Collapse All");
    (0, import_obsidian.setIcon)(collapseBtn, this.allCollapsed ? "chevrons-up-down" : "chevrons-down-up");
    collapseBtn.onclick = () => {
      this.allCollapsed = !this.allCollapsed;
      (0, import_obsidian.setIcon)(collapseBtn, this.allCollapsed ? "chevrons-up-down" : "chevrons-down-up");
      collapseBtn.setAttribute("aria-label", this.allCollapsed ? "Expand All" : "Collapse All");
      const contentEls = this.containerEl.querySelectorAll(".sidenote-comment-content");
      contentEls.forEach((el) => el.classList.toggle("collapsed", this.allCollapsed));
    };
    const commentsContainer = this.containerEl.createDiv("sidenote-comments-list-wrapper");
    this.renderCommentsList(commentsContainer);
    if (this.lastScrollTop > 0) {
      setTimeout(() => {
        commentsContainer.scrollTop = this.lastScrollTop;
      }, 0);
    }
  }
  async exportCommentsToMarkdown() {
    if (!this.file) {
      new import_obsidian.Notice("No file selected.");
      return;
    }
    const comments = this.plugin.commentManager.getCommentsForFile(this.file.path);
    if (comments.length === 0) {
      new import_obsidian.Notice("No comments to export.");
      return;
    }
    const sortedComments = [...comments].sort((a, b) => {
      if (a.startLine === b.startLine) return a.startChar - b.startChar;
      return a.startLine - b.startLine;
    });
    let content = `Source: [[${this.file.path}|${this.file.basename}]]

`;
    sortedComments.forEach((c) => {
      const quoteText = c.selectedText.replace(/\n/g, "\n> ");
      const commentBody = c.comment.replace(/\n/g, "\n>> ");
      const dateStr = window.moment(c.timestamp).format("YYYY-MM-DD HH:mm:ss");
      content += `> [!quote] sidenote
> ${quoteText}
>> [!note]+ ${dateStr}
>> ${commentBody}

`;
    });
    const filename = `${this.file.basename} - SideNote ${window.moment().format("YYYYMMDDHHmmss")}.md`;
    try {
      const file = await this.app.vault.create(filename, content);
      await this.app.workspace.getLeaf(true).openFile(file);
      new import_obsidian.Notice(`Exported to ${filename}`);
    } catch (error) {
      new import_obsidian.Notice("Error exporting file.");
    }
  }
  renderCommentsList(container) {
    container.empty();
    if (!this.file) {
      container.createDiv("sidenote-empty-state").createEl("p", { text: "No file selected." });
      return;
    }
    let commentsForFile = this.plugin.commentManager.getCommentsForFile(this.file.path);
    if (this.searchQuery) {
      commentsForFile = commentsForFile.filter(
        (c) => c.comment && c.comment.toLowerCase().includes(this.searchQuery) || c.selectedText && c.selectedText.toLowerCase().includes(this.searchQuery)
      );
    }
    if (this.plugin.settings.commentSortOrder === "position") {
      commentsForFile.sort((a, b) => {
        if (a.startLine === b.startLine) return a.startChar - b.startChar;
        return a.startLine - b.startLine;
      });
    } else {
      commentsForFile.sort((a, b) => a.timestamp - b.timestamp);
    }
    if (commentsForFile.length > 0) {
      const listEl = container.createDiv("sidenote-comments-container");
      commentsForFile.forEach(async (comment) => {
        const commentEl = listEl.createDiv("sidenote-comment-item");
        commentEl.setAttribute("data-comment-timestamp", comment.timestamp.toString());
        if (this.activeCommentTimestamp === comment.timestamp) {
          commentEl.addClass("active");
        }
        if (comment.color) {
          const rgb = this.plugin.hexToRgb(comment.color);
          const opacity = this.plugin.settings.highlightOpacity;
          commentEl.style.setProperty("--sidenote-highlight-color", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`);
          commentEl.style.setProperty("--sidenote-highlight-border", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.min(opacity + 0.4, 1)})`);
          commentEl.style.setProperty("--interactive-accent", comment.color);
          commentEl.style.setProperty("--interactive-accent-translucent", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`);
        }
        const headerEl = commentEl.createDiv("sidenote-comment-header");
        const textInfoEl = headerEl.createDiv("sidenote-comment-text-info");
        const selectedTextEl = textInfoEl.createDiv({ cls: "sidenote-selected-text markdown-rendered" });
        await this.plugin.renderCommentContent(comment.selectedText || "", selectedTextEl, comment.filePath);
        this.setupExpandableText(selectedTextEl);
        textInfoEl.createEl("small", { text: new Date(comment.timestamp).toLocaleString(), cls: "sidenote-timestamp" });
        const actionsEl = headerEl.createDiv("sidenote-comment-actions");
        commentEl.onclick = async () => {
          var _a;
          this.activeCommentTimestamp = comment.timestamp;
          const container2 = this.containerEl.querySelector(".sidenote-comments-list-wrapper");
          if (!container2) return;
          this.lastScrollTop = ((_a = container2.parentElement) == null ? void 0 : _a.scrollTop) || 0;
          container2.querySelectorAll(".sidenote-comment-item").forEach((el) => el.removeClass("active"));
          commentEl.addClass("active");
          await this.jumpToComment(comment);
        };
        commentEl.ondblclick = (e) => {
          e.stopPropagation();
          new CommentModal(this.plugin.app, this.plugin, { mode: "edit", comment }).open();
        };
        const contentWrapper = commentEl.createDiv({ cls: `sidenote-comment-content markdown-rendered${this.allCollapsed ? " collapsed" : ""}` });
        await this.plugin.renderCommentContent(comment.comment || "", contentWrapper, comment.filePath);
        this.setupExpandableText(contentWrapper);
        const menuButton = actionsEl.createEl("button", { cls: "sidenote-menu-button clickable-icon" });
        (0, import_obsidian.setIcon)(menuButton, "more-vertical");
        const menuContainer = actionsEl.createDiv("sidenote-action-menu");
        const editOption = menuContainer.createEl("button", { text: "\u7F16\u8F91\u6279\u6CE8", cls: "sidenote-menu-option" });
        editOption.onclick = (e) => {
          e.stopPropagation();
          menuContainer.classList.remove("visible");
          new CommentModal(this.app, this.plugin, { mode: "edit", comment }).open();
        };
        const copyOption = menuContainer.createEl("button", { text: "\u590D\u5236\u56DE\u94FE", cls: "sidenote-menu-option" });
        copyOption.onclick = (e) => {
          e.stopPropagation();
          menuContainer.classList.remove("visible");
          this.plugin.copyBacklink(comment);
        };
        const searchOption = menuContainer.createEl("button", { text: "\u5728\u5E93\u4E2D\u641C\u7D22", cls: "sidenote-menu-option" });
        searchOption.onclick = (e) => {
          e.stopPropagation();
          menuContainer.classList.remove("visible");
          this.app.internalPlugins.getPluginById("global-search").instance.openGlobalSearch(comment.selectedText);
        };
        const deleteOption = menuContainer.createEl("button", { text: "\u5220\u9664\u6279\u6CE8", cls: "sidenote-menu-option sidenote-menu-delete" });
        deleteOption.onclick = (e) => {
          e.stopPropagation();
          menuContainer.classList.remove("visible");
          this.plugin.deleteComment(comment.timestamp);
        };
        menuButton.onclick = (e) => {
          e.stopPropagation();
          document.querySelectorAll(".sidenote-action-menu.visible").forEach((el) => {
            if (el !== menuContainer) el.classList.remove("visible");
          });
          menuContainer.classList.toggle("visible");
          if (menuContainer.classList.contains("visible")) {
            setTimeout(() => {
              document.addEventListener("click", (e2) => {
                if (!menuButton.contains(e2.target)) menuContainer.classList.remove("visible");
              }, { once: true, capture: true });
            }, 0);
          }
        };
      });
    } else {
      const emptyStateEl = container.createDiv("sidenote-empty-state");
      emptyStateEl.createEl("p", { text: this.searchQuery ? "No comments match your search." : "No comments for this file yet." });
    }
  }
  setupExpandableText(el) {
    setTimeout(() => {
      if (el.scrollHeight > el.clientHeight + 2) {
        el.addClass("is-truncated");
        el.onclick = (e) => {
          e.stopPropagation();
          if (el.hasClass("expanded")) {
            el.removeClass("expanded");
            el.addClass("is-truncated");
          } else {
            el.addClass("expanded");
            el.removeClass("is-truncated");
          }
        };
      }
    }, 50);
  }
  renderComments() {
    this.renderView();
  }
  async jumpToComment(comment) {
    var _a, _b;
    let targetLeaf = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      var _a2;
      if (leaf.view instanceof import_obsidian.MarkdownView && ((_a2 = leaf.view.file) == null ? void 0 : _a2.path) === comment.filePath) {
        targetLeaf = leaf;
        return false;
      }
    });
    if (!targetLeaf) {
      const file = this.app.vault.getAbstractFileByPath(comment.filePath);
      if (file instanceof import_obsidian.TFile) {
        const newLeaf = this.app.workspace.getLeaf(true);
        await newLeaf.openFile(file);
        targetLeaf = newLeaf;
      }
    }
    if (targetLeaf && targetLeaf.view instanceof import_obsidian.MarkdownView) {
      this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
      if (import_obsidian.Platform.isMobile) {
        (_a = this.app.workspace.leftSplit) == null ? void 0 : _a.collapse();
        (_b = this.app.workspace.rightSplit) == null ? void 0 : _b.collapse();
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      const editor = targetLeaf.view.editor;
      const fileContent = editor.getValue();
      await this.plugin.commentManager.updateCommentCoordinatesForFile(fileContent, comment.filePath);
      await this.plugin.saveCommentsForSingleFile(comment.filePath);
      const updatedComment = this.plugin.comments.find((c) => c.timestamp === comment.timestamp);
      if (!updatedComment || updatedComment.isOrphaned) {
        new import_obsidian.Notice("Comment text not found in document.");
        return;
      }
      editor.focus();
      editor.setSelection(
        { line: updatedComment.startLine, ch: updatedComment.startChar },
        { line: updatedComment.endLine, ch: updatedComment.endChar }
      );
      editor.scrollIntoView({ from: { line: updatedComment.startLine, ch: 0 }, to: { line: updatedComment.endLine, ch: 0 } }, true);
    }
  }
  getState() {
    return { filePath: this.file ? this.file.path : null };
  }
  onunload() {
    var _a, _b;
    (_b = (_a = this.plugin).unloadMarkdownRenderComponentsUnder) == null ? void 0 : _b.call(_a, this.containerEl);
  }
};
async function switchToSideNoteView(app) {
  const activeFile = app.workspace.getActiveFile();
  if (!activeFile) {
    new import_obsidian.Notice("No active Markdown file found.");
    return;
  }
  let leaf = app.workspace.getLeaf("split", "vertical");
  if (leaf) {
    await leaf.setViewState({ type: "sidenote-view", state: { filePath: activeFile.path }, active: true });
    void app.workspace.revealLeaf(leaf);
  }
}
var CommentModal = class extends import_obsidian.Modal {
  constructor(app, plugin, options) {
    super(app);
    __publicField(this, "plugin");
    __publicField(this, "comment");
    __publicField(this, "mode");
    __publicField(this, "colorInput");
    __publicField(this, "commentText");
    __publicField(this, "selectedText");
    __publicField(this, "filePath");
    __publicField(this, "onSubmitAdd");
    __publicField(this, "textareaEl", null);
    this.plugin = plugin;
    this.mode = options.mode;
    if (this.mode === "edit" && options.comment) {
      this.comment = options.comment;
      this.selectedText = this.comment.selectedText || "";
      this.filePath = this.comment.filePath;
      this.colorInput = this.comment.color || plugin.settings.highlightColor || "#FFC800";
      this.commentText = this.comment.comment || "";
    } else {
      this.comment = null;
      this.selectedText = options.selectedText || "";
      this.filePath = options.filePath || "";
      this.colorInput = options.initialColor || plugin.settings.highlightColor || "#FFC800";
      this.commentText = "";
      this.onSubmitAdd = options.onSubmitAdd;
    }
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("sidenote-edit-modal");
    const header = contentEl.createDiv("sidenote-edit-modal-header");
    header.createEl("h2", { text: this.mode === "edit" ? "\u539F\u6587\u6279\u6CE8" : "\u6DFB\u52A0\u6279\u6CE8" });
    header.createEl("p", { text: this.mode === "edit" ? "\u7F16\u8F91\u6279\u6CE8\u5185\u5BB9\uFF0C\u5E76\u540C\u6B65\u9AD8\u4EAE\u4E0E\u5361\u7247" : "\u5199\u4E0B\u4F60\u7684\u60F3\u6CD5\uFF0C\u652F\u6301\u7C98\u8D34\u56FE\u7247", cls: "sidenote-edit-modal-subtitle" });
    const selectedBox = contentEl.createDiv("sidenote-edit-modal-selected");
    this.plugin.renderCommentContent(this.selectedText, selectedBox, this.filePath);
    const textareaBox = contentEl.createDiv("sidenote-edit-modal-textarea-box");
    const textarea = textareaBox.createEl("textarea", { cls: "sidenote-edit-modal-textarea" });
    textarea.placeholder = "\u5199\u4E0B\u6279\u6CE8\u3001\u7406\u89E3\u6216\u7591\u95EE... (\u652F\u6301\u7C98\u8D34\u56FE\u7247)";
    textarea.value = this.commentText;
    this.textareaEl = textarea;
    textarea.oninput = (e) => {
      this.commentText = e.target.value;
    };
    textarea.addEventListener("paste", this.handlePaste.bind(this));
    textarea.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        this.submitForm();
      }
    });
    const footer = contentEl.createDiv("sidenote-edit-modal-footer");
    const colorsWrapper = footer.createDiv("sidenote-edit-modal-colors");
    const presetColors = [
      { name: "Purple", value: "#8b5cf6" },
      { name: "Pink", value: "#ec4899" },
      { name: "Blue", value: "#3b82f6" },
      { name: "Green", value: "#10b981" },
      { name: "Yellow", value: "#f59e0b" }
    ];
    let activeCircle = null;
    const updateActiveCircle = (circle) => {
      if (activeCircle) activeCircle.classList.remove("active");
      if (circle) circle.classList.add("active");
      activeCircle = circle;
    };
    const colorPicker = document.createElement("input");
    colorPicker.type = "color";
    colorPicker.className = "sidenote-toolbar-color-picker";
    colorPicker.value = this.colorInput;
    presetColors.forEach((color) => {
      const circle = document.createElement("div");
      circle.className = "sidenote-color-circle";
      circle.style.setProperty("--circle-color", color.value);
      circle.title = color.name;
      if (colorPicker.value.toLowerCase() === color.value.toLowerCase()) {
        updateActiveCircle(circle);
      }
      circle.onclick = () => {
        colorPicker.value = color.value;
        this.colorInput = color.value;
        updateActiveCircle(circle);
      };
      colorsWrapper.appendChild(circle);
    });
    const customColorWrapper = document.createElement("div");
    customColorWrapper.className = "sidenote-color-circle custom-color";
    customColorWrapper.title = "Custom Color";
    colorPicker.onchange = () => {
      this.colorInput = colorPicker.value;
      const matchedPreset = Array.from(colorsWrapper.querySelectorAll(".sidenote-color-circle:not(.custom-color)")).find((c) => {
        return c.style.getPropertyValue("--circle-color").toLowerCase() === colorPicker.value.toLowerCase();
      });
      if (matchedPreset) {
        updateActiveCircle(matchedPreset);
      } else {
        updateActiveCircle(customColorWrapper);
      }
    };
    customColorWrapper.appendChild(colorPicker);
    colorsWrapper.appendChild(customColorWrapper);
    const actionsWrapper = footer.createDiv("sidenote-edit-modal-actions");
    if (this.mode === "edit" && this.comment) {
      const copyBtn = actionsWrapper.createEl("button", { cls: "sidenote-icon-btn", title: "\u590D\u5236\u56DE\u94FE" });
      (0, import_obsidian.setIcon)(copyBtn, "copy");
      copyBtn.onclick = () => {
        this.plugin.copyBacklink(this.comment);
      };
      const deleteBtn = actionsWrapper.createEl("button", { cls: "sidenote-icon-btn sidenote-btn-danger", title: "\u5220\u9664" });
      (0, import_obsidian.setIcon)(deleteBtn, "trash");
      deleteBtn.onclick = async () => {
        if (this.comment) {
          this.plugin.commentManager.deleteComment(this.comment.timestamp);
          await this.plugin.saveData();
          this.plugin.refreshViews();
          this.close();
          new import_obsidian.Notice("\u6279\u6CE8\u5DF2\u5220\u9664");
        }
      };
    }
    const updateBtn = actionsWrapper.createEl("button", { text: this.mode === "edit" ? "\u66F4\u65B0" : "\u6DFB\u52A0", cls: "sidenote-update-btn" });
    updateBtn.onclick = () => this.submitForm();
    this.onClose = () => {
      var _a, _b;
      (_b = (_a = this.plugin).unloadMarkdownRenderComponentsUnder) == null ? void 0 : _b.call(_a, this.contentEl);
      document.querySelectorAll(".sidenote-selection-toolbar").forEach((el) => el.remove());
    };
    setTimeout(() => textarea.focus(), 50);
  }
  async submitForm() {
    if (this.mode === "edit" && this.comment) {
      await this.plugin.editComment(this.comment.timestamp, this.commentText, this.colorInput);
    } else if (this.mode === "add" && this.onSubmitAdd) {
      await this.onSubmitAdd(this.commentText, this.colorInput);
    }
    document.querySelectorAll(".sidenote-selection-toolbar").forEach((el) => el.remove());
    this.close();
  }
  async handlePaste(e) {
    if (!e.clipboardData) return;
    const files = e.clipboardData.files;
    if (files.length > 0) {
      e.preventDefault();
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith("image/")) {
          await this.saveImageAndInsertLink(file);
        }
      }
    }
  }
  async saveImageAndInsertLink(file) {
    if (!this.textareaEl) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const binaryHash = await generateBinaryHash(arrayBuffer);
      let availablePath;
      if (this.plugin.imageHashes && this.plugin.imageHashes[binaryHash]) {
        const existingPath = this.plugin.imageHashes[binaryHash];
        const existingFile = this.app.vault.getAbstractFileByPath(existingPath);
        if (existingFile instanceof import_obsidian.TFile) {
          availablePath = existingPath;
          new import_obsidian.Notice("Reused existing image.");
        } else {
          availablePath = await this.createNewImage(arrayBuffer, file.name);
          this.plugin.imageHashes[binaryHash] = availablePath;
          await this.plugin.saveData();
        }
      } else {
        availablePath = await this.createNewImage(arrayBuffer, file.name);
        if (!this.plugin.imageHashes) this.plugin.imageHashes = {};
        this.plugin.imageHashes[binaryHash] = availablePath;
        await this.plugin.saveData();
      }
      const savedFile = this.app.vault.getAbstractFileByPath(availablePath);
      if (savedFile instanceof import_obsidian.TFile) {
        const sourcePath = this.filePath || "/";
        let markdownLink = this.app.fileManager.generateMarkdownLink(savedFile, sourcePath);
        if (!markdownLink.startsWith("!")) markdownLink = "!" + markdownLink;
        const startPos = this.textareaEl.selectionStart;
        const endPos = this.textareaEl.selectionEnd;
        const text = this.textareaEl.value;
        this.textareaEl.value = text.substring(0, startPos) + markdownLink + text.substring(endPos);
        this.commentText = this.textareaEl.value;
        const newCursorPos = startPos + markdownLink.length;
        this.textareaEl.setSelectionRange(newCursorPos, newCursorPos);
        this.textareaEl.dispatchEvent(new Event("input"));
      }
    } catch (error) {
      console.error(error);
      new import_obsidian.Notice("Failed to save image.");
    }
  }
  async createNewImage(arrayBuffer, originalName) {
    const folderSetting = this.plugin.settings.attachmentFolder.trim() || "side-note-attachments";
    const folderPath = (0, import_obsidian.normalizePath)(folderSetting);
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!folder) await this.app.vault.createFolder(folderPath);
    const dateStr = window.moment().format("YYYYMMDDHHmmss");
    const extension = originalName.split(".").pop() || "png";
    const fileName = `Pasted image ${dateStr}.${extension}`;
    const targetPath = `${folderPath}/${fileName}`;
    const fileOrPath = await this.app.vault.createBinary(targetPath, arrayBuffer).catch(async () => {
      return await this.app.fileManager.getAvailablePathForAttachment(fileName, folderPath);
    });
    return fileOrPath instanceof import_obsidian.TFile ? fileOrPath.path : fileOrPath;
  }
};
var SideNoteSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    __publicField(this, "plugin");
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Comment sort order").setDesc("Choose how comments are sorted.").addDropdown((dropdown) => dropdown.addOption("timestamp", "By timestamp").addOption("position", "By position in file").setValue(this.plugin.settings.commentSortOrder).onChange(async (value) => {
      this.plugin.settings.commentSortOrder = value;
      await this.plugin.saveData();
      this.plugin.refreshViews();
    }));
    new import_obsidian.Setting(containerEl).setName("Show highlights in editor").setDesc("Display highlights for commented text.").addToggle((toggle) => toggle.setValue(this.plugin.settings.showHighlights).onChange(async (value) => {
      this.plugin.settings.showHighlights = value;
      await this.plugin.saveData();
      this.plugin.refreshEditorDecorations();
    }));
    new import_obsidian.Setting(containerEl).setName("Enable selection toolbar").setDesc("Show a quick action toolbar when text is selected.").addToggle((toggle) => toggle.setValue(this.plugin.settings.enableSelectionToolbar).onChange(async (value) => {
      this.plugin.settings.enableSelectionToolbar = value;
      await this.plugin.saveData();
    }));
    containerEl.createEl("h3", { text: "\u5FEB\u6377\u952E\u8BBE\u7F6E" });
    containerEl.createEl("p", {
      text: "\u52A0\u7C97\u3001\u9AD8\u4EAE\u3001\u6279\u6CE8\u3001\u4E0B\u5212\u7EBF\u90FD\u5DF2\u6CE8\u518C\u4E3A Obsidian \u547D\u4EE4\uFF0C\u53EF\u5728 Obsidian \u5FEB\u6377\u952E\u8BBE\u7F6E\u4E2D\u81EA\u5B9A\u4E49\u7ED1\u5B9A\u3002",
      cls: "setting-item-description"
    });
    SHORTCUT_COMMANDS.forEach((command) => {
      new import_obsidian.Setting(containerEl).setName(command.label).setDesc(`\u6253\u5F00 Obsidian \u5FEB\u6377\u952E\u8BBE\u7F6E\u5E76\u641C\u7D22\uFF1A${command.commandName}`).addButton((button) => button.setButtonText("\u8BBE\u7F6E\u5FEB\u6377\u952E").onClick(() => this.plugin.openHotkeySettings(command.commandName)));
    });
    new import_obsidian.Setting(containerEl).setName("Highlight color").addColorPicker((colorPicker) => colorPicker.setValue(this.plugin.settings.highlightColor || "#FFC800").onChange(async (value) => {
      this.plugin.settings.highlightColor = value;
      await this.plugin.saveData();
      this.plugin.applyHighlightColor();
    }));
    new import_obsidian.Setting(containerEl).setName("Highlight opacity").addSlider((slider) => slider.setLimits(0, 1, 0.1).setValue(this.plugin.settings.highlightOpacity || 0.2).onChange(async (value) => {
      this.plugin.settings.highlightOpacity = value;
      await this.plugin.saveData();
      this.plugin.applyHighlightColor();
    }));
    new import_obsidian.Setting(containerEl).setName("Markdown comments folder").addText((text) => text.setPlaceholder("side-note-comments").setValue(this.plugin.settings.markdownFolder || "").onChange(async (value) => {
      this.plugin.settings.markdownFolder = value.trim() || "side-note-comments";
      await this.plugin.saveData();
    }));
    new import_obsidian.Setting(containerEl).setName("Attachments folder").addText((text) => text.setPlaceholder("side-note-attachments").setValue(this.plugin.settings.attachmentFolder || "").onChange(async (value) => {
      this.plugin.settings.attachmentFolder = value.trim() || "side-note-attachments";
      await this.plugin.saveData();
    }));
    new import_obsidian.Setting(containerEl).setName("Comments data folder").setDesc("Per-file comment data storage folder. Restart plugin after changing.").addText((text) => text.setPlaceholder("side-note-data").setValue(this.plugin.settings.commentsDataFolder || "").onChange(async (value) => {
      this.plugin.settings.commentsDataFolder = value.trim() || "side-note-data";
      await this.plugin.saveData();
    }));
    new import_obsidian.Setting(containerEl).setName("Create Markdown Backup").addButton((button) => button.setButtonText("Create Backup").onClick(async () => {
      await this.plugin.migrateInlineCommentsToMarkdown();
      new import_obsidian.Notice("Markdown backup created successfully!");
    }));
    const orphanedCount = this.plugin.commentManager.getOrphanedCommentCount();
    new import_obsidian.Setting(containerEl).setName("Orphaned comments").setDesc(`There are ${orphanedCount} orphaned comment(s).`);
    new import_obsidian.Setting(containerEl).addButton((button) => button.setButtonText(`Delete ${orphanedCount} orphaned comment(s)`).setWarning().onClick(async () => {
      const deleted = this.plugin.commentManager.deleteOrphanedComments();
      await this.plugin.saveData();
      this.plugin.refreshViews();
      new import_obsidian.Notice(`Deleted ${deleted} orphaned comment(s)!`);
      this.display();
    }).setDisabled(orphanedCount === 0));
  }
};
var SideNote = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    __publicField(this, "commentManager");
    __publicField(this, "settings");
    __publicField(this, "comments", []);
    __publicField(this, "imageHashes", {});
    __publicField(this, "orphanNoticeTimer", null);
    __publicField(this, "pendingOrphans", []);
    __publicField(this, "isSaving", false);
    __publicField(this, "editorViews", /* @__PURE__ */ new Set());
    __publicField(this, "renderedTableHighlightTimers", []);
    __publicField(this, "modifyUpdateTimers", /* @__PURE__ */ new Map());
    __publicField(this, "markdownRenderComponents", /* @__PURE__ */ new Map());
  }
  async renderCommentContent(markdown, container, sourcePath) {
    var _a;
    this.unloadMarkdownRenderComponentsUnder(container);
    const component = new import_obsidian.Component();
    component.load();
    this.markdownRenderComponents.set(container, component);
    await import_obsidian.MarkdownRenderer.renderMarkdown(markdown, container, sourcePath, component);
    container.addEventListener("click", (e) => {
      const target = e.target;
      const link = target.closest("a");
      if (link) {
        e.stopPropagation();
        if (link.classList.contains("internal-link")) {
          e.preventDefault();
          const href = link.getAttribute("data-href");
          if (href) {
            const newLeaf = e.metaKey || e.ctrlKey;
            this.app.workspace.openLinkText(href, sourcePath, newLeaf);
          }
        }
      }
    });
    const embedRegex = /!\[\[([^\]|]+?)(\|[^\]]+?)?\]\]/g;
    let match;
    while ((match = embedRegex.exec(markdown)) !== null) {
      const filename = match[1];
      const file = this.app.metadataCache.getFirstLinkpathDest(filename, sourcePath);
      if (file instanceof import_obsidian.TFile) {
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
        let textNode;
        while (textNode = walker.nextNode()) {
          if ((_a = textNode.textContent) == null ? void 0 : _a.includes(match[0])) {
            const embedSpan = document.createElement("span");
            embedSpan.className = "internal-embed";
            const img = document.createElement("img");
            img.src = this.app.vault.getResourcePath(file);
            img.alt = file.basename;
            img.style.maxWidth = "100%";
            img.style.display = "block";
            embedSpan.appendChild(img);
            const parent = textNode.parentNode;
            if (parent) {
              const parts = textNode.textContent.split(match[0]);
              parent.insertBefore(document.createTextNode(parts[0]), textNode);
              parent.insertBefore(embedSpan, textNode);
              textNode.textContent = parts.slice(1).join(match[0]);
            }
            break;
          }
        }
      }
    }
    container.querySelectorAll(".internal-embed").forEach((embed) => {
      var _a2;
      if (embed instanceof HTMLElement && !embed.querySelector("img")) {
        const src = embed.getAttribute("src") || embed.getAttribute("alt") || ((_a2 = embed.textContent) == null ? void 0 : _a2.replace(/^\[\[|\]\]$/g, ""));
        if (src) {
          const file = this.app.metadataCache.getFirstLinkpathDest(src, sourcePath);
          if (file instanceof import_obsidian.TFile) {
            embed.empty();
            const img = embed.createEl("img");
            img.src = this.app.vault.getResourcePath(file);
            img.alt = file.basename;
            img.style.maxWidth = "100%";
            img.style.display = "block";
          }
        }
      }
    });
  }
  unloadMarkdownRenderComponentsUnder(root) {
    this.markdownRenderComponents.forEach((component, container) => {
      if (!container.isConnected || container === root || root.contains(container)) {
        component.unload();
        this.markdownRenderComponents.delete(container);
      }
    });
  }
  openHotkeySettings(searchText) {
    var _a;
    const setting = this.app.setting;
    if (!(setting == null ? void 0 : setting.open)) {
      new import_obsidian.Notice(`\u8BF7\u5728 Obsidian \u8BBE\u7F6E \u2192 \u5FEB\u6377\u952E \u4E2D\u641C\u7D22\u201C${searchText}\u201D\u5E76\u7ED1\u5B9A\u5FEB\u6377\u952E\u3002`);
      return;
    }
    setting.open();
    (_a = setting.openTabById) == null ? void 0 : _a.call(setting, "hotkeys");
    window.setTimeout(() => {
      const searchInput = document.querySelector(
        ".modal.mod-settings input[type='search'], .modal.mod-settings input[placeholder*='Search'], .modal.mod-settings input[placeholder*='\u641C\u7D22'], .modal.mod-settings input"
      );
      if (!searchInput) {
        new import_obsidian.Notice(`\u8BF7\u641C\u7D22\u201C${searchText}\u201D\u5E76\u7ED1\u5B9A\u5FEB\u6377\u952E\u3002`);
        return;
      }
      searchInput.value = searchText;
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      searchInput.focus();
    }, 120);
  }
  getFilePathForEditorView(view) {
    var _a;
    let containingFilePath = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!(leaf.view instanceof import_obsidian.MarkdownView) || !leaf.view.file) return;
      const editor = leaf.view.editor;
      if (editor && editor.cm === view) {
        containingFilePath = leaf.view.file.path;
        return false;
      }
      const containerEl = leaf.view.containerEl;
      if (!containingFilePath && (containerEl == null ? void 0 : containerEl.contains(view.dom))) {
        containingFilePath = leaf.view.file.path;
      }
    });
    return containingFilePath || ((_a = this.app.workspace.getActiveFile()) == null ? void 0 : _a.path) || null;
  }
  getSelectionContextFromOffsets(docText, from, to) {
    return {
      before: docText.substring(Math.max(0, from - 50), from),
      after: docText.substring(to, Math.min(docText.length, to + 50))
    };
  }
  getOccurrenceIndex(content, selectedText, targetIndex) {
    if (!selectedText) return -1;
    let count = 0;
    let searchPos = 0;
    while (true) {
      const found = content.indexOf(selectedText, searchPos);
      if (found === -1) return -1;
      if (found === targetIndex) return count;
      count++;
      searchPos = found + 1;
    }
  }
  getHeadingPath(content, line) {
    const lines = content.split("\n");
    const stack = [];
    for (let i = 0; i <= Math.min(line, lines.length - 1); i++) {
      const match = lines[i].match(/^(#{1,6})\s+(.*)$/);
      if (!match) continue;
      const level = match[1].length;
      const text = match[2].trim();
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, text });
    }
    return stack.map((item) => item.text);
  }
  updateLineCharsFromOffsets(comment, doc, from, to) {
    const startLine = doc.lineAt(from);
    const endLine = doc.lineAt(to);
    comment.startLine = startLine.number - 1;
    comment.startChar = from - startLine.from;
    comment.endLine = endLine.number - 1;
    comment.endChar = to - endLine.from;
    comment.absoluteFrom = from;
    comment.absoluteTo = to;
  }
  mapCommentPositionsFromView(update) {
    const filePath = this.getFilePathForEditorView(update.view);
    if (!filePath || !update.docChanged) return;
    const comments = this.commentManager.getCommentsForFile(filePath);
    comments.forEach((comment) => {
      if (typeof comment.absoluteFrom !== "number" || typeof comment.absoluteTo !== "number") return;
      const mappedFrom = update.changes.mapPos(comment.absoluteFrom, -1);
      const mappedTo = update.changes.mapPos(comment.absoluteTo, 1);
      if (mappedFrom < 0 || mappedTo > update.state.doc.length || mappedFrom >= mappedTo) return;
      const actualText = update.state.doc.sliceString(mappedFrom, mappedTo);
      if (actualText === comment.selectedText) {
        this.updateLineCharsFromOffsets(comment, update.state.doc, mappedFrom, mappedTo);
        comment.isOrphaned = false;
      }
    });
  }
  async handleAddCommentFromEditorView(editorView, markType, initialColor, skipModal = false) {
    const selection = editorView.state.selection.main;
    if (selection.empty || selection.to <= selection.from) {
      new import_obsidian.Notice("Please select some text to add a comment.");
      return;
    }
    const filePath = this.getFilePathForEditorView(editorView);
    if (!filePath) {
      new import_obsidian.Notice("No active Markdown file found.");
      return;
    }
    const doc = editorView.state.doc;
    const selectedText = doc.sliceString(selection.from, selection.to);
    if (!selectedText.trim()) {
      new import_obsidian.Notice("Please select some text to add a comment.");
      return;
    }
    const startLine = doc.lineAt(selection.from);
    const endLine = doc.lineAt(selection.to);
    const docText = doc.toString();
    let globalStartLine = startLine.number - 1;
    let globalStartChar = selection.from - startLine.from;
    let globalEndLine = endLine.number - 1;
    let globalEndChar = selection.to - endLine.from;
    let globalAbsoluteFrom = selection.from;
    let globalAbsoluteTo = selection.to;
    let finalContext = this.getSelectionContextFromOffsets(docText, selection.from, selection.to);
    let finalOccurrenceIndex = this.getOccurrenceIndex(docText, selectedText, selection.from);
    let finalHeadingPath = this.getHeadingPath(docText, globalStartLine);
    const tableCellContext = this.getTableCellContextForEditorView(editorView, filePath);
    const fullDocText = this.getEditorTextForFile(filePath);
    if (tableCellContext && fullDocText) {
      const lines = fullDocText.split("\n");
      let lineOffset = 0;
      for (let i = 0; i < tableCellContext.sourceLine; i++) {
        lineOffset += lines[i].length + 1;
      }
      globalStartLine = tableCellContext.sourceLine;
      globalEndLine = tableCellContext.sourceLine;
      globalStartChar = tableCellContext.cell.contentStart + selection.from;
      globalEndChar = tableCellContext.cell.contentStart + selection.to;
      globalAbsoluteFrom = lineOffset + globalStartChar;
      globalAbsoluteTo = lineOffset + globalEndChar;
      finalContext = this.getSelectionContextFromOffsets(fullDocText, globalAbsoluteFrom, globalAbsoluteTo);
      finalOccurrenceIndex = this.getOccurrenceIndex(fullDocText, selectedText, globalAbsoluteFrom);
      finalHeadingPath = this.getHeadingPath(fullDocText, globalStartLine);
    }
    const createComment = async (commentText, color) => {
      const newComment = {
        filePath,
        startLine: globalStartLine,
        startChar: globalStartChar,
        endLine: globalEndLine,
        endChar: globalEndChar,
        absoluteFrom: globalAbsoluteFrom,
        absoluteTo: globalAbsoluteTo,
        occurrenceIndex: finalOccurrenceIndex,
        headingPath: finalHeadingPath,
        selectedText,
        selectedTextHash: await generateHash2(selectedText),
        comment: commentText,
        timestamp: Date.now(),
        isOrphaned: false,
        contextBefore: finalContext.before,
        contextAfter: finalContext.after,
        markType,
        color
      };
      await this.addComment(newComment);
      editorView.dispatch({ effects: [forceUpdateEffect.of(null)] });
      document.querySelectorAll(".sidenote-selection-toolbar").forEach((el) => el.remove());
    };
    if (skipModal) {
      await createComment("", initialColor || "");
      return;
    }
    new CommentModal(this.app, this, {
      mode: "add",
      selectedText,
      filePath,
      initialColor: initialColor || "",
      onSubmitAdd: async (commentText, color) => {
        await createComment(commentText, color);
      }
    }).open();
  }
  getEditorTextForFile(filePath) {
    let text = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      var _a;
      if (leaf.view instanceof import_obsidian.MarkdownView && ((_a = leaf.view.file) == null ? void 0 : _a.path) === filePath) {
        text = leaf.view.editor.getValue();
        return false;
      }
    });
    return text;
  }
  isMarkdownTableDelimiter(line) {
    var _a;
    const trimmed = line.trim();
    if (!trimmed.includes("|")) return false;
    return /^:?-{3,}:?$/.test(((_a = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|")[0]) == null ? void 0 : _a.trim()) || "") && trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").every((part) => /^:?-{3,}:?$/.test(part.trim()));
  }
  getMarkdownTableBlocks(docText) {
    const lines = docText.split("\n");
    const blocks = [];
    let line = 0;
    while (line < lines.length - 1) {
      if (lines[line].includes("|") && this.isMarkdownTableDelimiter(lines[line + 1])) {
        const startLine = line;
        line += 2;
        while (line < lines.length && lines[line].includes("|") && lines[line].trim().length > 0) {
          line++;
        }
        blocks.push({ startLine, endLine: line - 1 });
        continue;
      }
      line++;
    }
    return blocks;
  }
  parseMarkdownTableRow(line) {
    var _a, _b;
    const cells = [];
    let cellStart = line.startsWith("|") ? 1 : 0;
    for (let i = cellStart; i <= line.length; i++) {
      const isDelimiter = i === line.length || line[i] === "|" && line[i - 1] !== "\\";
      if (!isDelimiter) continue;
      const start = cellStart;
      const end = i;
      const raw = line.slice(start, end);
      const leading = ((_a = raw.match(/^\s*/)) == null ? void 0 : _a[0].length) || 0;
      const trailing = ((_b = raw.match(/\s*$/)) == null ? void 0 : _b[0].length) || 0;
      cells.push({
        start,
        end,
        contentStart: start + leading,
        contentEnd: Math.max(start + leading, end - trailing)
      });
      cellStart = i + 1;
    }
    if (line.endsWith("|")) cells.pop();
    return cells;
  }
  getSourceLineForTableRow(block, renderedRowIndex) {
    return renderedRowIndex === 0 ? block.startLine : block.startLine + renderedRowIndex + 1;
  }
  getRenderedRowIndexForSourceLine(block, sourceLine) {
    if (sourceLine === block.startLine) return 0;
    if (sourceLine >= block.startLine + 2 && sourceLine <= block.endLine) {
      return sourceLine - block.startLine - 1;
    }
    return null;
  }
  getTableBlockForWidget(filePath, widget) {
    const docText = this.getEditorTextForFile(filePath);
    if (!docText) return null;
    const blocks = this.getMarkdownTableBlocks(docText);
    let widgetIndex = -1;
    this.app.workspace.iterateAllLeaves((leaf) => {
      var _a;
      if (!(leaf.view instanceof import_obsidian.MarkdownView) || ((_a = leaf.view.file) == null ? void 0 : _a.path) !== filePath) return;
      const cm = leaf.view.editor.cm;
      const widgets = Array.from((cm == null ? void 0 : cm.dom.querySelectorAll(".cm-table-widget")) || []);
      const index = widgets.indexOf(widget);
      if (index !== -1) {
        widgetIndex = index;
        return false;
      }
    });
    return widgetIndex >= 0 ? blocks[widgetIndex] || null : null;
  }
  getTableCellContextForEditorView(view, filePath) {
    var _a;
    const widget = view.dom.closest(".cm-table-widget");
    const domCell = view.dom.closest("td, th");
    if (!widget || !domCell) return null;
    const block = this.getTableBlockForWidget(filePath, widget);
    const row = domCell.closest("tr");
    const table = widget.querySelector("table");
    if (!block || !row || !table) return null;
    const rows = Array.from(table.querySelectorAll("tr"));
    const renderedRowIndex = rows.indexOf(row);
    const cells = Array.from(row.children).filter((el) => el.matches("td, th"));
    const renderedCellIndex = cells.indexOf(domCell);
    if (renderedRowIndex < 0 || renderedCellIndex < 0) return null;
    const sourceLine = this.getSourceLineForTableRow(block, renderedRowIndex);
    const lineText = (_a = this.getEditorTextForFile(filePath)) == null ? void 0 : _a.split("\n")[sourceLine];
    if (lineText === void 0) return null;
    const cell = this.parseMarkdownTableRow(lineText)[renderedCellIndex];
    return cell ? { block, sourceLine, cell } : null;
  }
  getCommentHighlightPresentation(comment) {
    let style;
    if (comment.color) {
      const rgb = this.hexToRgb(comment.color);
      const opacity = this.settings.highlightOpacity;
      style = `--sidenote-highlight-color: rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity}); --sidenote-highlight-hover: rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.min(opacity + 0.15, 1)}); --sidenote-highlight-border: rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.min(opacity + 0.4, 1)});`;
    }
    return {
      className: `sidenote-highlight sidenote-table-highlight${comment.isOrphaned ? " orphaned" : ""} sidenote-mark-${comment.markType || "highlight"}`,
      style
    };
  }
  unwrapRenderedTableHighlights(root) {
    root.querySelectorAll(".sidenote-table-highlight").forEach((highlight) => {
      const parent = highlight.parentNode;
      if (!parent) return;
      while (highlight.firstChild) parent.insertBefore(highlight.firstChild, highlight);
      parent.removeChild(highlight);
      parent.normalize();
    });
  }
  wrapTextRange(root, start, end, comment) {
    var _a;
    if (start < 0 || end <= start) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!node.textContent || (parent == null ? void 0 : parent.closest(".sidenote-table-highlight, svg, .table-col-drag-handle, .table-row-drag-handle"))) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const presentation = this.getCommentHighlightPresentation(comment);
    let offset = 0;
    const nodes = [];
    let current;
    while (current = walker.nextNode()) nodes.push(current);
    for (const node of nodes) {
      const text = node.nodeValue || "";
      const nodeStart = offset;
      const nodeEnd = offset + text.length;
      offset = nodeEnd;
      const sliceStart = Math.max(start, nodeStart);
      const sliceEnd = Math.min(end, nodeEnd);
      if (sliceStart >= sliceEnd) continue;
      const localStart = sliceStart - nodeStart;
      const localEnd = sliceEnd - nodeStart;
      const before = text.slice(0, localStart);
      const middle = text.slice(localStart, localEnd);
      const after = text.slice(localEnd);
      const span = document.createElement("span");
      span.className = presentation.className;
      span.setAttribute("data-comment-timestamp", comment.timestamp.toString());
      if (presentation.style) span.setAttribute("style", presentation.style);
      span.textContent = middle;
      const fragment = document.createDocumentFragment();
      if (before) fragment.appendChild(document.createTextNode(before));
      fragment.appendChild(span);
      if (after) fragment.appendChild(document.createTextNode(after));
      (_a = node.parentNode) == null ? void 0 : _a.replaceChild(fragment, node);
    }
  }
  applyRenderedTableHighlights(view) {
    if (!this.commentManager) return;
    const filePath = this.getFilePathForEditorView(view);
    if (!filePath || !this.settings.showHighlights) return;
    const docText = view.state.doc.toString();
    const blocks = this.getMarkdownTableBlocks(docText);
    const widgets = Array.from(view.dom.querySelectorAll(".cm-table-widget"));
    widgets.forEach((widget) => this.unwrapRenderedTableHighlights(widget));
    if (blocks.length === 0 || widgets.length === 0) return;
    const comments = this.commentManager.getCommentsForFile(filePath).filter((comment) => !comment.isOrphaned);
    const lines = docText.split("\n");
    comments.forEach((comment) => {
      var _a, _b, _c, _d;
      const blockIndex = blocks.findIndex((block2) => comment.startLine >= block2.startLine && comment.startLine <= block2.endLine);
      if (blockIndex < 0) return;
      const block = blocks[blockIndex];
      const rowIndex = this.getRenderedRowIndexForSourceLine(block, comment.startLine);
      if (rowIndex === null) return;
      const widget = widgets[blockIndex];
      const table = widget == null ? void 0 : widget.querySelector("table");
      const row = table ? Array.from(table.querySelectorAll("tr"))[rowIndex] : null;
      if (!row) return;
      const lineText = lines[comment.startLine] || "";
      const cellRanges = this.parseMarkdownTableRow(lineText);
      const cellIndex = cellRanges.findIndex((cell2) => comment.startChar >= cell2.contentStart && comment.startChar <= cell2.contentEnd);
      const cell = cellIndex >= 0 ? cellRanges[cellIndex] : null;
      if (!cell) return;
      const domCell = Array.from(row.children).filter((el) => el.matches("td, th"))[cellIndex];
      if (!domCell || domCell.querySelector(".cm-editor")) return;
      const wrappers = Array.from(domCell.children).filter((el) => el.classList.contains("table-cell-wrapper"));
      const target = wrappers.find((wrapper) => getComputedStyle(wrapper).display !== "none") || wrappers[0];
      if (!target) return;
      const expectedStart = Math.max(0, comment.startChar - cell.contentStart);
      let start = (_b = (_a = target.textContent) == null ? void 0 : _a.indexOf(comment.selectedText)) != null ? _b : -1;
      if (start < 0) return;
      const matches = [];
      let search = 0;
      while (true) {
        const found = (_d = (_c = target.textContent) == null ? void 0 : _c.indexOf(comment.selectedText, search)) != null ? _d : -1;
        if (found === -1) break;
        matches.push(found);
        search = found + 1;
      }
      if (matches.length === 0) return;
      start = matches.sort((a, b) => Math.abs(a - expectedStart) - Math.abs(b - expectedStart))[0];
      this.wrapTextRange(target, start, start + comment.selectedText.length, comment);
    });
  }
  applyRenderedTableHighlightsToAllEditors() {
    this.editorViews.forEach((view) => {
      try {
        this.applyRenderedTableHighlights(view);
      } catch (e) {
        this.editorViews.delete(view);
      }
    });
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof import_obsidian.MarkdownView) {
        const cm = leaf.view.editor.cm;
        if (cm) this.applyRenderedTableHighlights(cm);
      }
    });
  }
  scheduleRenderedTableHighlights() {
    this.renderedTableHighlightTimers.forEach((timer) => window.clearTimeout(timer));
    this.renderedTableHighlightTimers = [0, 50, 150, 400, 900].map(
      (delay) => window.setTimeout(() => this.applyRenderedTableHighlightsToAllEditors(), delay)
    );
  }
  refreshViews() {
    this.app.workspace.getLeavesOfType("sidenote-view").forEach((leaf) => {
      if (leaf.view instanceof SideNoteView) leaf.view.renderComments();
    });
  }
  async ensureCommentFolder() {
    const folder = this.settings.markdownFolder.trim() || DEFAULT_SETTINGS.markdownFolder;
    const normalized = folder.replace(/^\/+|\/+$/g, "");
    if (!await this.app.vault.adapter.exists(normalized)) await this.app.vault.createFolder(normalized);
    return normalized;
  }
  getSideNoteFilePath(notePath) {
    const folder = this.settings.markdownFolder.trim() || DEFAULT_SETTINGS.markdownFolder;
    const normalized = folder.replace(/^\/+|\/+$/g, "");
    const base = notePath.replace(/\.md$/i, "").replace(/\//g, "__");
    return `${normalized}/${base}-sidenote.md`;
  }
  buildMarkdownBlock(excerpt, body, timestamp) {
    const safeExcerpt = excerpt || "(no excerpt)";
    return `## ${safeExcerpt}

${body}

---`;
  }
  async writeCommentToMarkdown(notePath, excerpt, body, timestamp) {
    const folder = await this.ensureCommentFolder();
    const filePath = this.getSideNoteFilePath(notePath);
    const block = this.buildMarkdownBlock(excerpt, body, timestamp);
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof import_obsidian.TFile) {
      const content = await this.app.vault.read(existing);
      const updated = content.trim().length === 0 ? block : `${content}

${block}`;
      await this.app.vault.modify(existing, updated);
    } else {
      const header = `# Side Notes for ${notePath}

`;
      await this.app.vault.create(filePath, `${header}${block}`);
    }
    return filePath;
  }
  async migrateInlineCommentsToMarkdown() {
    let changed = false;
    for (const comment of this.comments) {
      if (!comment.commentPath) {
        const path = await this.writeCommentToMarkdown(comment.filePath, comment.selectedText, comment.comment, comment.timestamp);
        comment.commentPath = path;
        changed = true;
      }
    }
    if (changed) await this.saveData();
  }
  // --- Per-file comment storage ---
  getCommentsJsonPath(notePath) {
    var _a;
    const folder = ((_a = this.settings.commentsDataFolder) == null ? void 0 : _a.trim()) || DEFAULT_SETTINGS.commentsDataFolder;
    const normalized = (0, import_obsidian.normalizePath)(folder);
    const base = notePath.replace(/\.md$/i, "").replace(/\//g, "__");
    return `${normalized}/${base}.json`;
  }
  async ensureCommentsDataFolder() {
    var _a;
    const folder = ((_a = this.settings.commentsDataFolder) == null ? void 0 : _a.trim()) || DEFAULT_SETTINGS.commentsDataFolder;
    const normalized = (0, import_obsidian.normalizePath)(folder);
    if (!await this.app.vault.adapter.exists(normalized)) {
      await this.app.vault.createFolder(normalized);
    }
    return normalized;
  }
  async loadAllCommentsFromFiles() {
    var _a;
    const folder = ((_a = this.settings.commentsDataFolder) == null ? void 0 : _a.trim()) || DEFAULT_SETTINGS.commentsDataFolder;
    const normalized = (0, import_obsidian.normalizePath)(folder);
    const allComments = [];
    if (await this.app.vault.adapter.exists(normalized)) {
      const listing = await this.app.vault.adapter.list(normalized);
      for (const filePath of listing.files) {
        if (filePath.endsWith(".json")) {
          try {
            const content = await this.app.vault.adapter.read(filePath);
            const comments = JSON.parse(content);
            allComments.push(...comments);
          } catch (e) {
            console.error(`Error loading comments from ${filePath}:`, e);
          }
        }
      }
    }
    return allComments;
  }
  async saveAllCommentFiles() {
    const normalized = await this.ensureCommentsDataFolder();
    const grouped = {};
    for (const comment of this.comments) {
      if (!grouped[comment.filePath]) grouped[comment.filePath] = [];
      grouped[comment.filePath].push(comment);
    }
    const writtenPaths = /* @__PURE__ */ new Set();
    for (const [filePath, comments] of Object.entries(grouped)) {
      const jsonPath = this.getCommentsJsonPath(filePath);
      await this.app.vault.adapter.write(jsonPath, JSON.stringify(comments, null, 2));
      writtenPaths.add(jsonPath);
    }
    try {
      const listing = await this.app.vault.adapter.list(normalized);
      for (const existing of listing.files) {
        if (existing.endsWith(".json") && !writtenPaths.has(existing)) {
          await this.app.vault.adapter.remove(existing);
        }
      }
    } catch (e) {
      console.error("Error cleaning up comment files:", e);
    }
  }
  async saveCommentsForSingleFile(filePath) {
    await this.ensureCommentsDataFolder();
    const commentsForFile = this.comments.filter((c) => c.filePath === filePath);
    const jsonPath = this.getCommentsJsonPath(filePath);
    if (commentsForFile.length === 0) {
      if (await this.app.vault.adapter.exists(jsonPath)) {
        await this.app.vault.adapter.remove(jsonPath);
      }
    } else {
      await this.app.vault.adapter.write(jsonPath, JSON.stringify(commentsForFile, null, 2));
    }
  }
  showOrphanDeletionNotice(orphans) {
    if (orphans.length === 0) return;
    const fragment = document.createDocumentFragment();
    const span = document.createElement("span");
    span.textContent = `${orphans.length} \u6761\u6279\u6CE8\u5DF2\u5931\u53BB\u539F\u6587\uFF0C\u662F\u5426\u5220\u9664\uFF1F`;
    fragment.appendChild(span);
    fragment.appendChild(document.createElement("br"));
    const btnContainer = document.createElement("div");
    btnContainer.style.display = "flex";
    btnContainer.style.gap = "8px";
    btnContainer.style.marginTop = "8px";
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "\u5220\u9664";
    deleteBtn.className = "mod-warning";
    const keepBtn = document.createElement("button");
    keepBtn.textContent = "\u4FDD\u7559";
    btnContainer.appendChild(deleteBtn);
    btnContainer.appendChild(keepBtn);
    fragment.appendChild(btnContainer);
    const notice = new import_obsidian.Notice(fragment, 0);
    deleteBtn.onclick = async () => {
      for (const oc of orphans) {
        this.commentManager.deleteComment(oc.timestamp);
      }
      await this.saveData();
      this.refreshViews();
      notice.hide();
      new import_obsidian.Notice(`\u5DF2\u5220\u9664 ${orphans.length} \u6761\u5B64\u7ACB\u6279\u6CE8\u3002`);
    };
    keepBtn.onclick = () => {
      notice.hide();
    };
  }
  // --- 捕获上下文的辅助函数 ---
  getSelectionContext(editor) {
    const doc = editor.getValue();
    const cursorFrom = editor.posToOffset(editor.getCursor("from"));
    const cursorTo = editor.posToOffset(editor.getCursor("to"));
    const start = Math.max(0, cursorFrom - 50);
    const contextBefore = doc.substring(start, cursorFrom);
    const end = Math.min(doc.length, cursorTo + 50);
    const contextAfter = doc.substring(cursorTo, end);
    return { before: contextBefore, after: contextAfter };
  }
  async handleAddComment(editor, view, markType, initialColor, skipModal = false) {
    var _a;
    const selection = editor.getSelection();
    const filePath = (_a = view.file) == null ? void 0 : _a.path;
    if (selection && selection.trim().length > 0 && filePath) {
      const cursorStart = editor.getCursor("from");
      const cursorEnd = editor.getCursor("to");
      const docText = editor.getValue();
      const absoluteFrom = editor.posToOffset(cursorStart);
      const absoluteTo = editor.posToOffset(cursorEnd);
      const occurrenceIndex = this.getOccurrenceIndex(docText, selection, absoluteFrom);
      const headingPath = this.getHeadingPath(docText, cursorStart.line);
      const { before, after } = this.getSelectionContext(editor);
      const cm = editor.cm;
      const coords = cm.coordsAtPos(editor.posToOffset(editor.getCursor("to")));
      if (skipModal) {
        const selectedTextHash = await generateHash2(selection);
        const newComment = {
          filePath,
          startLine: cursorStart.line,
          startChar: cursorStart.ch,
          endLine: cursorEnd.line,
          endChar: cursorEnd.ch,
          absoluteFrom,
          absoluteTo,
          occurrenceIndex,
          headingPath,
          selectedText: selection,
          selectedTextHash,
          comment: "",
          timestamp: Date.now(),
          isOrphaned: false,
          contextBefore: before,
          contextAfter: after,
          markType,
          color: initialColor || ""
        };
        await this.addComment(newComment);
        document.querySelectorAll(".sidenote-selection-toolbar").forEach((el) => el.remove());
        return;
      }
      new CommentModal(this.app, this, {
        mode: "add",
        selectedText: selection,
        filePath,
        initialColor: initialColor || "",
        onSubmitAdd: async (commentText, color) => {
          const selectedTextHash = await generateHash2(selection);
          const newComment = {
            filePath,
            startLine: cursorStart.line,
            startChar: cursorStart.ch,
            endLine: cursorEnd.line,
            endChar: cursorEnd.ch,
            absoluteFrom,
            absoluteTo,
            occurrenceIndex,
            headingPath,
            selectedText: selection,
            selectedTextHash,
            comment: commentText,
            timestamp: Date.now(),
            isOrphaned: false,
            // 保存上下文
            contextBefore: before,
            contextAfter: after,
            markType,
            color
          };
          this.addComment(newComment);
        }
      }).open();
    } else {
      new import_obsidian.Notice("Please select some text to add a comment.");
    }
  }
  async onload() {
    this.injectStyles();
    await this.loadPluginData();
    this.commentManager = new CommentManager(this.comments);
    await this.migrateComments();
    this.registerEditorExtension([this.createSelectionToolbarPlugin(), ...this.createHighlightPlugin()]);
    this.scheduleRenderedTableHighlights();
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        document.querySelectorAll(".sidenote-selection-toolbar").forEach((el) => {
          el.remove();
        });
      })
    );
    this.addSettingTab(new SideNoteSettingTab(this.app, this));
    this.registerView("sidenote-view", (leaf) => new SideNoteView(leaf, this));
    this.registerObsidianProtocolHandler("sidenote", async (params) => {
      const timestamp = parseInt(params.timestamp);
      if (timestamp) {
        const comment = this.comments.find((c) => c.timestamp === timestamp);
        if (comment) {
          let sideNoteView = null;
          const leaves = this.app.workspace.getLeavesOfType("sidenote-view");
          if (leaves.length > 0) sideNoteView = leaves[0].view;
          if (!sideNoteView) {
            await this.activateView();
            const newLeaves = this.app.workspace.getLeavesOfType("sidenote-view");
            if (newLeaves.length > 0) sideNoteView = newLeaves[0].view;
          }
          if (sideNoteView) sideNoteView.jumpToComment(comment);
        }
      }
    });
    this.addCommand({ id: "open-comment-view", name: "\u5728\u5206\u5C4F\u4E2D\u6253\u5F00\u6279\u6CE8\u89C6\u56FE", callback: () => void switchToSideNoteView(this.app) });
    this.addCommand({ id: "activate-view", name: "\u5728\u4FA7\u8FB9\u680F\u6253\u5F00\u6279\u6CE8\u89C6\u56FE", callback: () => this.activateView() });
    this.addCommand({
      id: "add-comment-to-selection",
      name: "\u4E3A\u9009\u4E2D\u5185\u5BB9\u6DFB\u52A0\u9AD8\u4EAE",
      icon: "message-square",
      editorCallback: async (editor, view) => this.handleAddComment(editor, view, "highlight", void 0, true)
    });
    this.addCommand({
      id: "add-underline-comment-to-selection",
      name: "\u4E3A\u9009\u4E2D\u5185\u5BB9\u6DFB\u52A0\u4E0B\u5212\u7EBF",
      icon: "message-square",
      editorCallback: async (editor, view) => this.handleAddComment(editor, view, "underline", void 0, true)
    });
    this.addCommand({
      id: "add-strikethrough-comment-to-selection",
      name: "\u4E3A\u9009\u4E2D\u5185\u5BB9\u6DFB\u52A0\u5220\u9664\u7EBF",
      icon: "message-square",
      editorCallback: async (editor, view) => this.handleAddComment(editor, view, "strikethrough", void 0, true)
    });
    this.addCommand({
      id: "add-bold-comment-to-selection",
      name: "\u4E3A\u9009\u4E2D\u5185\u5BB9\u6DFB\u52A0\u52A0\u7C97",
      icon: "message-square",
      editorCallback: async (editor, view) => this.handleAddComment(editor, view, "bold", void 0, true)
    });
    this.addCommand({
      id: "add-pure-comment-to-selection",
      name: "\u4E3A\u9009\u4E2D\u5185\u5BB9\u6DFB\u52A0\u6279\u6CE8 (\u5F39\u51FA\u8F93\u5165\u6846)",
      icon: "message-square-plus",
      editorCallback: async (editor, view) => this.handleAddComment(editor, view, "highlight", void 0, false)
    });
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, view) => {
      if (editor.somethingSelected()) {
        menu.addItem((item) => {
          item.setTitle("\u6DFB\u52A0\u9AD8\u4EAE").setIcon("message-square").onClick(() => this.handleAddComment(editor, view, "highlight", void 0, true));
        });
        menu.addItem((item) => {
          item.setTitle("\u6DFB\u52A0\u4E0B\u5212\u7EBF").setIcon("message-square").onClick(() => this.handleAddComment(editor, view, "underline", void 0, true));
        });
        menu.addItem((item) => {
          item.setTitle("\u6DFB\u52A0\u5220\u9664\u7EBF").setIcon("message-square").onClick(() => this.handleAddComment(editor, view, "strikethrough", void 0, true));
        });
        menu.addItem((item) => {
          item.setTitle("\u6DFB\u52A0\u52A0\u7C97").setIcon("message-square").onClick(() => this.handleAddComment(editor, view, "bold", void 0, true));
        });
        menu.addItem((item) => {
          item.setTitle("\u6DFB\u52A0\u6279\u6CE8").setIcon("message-square-plus").onClick(() => this.handleAddComment(editor, view, "highlight", void 0, false));
        });
      }
    }));
    this.addRibbonIcon("message-square", "Side Note: Open in Sidebar", () => this.activateView());
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf && leaf.view instanceof import_obsidian.MarkdownView) {
        const file = leaf.view.file;
        this.app.workspace.getLeavesOfType("sidenote-view").forEach((sideNoteLeaf) => {
          if (sideNoteLeaf.view instanceof SideNoteView) sideNoteLeaf.view.updateActiveFile(file);
        });
        this.refreshEditorDecorations();
        this.scheduleRenderedTableHighlights();
      }
    }));
    this.registerEvent(this.app.vault.on("rename", async (file, oldPath) => {
      if (file instanceof import_obsidian.TFile && file.extension === "md") {
        this.commentManager.renameFile(oldPath, file.path);
        await this.saveData();
        this.refreshViews();
      }
    }));
    this.registerEvent(this.app.vault.on("modify", async (file) => {
      var _a, _b;
      if (this.isSaving) return;
      const dataFolder = (0, import_obsidian.normalizePath)(((_a = this.settings.commentsDataFolder) == null ? void 0 : _a.trim()) || DEFAULT_SETTINGS.commentsDataFolder);
      if (file.path.startsWith(dataFolder + "/")) return;
      if (file.path === ".obsidian/plugins/side-note/data.json" || file instanceof import_obsidian.TFile && file.name === "data.json" && ((_b = file.parent) == null ? void 0 : _b.name) === "side-note") {
        try {
          await this.loadPluginData();
          this.commentManager.updateComments(this.comments);
          this.refreshViews();
          this.refreshEditorDecorations();
          this.scheduleRenderedTableHighlights();
        } catch (error) {
          console.error("Error reloading plugin data:", error);
        }
      } else if (file instanceof import_obsidian.TFile && file.extension === "md") {
        this.scheduleCommentCoordinateUpdate(file);
      }
    }));
  }
  scheduleCommentCoordinateUpdate(file) {
    const filePath = file.path;
    const existingTimer = this.modifyUpdateTimers.get(filePath);
    if (existingTimer) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      this.modifyUpdateTimers.delete(filePath);
      void this.updateCommentCoordinatesForModifiedFile(filePath);
    }, 800);
    this.modifyUpdateTimers.set(filePath, timer);
  }
  async updateCommentCoordinatesForModifiedFile(filePath) {
    if (this.isSaving) return;
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof import_obsidian.TFile) || file.extension !== "md") return;
    try {
      const beforeOrphanTimestamps = new Set(
        this.commentManager.getCommentsForFile(file.path).filter((c) => c.isOrphaned).map((c) => c.timestamp)
      );
      const fileContent = await this.app.vault.cachedRead(file);
      await this.commentManager.updateCommentCoordinatesForFile(fileContent, file.path);
      await this.saveCommentsForSingleFile(file.path);
      this.refreshViews();
      this.refreshEditorDecorations();
      const newOrphans = this.commentManager.getCommentsForFile(file.path).filter((c) => c.isOrphaned && !beforeOrphanTimestamps.has(c.timestamp));
      if (newOrphans.length > 0) {
        this.pendingOrphans.push(...newOrphans);
        if (this.orphanNoticeTimer) clearTimeout(this.orphanNoticeTimer);
        this.orphanNoticeTimer = setTimeout(() => {
          const uniqueOrphans = [...new Map(this.pendingOrphans.map((o) => [o.timestamp, o])).values()];
          this.showOrphanDeletionNotice(uniqueOrphans);
          this.pendingOrphans = [];
        }, 2e3);
      }
    } catch (error) {
      console.error("Error updating comment coordinates:", error);
    }
  }
  onunload() {
    var _a;
    if (this.orphanNoticeTimer) {
      clearTimeout(this.orphanNoticeTimer);
      this.orphanNoticeTimer = null;
    }
    this.pendingOrphans = [];
    this.renderedTableHighlightTimers.forEach((timer) => window.clearTimeout(timer));
    this.renderedTableHighlightTimers = [];
    this.modifyUpdateTimers.forEach((timer) => window.clearTimeout(timer));
    this.modifyUpdateTimers.clear();
    document.querySelectorAll(".sidenote-selection-toolbar").forEach((el) => el.remove());
    this.unloadMarkdownRenderComponentsUnder(document.body);
    (_a = document.getElementById("sidenote-dynamic-styles")) == null ? void 0 : _a.remove();
    this.editorViews.clear();
  }
  injectStyles() {
    const styleId = "sidenote-dynamic-styles";
    let styleTag = document.getElementById(styleId);
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = styleId;
      document.head.appendChild(styleTag);
    }
    styleTag.innerHTML = `
            :root {
                --sidenote-highlight-color: rgba(255, 208, 0, 0.2);
                --sidenote-highlight-hover: rgba(255, 208, 0, 0.4);
                --sidenote-highlight-border: rgba(255, 208, 0, 0.6);
                --sidenote-orphaned-color: rgba(255, 80, 80, 0.2);
                --sidenote-orphaned-hover: rgba(255, 80, 80, 0.3);
                --sidenote-orphaned-border: rgba(255, 80, 80, 0.6);
            }
        `;
  }
  async activateViewAndHighlightComment(timestamp) {
    await this.activateView();
    const leaves = this.app.workspace.getLeavesOfType("sidenote-view");
    leaves.forEach((leaf) => {
      if (leaf.view instanceof SideNoteView) leaf.view.highlightComment(timestamp);
    });
  }
  async activateView() {
    const { workspace } = this.app;
    let leaf = null;
    const leaves = workspace.getLeavesOfType("sidenote-view");
    if (leaves.length > 0) leaf = leaves[0];
    else {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        leaf = rightLeaf;
        await leaf.setViewState({ type: "sidenote-view", active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
      if (leaf.view instanceof SideNoteView) {
        const activeFile = workspace.getActiveFile();
        leaf.view.updateActiveFile(activeFile);
      }
    }
  }
  async onCommentsChanged(message) {
    await this.saveData();
    this.refreshViews();
    this.refreshEditorDecorations();
    this.scheduleRenderedTableHighlights();
    new import_obsidian.Notice(message);
  }
  async addComment(newComment) {
    await this.commentManager.addComment(newComment);
    await this.onCommentsChanged("Comment added!");
  }
  async editComment(timestamp, newCommentText, newColor) {
    this.commentManager.editComment(timestamp, newCommentText, newColor);
    await this.onCommentsChanged("Comment updated!");
  }
  async deleteComment(timestamp) {
    this.commentManager.deleteComment(timestamp);
    await this.onCommentsChanged("Comment deleted!");
  }
  async copyBacklink(comment) {
    const quoteText = (text, prefix) => {
      return text.split("\n").map((line) => prefix + line).join("\n");
    };
    const link = `[\u70B9\u51FB\u8DF3\u8F6C\u81F3\u539F\u6587\u4F4D\u7F6E](obsidian://sidenote?timestamp=${comment.timestamp})`;
    const callout = `> [!quote] \u6279\u6CE8\u56DE\u94FE - ${link}
> **\u539F\u6587**\uFF1A
${quoteText(comment.selectedText || "", "> > ")}
> 
> **\u6279\u6CE8**\uFF1A
${quoteText(comment.comment || "\uFF08\u65E0\uFF09", "> ")}`;
    navigator.clipboard.writeText(callout);
    new import_obsidian.Notice("\u5DF2\u590D\u5236\u7CBE\u786E\u56DE\u94FE (\u65E0\u6C61\u67D3\u9632\u6F02\u79FB)");
  }
  async loadPluginData() {
    const rawData = Object.assign({}, { imageHashes: {} }, DEFAULT_SETTINGS, await this.loadData());
    this.settings = { ...DEFAULT_SETTINGS, ...rawData };
    this.imageHashes = rawData.imageHashes || {};
    this.comments = await this.loadAllCommentsFromFiles();
    if (rawData.comments && rawData.comments.length > 0) {
      const oldComments = rawData.comments;
      const existingTimestamps = new Set(this.comments.map((c) => c.timestamp));
      let migratedCount = 0;
      for (const oc of oldComments) {
        if (!existingTimestamps.has(oc.timestamp)) {
          this.comments.push(oc);
          migratedCount++;
        }
      }
      if (migratedCount > 0) {
        await this.saveAllCommentFiles();
        new import_obsidian.Notice(`\u5DF2\u8FC1\u79FB ${migratedCount} \u6761\u6279\u6CE8\u5230\u72EC\u7ACB\u6587\u4EF6\u5B58\u50A8\u3002`);
      }
      const cleanData = { ...this.settings, imageHashes: this.imageHashes };
      await super.saveData(cleanData);
    }
    this.applyHighlightColor();
  }
  async migrateComments() {
    let needsSave = false;
    for (const comment of this.comments) {
      if (!comment.selectedTextHash && comment.selectedText) {
        comment.selectedTextHash = await generateHash2(comment.selectedText);
        needsSave = true;
      }
      if (comment.isOrphaned === void 0) {
        comment.isOrphaned = false;
        needsSave = true;
      }
    }
    if (needsSave) await this.saveData();
  }
  applyHighlightColor() {
    const root = document.documentElement;
    const rgb = this.hexToRgb(this.settings.highlightColor);
    const opacity = this.settings.highlightOpacity;
    root.style.setProperty("--sidenote-highlight-color", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`);
    root.style.setProperty("--sidenote-highlight-hover", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.min(opacity + 0.15, 1)})`);
    root.style.setProperty("--sidenote-highlight-border", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.min(opacity + 0.4, 1)})`);
    root.style.setProperty("--sidenote-orphaned-color", `rgba(255, 100, 100, ${opacity})`);
    root.style.setProperty("--sidenote-orphaned-hover", `rgba(255, 100, 100, ${Math.min(opacity + 0.15, 1)})`);
    root.style.setProperty("--sidenote-orphaned-border", `rgba(255, 100, 100, ${Math.min(opacity + 0.35, 1)})`);
    this.refreshEditorDecorations();
  }
  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 255, g: 200, b: 0 };
  }
  async saveData() {
    this.isSaving = true;
    try {
      const dataToSave = { ...this.settings, imageHashes: this.imageHashes };
      await super.saveData(dataToSave);
      await this.saveAllCommentFiles();
    } finally {
      this.isSaving = false;
    }
    this.refreshEditorDecorations();
    this.scheduleRenderedTableHighlights();
  }
  refreshEditorDecorations() {
    this.editorViews.forEach((view) => {
      try {
        view.dispatch({ effects: [forceUpdateEffect.of(null)] });
        this.applyRenderedTableHighlights(view);
      } catch (e) {
        this.editorViews.delete(view);
      }
    });
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof import_obsidian.MarkdownView) {
        const editor = leaf.view.editor;
        if (editor && editor.cm) {
          const cm = editor.cm;
          if (cm.dispatch) cm.dispatch({ effects: [forceUpdateEffect.of(null)] });
          this.applyRenderedTableHighlights(cm);
        }
      }
    });
    this.scheduleRenderedTableHighlights();
  }
  createSelectionToolbarPlugin() {
    const plugin = this;
    let activeToolbarController = null;
    return import_view.ViewPlugin.fromClass(class {
      constructor(view) {
        __publicField(this, "toolbar", null);
        __publicField(this, "view");
        __publicField(this, "selectionCheckTimer", null);
        this.view = view;
      }
      update(update) {
        if (update.selectionSet || update.viewportChanged) {
          if (this.selectionCheckTimer) window.clearTimeout(this.selectionCheckTimer);
          this.selectionCheckTimer = window.setTimeout(() => {
            this.selectionCheckTimer = null;
            this.checkSelection();
          }, 50);
        }
      }
      checkSelection() {
        if (!plugin.settings.enableSelectionToolbar) {
          this.hideToolbar();
          return;
        }
        if (document.querySelector(".sidenote-edit-modal")) {
          this.hideToolbar();
          return;
        }
        const focusedEditors = Array.from(document.querySelectorAll(".cm-editor.cm-focused"));
        const focusedEditor = focusedEditors[focusedEditors.length - 1];
        if (focusedEditor && focusedEditor !== this.view.dom) {
          this.hideToolbar();
          return;
        }
        const selection = this.view.state.selection.main;
        if (!selection.empty && selection.to - selection.from > 0) {
          const text = this.view.state.sliceDoc(selection.from, selection.to);
          if (text.trim().length > 0) {
            this.showToolbar(selection);
            return;
          }
        }
        this.hideToolbar();
      }
      showToolbar(selection) {
        if (activeToolbarController && activeToolbarController.view !== this.view) {
          activeToolbarController.hideToolbar();
        }
        document.querySelectorAll(".sidenote-selection-toolbar").forEach((toolbar) => {
          if (toolbar !== this.toolbar) toolbar.remove();
        });
        if (!this.toolbar) {
          this.toolbar = document.createElement("div");
          this.toolbar.className = "sidenote-selection-toolbar";
          document.body.appendChild(this.toolbar);
          this.buildToolbarUI();
          this.toolbar.addEventListener("mousedown", (e) => {
            e.preventDefault();
          });
        }
        activeToolbarController = { view: this.view, hideToolbar: () => this.hideToolbar() };
        this.toolbar.style.display = "flex";
        const coords = this.view.coordsAtPos(selection.to);
        const fromCoords = this.view.coordsAtPos(selection.from);
        if (coords && fromCoords) {
          const toolbarWidth = this.toolbar.offsetWidth || 320;
          const toolbarHeight = this.toolbar.offsetHeight || 50;
          let leftCenter = (coords.left + fromCoords.left) / 2;
          let topEdge = Math.min(coords.top, fromCoords.top);
          const bottomEdge = Math.max(coords.bottom, fromCoords.bottom);
          const editorRect = this.view.dom.getBoundingClientRect();
          const padding = 10;
          if (leftCenter - toolbarWidth / 2 < editorRect.left + padding) {
            leftCenter = editorRect.left + toolbarWidth / 2 + padding;
          } else if (leftCenter + toolbarWidth / 2 > editorRect.right - padding) {
            leftCenter = editorRect.right - toolbarWidth / 2 - padding;
          }
          if (topEdge - toolbarHeight < editorRect.top + padding) {
            this.toolbar.classList.add("sidenote-toolbar-bottom");
            topEdge = bottomEdge;
          } else {
            this.toolbar.classList.remove("sidenote-toolbar-bottom");
          }
          this.toolbar.style.left = `${leftCenter}px`;
          this.toolbar.style.top = `${topEdge}px`;
        }
      }
      hideToolbar() {
        if (this.toolbar) {
          this.toolbar.remove();
          this.toolbar = null;
        }
        if ((activeToolbarController == null ? void 0 : activeToolbarController.view) === this.view) {
          activeToolbarController = null;
        }
      }
      destroy() {
        if (this.selectionCheckTimer) {
          window.clearTimeout(this.selectionCheckTimer);
          this.selectionCheckTimer = null;
        }
        this.hideToolbar();
      }
      buildToolbarUI() {
        if (!this.toolbar) return;
        const createBtn = (iconName, tooltip, markType, skipModal = false) => {
          const btn = document.createElement("button");
          btn.className = "sidenote-toolbar-btn";
          btn.title = tooltip;
          (0, import_obsidian.setIcon)(btn, iconName);
          btn.onclick = async () => {
            var _a, _b;
            const color = ((_b = (_a = this.toolbar) == null ? void 0 : _a.querySelector(".sidenote-toolbar-color-picker")) == null ? void 0 : _b.value) || plugin.settings.highlightColor || "#FFC800";
            await plugin.handleAddCommentFromEditorView(this.view, markType, color, skipModal);
          };
          return btn;
        };
        const boldBtn = createBtn("bold", "Bold", "bold", true);
        const highlighterBtn = createBtn("highlighter", "Highlight", "highlight", true);
        const underlineBtn = createBtn("underline", "Underline", "underline", true);
        const commentBtn = createBtn("message-square-plus", "Comment", "highlight", false);
        this.toolbar.appendChild(boldBtn);
        this.toolbar.appendChild(highlighterBtn);
        this.toolbar.appendChild(underlineBtn);
        this.toolbar.appendChild(commentBtn);
        const divider = document.createElement("div");
        divider.className = "sidenote-toolbar-divider";
        this.toolbar.appendChild(divider);
        const presetColors = [
          { name: "Purple", value: "#8b5cf6" },
          { name: "Pink", value: "#ec4899" },
          { name: "Blue", value: "#3b82f6" },
          { name: "Green", value: "#10b981" },
          { name: "Yellow", value: "#f59e0b" }
        ];
        const colorPicker = document.createElement("input");
        colorPicker.type = "color";
        colorPicker.className = "sidenote-toolbar-color-picker";
        colorPicker.value = plugin.settings.highlightColor || "#FFC800";
        let activeCircle = null;
        const updateActiveCircle = (circle) => {
          if (activeCircle) activeCircle.classList.remove("active");
          if (circle) circle.classList.add("active");
          activeCircle = circle;
        };
        presetColors.forEach((color) => {
          var _a;
          const circle = document.createElement("div");
          circle.className = "sidenote-color-circle";
          circle.style.setProperty("--circle-color", color.value);
          circle.title = color.name;
          if (colorPicker.value.toLowerCase() === color.value.toLowerCase()) {
            updateActiveCircle(circle);
          }
          circle.onclick = () => {
            colorPicker.value = color.value;
            updateActiveCircle(circle);
          };
          (_a = this.toolbar) == null ? void 0 : _a.appendChild(circle);
        });
        const customColorWrapper = document.createElement("div");
        customColorWrapper.className = "sidenote-color-circle custom-color";
        customColorWrapper.title = "Custom Color";
        colorPicker.onchange = () => {
          var _a;
          const matchedPreset = Array.from(((_a = this.toolbar) == null ? void 0 : _a.querySelectorAll(".sidenote-color-circle:not(.custom-color)")) || []).find((c) => {
            return c.style.getPropertyValue("--circle-color").toLowerCase() === colorPicker.value.toLowerCase();
          });
          if (matchedPreset) {
            updateActiveCircle(matchedPreset);
          } else {
            updateActiveCircle(customColorWrapper);
          }
        };
        customColorWrapper.appendChild(colorPicker);
        this.toolbar.appendChild(customColorWrapper);
      }
    });
  }
  createHighlightPlugin() {
    const plugin = this;
    const commentTooltip = (0, import_view.hoverTooltip)((view, pos, side) => {
      const filePath = plugin.getFilePathForEditorView(view);
      if (!filePath) return null;
      const comments = plugin.commentManager.getCommentsForFile(filePath);
      const { doc } = view.state;
      const hoveredComment = comments.find((comment) => {
        if (comment.isOrphaned) return false;
        try {
          const startLineObj = doc.line(comment.startLine + 1);
          const from = startLineObj.from + comment.startChar;
          let to = from;
          if (comment.isOrphaned) {
            to = Math.min(from + 1, startLineObj.to);
          } else {
            const endLineObj = doc.line(comment.endLine + 1);
            to = endLineObj.from + comment.endChar;
          }
          return pos >= from && pos <= to;
        } catch (e) {
          return false;
        }
      });
      if (!hoveredComment) return null;
      return {
        pos,
        above: true,
        arrow: false,
        offset: { x: 0, y: 14 },
        create(view2) {
          const dom = document.createElement("div");
          dom.className = "sidenote-tooltip";
          const content = dom.createDiv("sidenote-tooltip-content markdown-rendered");
          (async () => {
            await plugin.renderCommentContent(hoveredComment.comment || "", content, hoveredComment.filePath);
          })();
          return { dom };
        }
      };
    });
    const highlightPlugin = import_view.ViewPlugin.fromClass(class {
      constructor(view) {
        __publicField(this, "decorations");
        __publicField(this, "view");
        __publicField(this, "handleClickBound");
        __publicField(this, "handleDoubleClickBound");
        this.view = view;
        this.handleClickBound = this.handleClick.bind(this);
        this.handleDoubleClickBound = this.handleDoubleClick.bind(this);
        plugin.editorViews.add(view);
        this.decorations = this.buildDecorations(view);
        window.setTimeout(() => plugin.applyRenderedTableHighlights(view), 0);
        this.view.dom.addEventListener("click", this.handleClickBound);
        this.view.dom.addEventListener("dblclick", this.handleDoubleClickBound);
      }
      destroy() {
        plugin.editorViews.delete(this.view);
        this.view.dom.removeEventListener("click", this.handleClickBound);
        this.view.dom.removeEventListener("dblclick", this.handleDoubleClickBound);
      }
      handleClick(event) {
        const target = event.target;
        const highlight = target.closest(".sidenote-highlight");
        if (highlight) {
          const timestampStr = highlight.getAttribute("data-comment-timestamp");
          if (timestampStr) {
            const timestamp = parseInt(timestampStr, 10);
            plugin.activateViewAndHighlightComment(timestamp);
          }
        }
      }
      handleDoubleClick(event) {
        const target = event.target;
        const highlight = target.closest(".sidenote-highlight");
        if (highlight) {
          const timestampStr = highlight.getAttribute("data-comment-timestamp");
          if (timestampStr) {
            const timestamp = parseInt(timestampStr, 10);
            const comment = plugin.comments.find((c) => c.timestamp === timestamp);
            if (comment) {
              new CommentModal(plugin.app, plugin, { mode: "edit", comment }).open();
            }
          }
        }
      }
      update(update) {
        if (update.docChanged) plugin.mapCommentPositionsFromView(update);
        if (update.docChanged || update.viewportChanged || update.transactions.some((tr) => tr.effects.some((e) => e.is(forceUpdateEffect)))) {
          this.decorations = this.buildDecorations(update.view);
          window.setTimeout(() => plugin.applyRenderedTableHighlights(update.view), 0);
        }
      }
      buildDecorations(view) {
        const builder = new import_state.RangeSetBuilder();
        if (!plugin.settings.showHighlights) return builder.finish();
        const filePath = plugin.getFilePathForEditorView(view);
        if (!filePath) return builder.finish();
        const comments = plugin.commentManager.getCommentsForFile(filePath);
        const doc = view.state.doc;
        const decorationsArray = [];
        const tableCellContext = plugin.getTableCellContextForEditorView(view, filePath);
        if (tableCellContext) {
          const cellText = doc.toString();
          comments.forEach((comment) => {
            if (comment.isOrphaned || comment.startLine !== tableCellContext.sourceLine) return;
            if (comment.startChar < tableCellContext.cell.contentStart || comment.startChar > tableCellContext.cell.contentEnd) return;
            const expectedFrom = Math.max(0, comment.startChar - tableCellContext.cell.contentStart);
            const matches = [];
            let search = 0;
            while (comment.selectedText) {
              const found = cellText.indexOf(comment.selectedText, search);
              if (found === -1) break;
              matches.push(found);
              search = found + 1;
            }
            if (matches.length === 0) return;
            const from = matches.sort((a, b) => Math.abs(a - expectedFrom) - Math.abs(b - expectedFrom))[0];
            const to = from + comment.selectedText.length;
            if (from >= 0 && to <= doc.length && from < to && doc.sliceString(from, to) === comment.selectedText) {
              const presentation = plugin.getCommentHighlightPresentation(comment);
              const attributes = { "data-comment-timestamp": comment.timestamp.toString() };
              if (presentation.style) attributes.style = presentation.style;
              decorationsArray.push({
                from,
                to,
                decoration: import_view.Decoration.mark({
                  class: presentation.className,
                  attributes
                })
              });
            }
          });
          decorationsArray.sort((a, b) => a.from - b.from);
          decorationsArray.forEach(({ from, to, decoration }) => builder.add(from, to, decoration));
          return builder.finish();
        }
        comments.forEach((comment) => {
          try {
            const startLineObj = doc.line(comment.startLine + 1);
            const from = startLineObj.from + comment.startChar;
            let to = from;
            if (comment.isOrphaned) {
              to = Math.min(from + 1, startLineObj.to);
            } else {
              try {
                const endLineObj = doc.line(comment.endLine + 1);
                to = endLineObj.from + comment.endChar;
              } catch (e) {
                to = doc.length;
              }
            }
            if (!comment.isOrphaned && doc.sliceString(from, to) !== comment.selectedText) return;
            if (from >= 0 && to <= doc.length && from < to) {
              const attributes = { "data-comment-timestamp": comment.timestamp.toString() };
              if (comment.color) {
                const rgb = plugin.hexToRgb(comment.color);
                const opacity = plugin.settings.highlightOpacity;
                attributes.style = `--sidenote-highlight-color: rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity}); --sidenote-highlight-hover: rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.min(opacity + 0.15, 1)}); --sidenote-highlight-border: rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.min(opacity + 0.4, 1)});`;
              }
              decorationsArray.push({
                from,
                to,
                decoration: import_view.Decoration.mark({
                  class: `sidenote-highlight${comment.isOrphaned ? " orphaned" : ""} sidenote-mark-${comment.markType || "highlight"}`,
                  attributes
                })
              });
            }
          } catch (e) {
          }
        });
        decorationsArray.sort((a, b) => a.from - b.from);
        decorationsArray.forEach(({ from, to, decoration }) => builder.add(from, to, decoration));
        return builder.finish();
      }
    }, { decorations: (v) => v.decorations });
    return [highlightPlugin, commentTooltip];
  }
};
