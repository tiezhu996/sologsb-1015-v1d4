import { computed, Injectable, signal } from '@angular/core';
import type {
  AdjudicationProgress,
  AntithesisPair,
  AnalysisCell,
  AnalysisLine,
  CharacterMark,
  CharDiff,
  MarkTone,
  MeterTemplate,
  PoemIssue,
  PoemVersion,
  PoemWorkspace,
  SuggestionBatch,
  SuggestionItem,
  Tone,
} from '../models/poem.models';

export const METER_TEMPLATES: MeterTemplate[] = [
  {
    id: 'wuyan-zeqi',
    name: '五言绝句 · 仄起首句不入韵',
    summary: '四句，每句五字；二、四句押韵',
    lineCount: 4,
    lineLength: 5,
    pattern: ['仄', '仄', '中', '平', '仄', '中', '平', '中', '仄', '仄', '中', '平', '中', '仄', '中', '平', '中', '仄', '中', '平'],
    rhymeLines: [1, 3],
  },
  {
    id: 'wuyan-pingqi',
    name: '五言绝句 · 平起首句入韵',
    summary: '四句，每句五字；一、二、四句押韵',
    lineCount: 4,
    lineLength: 5,
    pattern: ['中', '平', '中', '仄', '平', '仄', '仄', '中', '平', '仄', '中', '平', '中', '仄', '仄', '中', '平', '仄', '中', '平'],
    rhymeLines: [0, 1, 3],
  },
  {
    id: 'qiyan-zeqi',
    name: '七言绝句 · 仄起首句入韵',
    summary: '四句，每句七字；一、二、四句押韵',
    lineCount: 4,
    lineLength: 7,
    pattern: ['仄', '仄', '中', '平', '中', '仄', '平', '中', '平', '中', '仄', '仄', '中', '平', '中', '仄', '中', '平', '中', '仄', '仄', '中', '平', '中', '仄', '中', '平', '中'],
    rhymeLines: [0, 1, 3],
  },
  {
    id: 'qiyan-pingqi',
    name: '七言绝句 · 平起首句不入韵',
    summary: '四句，每句七字；二、四句押韵',
    lineCount: 4,
    lineLength: 7,
    pattern: ['中', '平', '中', '仄', '仄', '中', '平', '仄', '仄', '中', '平', '平', '仄', '仄', '中', '平', '中', '仄', '中', '平', '仄', '仄', '中', '平', '中', '仄', '仄', '中', '平'],
    rhymeLines: [1, 3],
  },
];

const STORAGE_KEY = 'sologsb-1015-poetry-workspace-v2';
const LEGACY_STORAGE_KEY = 'sologsb-1015-poetry-workspace-v1';
const PUNCTUATION = new Set(['，', '。', '！', '？', '；', '：', '、', ' ', '\t']);
const TONE_DICTIONARY: Record<string, Tone> = {
  春: '平', 眠: '平', 不: '仄', 觉: '仄', 晓: '仄', 处: '仄', 闻: '平', 啼: '平', 鸟: '仄',
  夜: '仄', 来: '平', 风: '平', 雨: '仄', 声: '平', 花: '平', 落: '仄', 知: '平', 多: '平', 少: '仄',
  国: '仄', 破: '仄', 山: '平', 河: '平', 在: '仄', 城: '平', 深: '平', 木: '仄', 草: '仄', 独: '仄',
  明: '平', 月: '仄', 高: '平', 天: '平', 故: '仄', 乡: '平', 万: '仄', 里: '仄', 江: '平', 船: '平',
};

const clone = <T>(value: T): T => structuredClone(value);
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function charsOf(lineText: string): string[] {
  return Array.from(lineText).filter((char) => !PUNCTUATION.has(char));
}

function defaultMark(): CharacterMark {
  return { tone: '?', rhyme: '', pauseAfter: false, basis: '', note: '', origin: '' };
}

function buildCharIds(text: string): string[][] {
  return text.split('\n').map((line) => charsOf(line).map(() => uid('c')));
}

/**
 * 正文增删后把旧标注重新对齐：以字符级 LCS 对齐新旧文本，
 * 对得上的字保留原字符 ID（标注跟着原字走），对不上的旧标注转入失效待重算，
 * 新增字分配新 ID（自然处于待标状态），受影响句的对仗关系转待复核。
 */
function remapVersionText(version: PoemVersion, newText: string): void {
  const oldEntries: { id: string; char: string; line: number; position: number }[] = [];
  version.text.split('\n').forEach((lineText, line) => {
    charsOf(lineText).forEach((char, position) => {
      oldEntries.push({ id: version.charIds[line]?.[position] ?? uid('c'), char, line, position });
    });
  });
  const newLines = newText.split('\n').map((line) => charsOf(line));
  const newEntries = newLines.flatMap((chars, line) => chars.map((char, position) => ({ char, line, position })));

  const pairs = lcsPairs(oldEntries.map((entry) => entry.char), newEntries.map((entry) => entry.char));

  const charIds: string[][] = newLines.map((chars) => chars.map(() => uid('c')));
  pairs.forEach(([oi, ni]) => {
    // 对得上的字继承原字符 ID，标注跟着原字走
    const target = newEntries[ni];
    charIds[target.line][target.position] = oldEntries[oi].id;
  });

  const survivingIds = new Set(charIds.flat());
  const marks: Record<string, CharacterMark> = {};
  Object.entries(version.marks).forEach(([id, mark]) => {
    if (survivingIds.has(id)) {
      marks[id] = mark;
    } else {
      const orphan = oldEntries.find((entry) => entry.id === id);
      version.invalidated.push({
        id: uid('stale'),
        char: orphan?.char ?? '',
        line: orphan?.line ?? 0,
        position: orphan?.position ?? 0,
        mark,
        reason: '正文增删后未能对应回原字，待重算',
      });
    }
  });

  const oldLineTexts = version.text.split('\n').map((line) => charsOf(line).join(''));
  const newLineTexts = newLines.map((chars) => chars.join(''));
  const changedLines = new Set<number>();
  const lineSpan = Math.max(oldLineTexts.length, newLineTexts.length);
  for (let index = 0; index < lineSpan; index += 1) {
    if (oldLineTexts[index] !== newLineTexts[index]) changedLines.add(index);
  }
  version.antithesisPairs = version.antithesisPairs.map((pair) =>
    changedLines.has(pair.leftLine) || changedLines.has(pair.rightLine) || pair.leftLine >= newLineTexts.length || pair.rightLine >= newLineTexts.length
      ? { ...pair, status: 'review' }
      : pair,
  );

  version.text = newText;
  version.charIds = charIds;
  version.marks = marks;
}

/** 字符级 LCS，返回 [旧下标, 新下标] 配对；诗篇幅小，动态规划足够 */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  const rows = a.length;
  const cols = b.length;
  const table: Uint32Array[] = Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

function normalizeMark(mark: Partial<CharacterMark> | undefined, origin: string): CharacterMark {
  return { ...defaultMark(), ...mark, origin: mark?.origin ?? origin };
}

function initialWorkspace(): PoemWorkspace {
  const now = new Date().toISOString();
  const text = '春眠不觉晓，\n处处闻啼鸟。\n夜来风雨声，\n花落知多少。';
  const charIds = buildCharIds(text);
  const marks: Record<string, CharacterMark> = {};
  const rhymeCells: [string, number][] = [['晓', 0], ['鸟', 1], ['声', 2], ['少', 3]];
  rhymeCells.forEach(([char, line]) => {
    marks[charIds[line][4]] = { tone: '平', rhyme: 'A', pauseAfter: false, basis: '《平水韵》上声十七筱', note: `${char} 为韵脚`, origin: '手工校定' };
  });
  [0, 1, 2].forEach((line) => {
    marks[charIds[line][2]] = { tone: '平', rhyme: '', pauseAfter: false, basis: '平水韵', note: line === 0 ? '句中平声' : '', origin: '手工校定' };
  });

  const topVersion: PoemVersion = {
    id: 'version-main',
    name: '通行本 · 孟浩然集',
    source: '《孟浩然诗集笺注》',
    createdAt: now,
    text,
    charIds,
    marks,
    invalidated: [],
    antithesisPairs: [],
  };
  const variant: PoemVersion = {
    id: 'version-song',
    name: '宋刻本异文',
    source: '宋蜀刻本',
    createdAt: now,
    text,
    charIds: clone(charIds),
    marks: clone(marks),
    invalidated: [],
    antithesisPairs: [],
  };
  return {
    title: '春晓',
    author: '孟浩然',
    templateId: 'wuyan-zeqi',
    versions: [topVersion, variant],
    activeVersionId: topVersion.id,
    batches: [],
    updatedAt: now,
  };
}

/** v1 旧数据按当时的「行:位」键一次性换算成字符 ID，保证升级后既有标注不会串到别字 */
function migrateLegacyWorkspace(legacy: PoemWorkspace & { versions: (PoemVersion & { marks: Record<string, CharacterMark> })[] }): PoemWorkspace {
  const versions = legacy.versions.map((version) => {
    const charIds = buildCharIds(version.text);
    const marks: Record<string, CharacterMark> = {};
    const invalidated: PoemVersion['invalidated'] = [];
    Object.entries(version.marks ?? {}).forEach(([legacyKey, mark]) => {
      const [line, position] = legacyKey.split(':').map(Number);
      const id = charIds[line]?.[position];
      if (id) {
        marks[id] = normalizeMark(mark, mark?.origin || '手工校定');
      } else {
        invalidated.push({ id: uid('stale'), char: '', line, position, mark: normalizeMark(mark, '手工校定'), reason: '旧数据升级时位置越界，待重算' });
      }
    });
    return {
      ...version,
      charIds,
      marks,
      invalidated,
      antithesisPairs: (version.antithesisPairs ?? []).map((pair) => ({ ...pair, status: pair.status ?? 'active' })),
    };
  });
  return { ...legacy, versions, batches: legacy.batches ?? [] };
}

function loadWorkspace(): PoemWorkspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PoemWorkspace;
      if (parsed.versions?.length) {
        parsed.batches = parsed.batches ?? [];
        parsed.versions.forEach((version) => {
          version.invalidated = version.invalidated ?? [];
          version.charIds = version.charIds?.length ? version.charIds : buildCharIds(version.text);
          version.antithesisPairs = (version.antithesisPairs ?? []).map((pair) => ({ ...pair, status: pair.status ?? 'active' }));
        });
        return parsed;
      }
    }
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw);
      if (legacy.versions?.length) return migrateLegacyWorkspace(legacy);
    }
    return initialWorkspace();
  } catch {
    return initialWorkspace();
  }
}

function summarizeBatch(batch: SuggestionBatch): AdjudicationProgress {
  const tally = { total: 0, decided: 0, adopted: 0, rejected: 0, matched: 0, pending: 0, percent: 0 };
  batch.items.forEach((item) => {
    tally.total += 1;
    if (item.status === 'adopted') tally.adopted += 1;
    else if (item.status === 'rejected') tally.rejected += 1;
    else if (item.status === 'matched') tally.matched += 1;
    else if (item.status === 'pending') tally.pending += 1;
  });
  tally.decided = tally.total - tally.pending;
  tally.percent = tally.total ? Math.round((tally.decided / tally.total) * 100) : 100;
  return tally;
}

@Injectable({ providedIn: 'root' })
export class PoetryStoreService {
  readonly workspace = signal<PoemWorkspace>(loadWorkspace());
  readonly selectedLine = signal(0);
  readonly selectedPosition = signal(4);
  readonly baselineVersionId = signal<string>('');
  readonly currentDiffIndex = signal(0);
  readonly activeBatchId = signal<string>('');
  readonly toast = signal('');
  readonly undoCount = signal(0);
  readonly redoCount = signal(0);

  private undoStack: PoemWorkspace[] = [];
  private redoStack: PoemWorkspace[] = [];

  readonly activeVersion = computed(() => {
    const state = this.workspace();
    return state.versions.find((version) => version.id === state.activeVersionId) ?? state.versions[0];
  });

  readonly template = computed(() => {
    return METER_TEMPLATES.find((item) => item.id === this.workspace().templateId) ?? METER_TEMPLATES[0];
  });

  readonly lines = computed(() => this.activeVersion().text.split('\n'));

  private markOf(version: PoemVersion, line: number, position: number): CharacterMark {
    const id = version.charIds[line]?.[position];
    return (id && version.marks[id]) || defaultMark();
  }

  readonly analysis = computed<AnalysisLine[]>(() => {
    const version = this.activeVersion();
    const template = this.template();
    return this.lines().map((line, lineIndex) => {
      const chars = charsOf(line);
      const cells: AnalysisCell[] = chars.map((char, position) => {
        const mark = this.markOf(version, lineIndex, position);
        const expected = template.pattern[lineIndex * template.lineLength + position] ?? '中';
        const actual = mark.tone === '?' ? (TONE_DICTIONARY[char] ?? '?') : mark.tone;
        let status: AnalysisCell['status'] = 'neutral';
        let message = '标点或不计律位置';
        if (actual === '?') {
          status = 'unknown';
          message = '尚未标注平仄';
        } else if (expected === '中') {
          status = 'correct';
          message = '可平可仄';
        } else if (actual === expected) {
          status = 'correct';
          message = '合律';
        } else if (this.isAcceptableVariant(template, lineIndex, position)) {
          status = 'variant';
          message = '一三五位置的可接受变体';
        } else {
          status = 'error';
          message = `此处应为${expected}声`;
        }
        if (mark.origin) message += `｜来源：${mark.origin}`;
        return { char, position, expected, actual, status, message, mark };
      });
      const rhymeChars = template.rhymeLines.includes(lineIndex) ? cells.slice(-1).map((cell) => cell.char) : [];
      return {
        index: lineIndex,
        cells,
        rhymeChars,
        errors: cells.filter((cell) => cell.status === 'error').length,
        variants: cells.filter((cell) => cell.status === 'variant').length,
      };
    });
  });

  readonly issues = computed<PoemIssue[]>(() => {
    const analysis = this.analysis();
    const version = this.activeVersion();
    const template = this.template();
    const issues: PoemIssue[] = [];
    analysis.forEach((line) => {
      line.cells.filter((cell) => cell.status === 'error').forEach((cell) => {
        issues.push({
          id: uid('issue'),
          level: 'error',
          title: '出律位置',
          detail: `第 ${line.index + 1} 句“${cell.char}”：${cell.message}`,
          line: line.index,
          position: cell.position,
        });
      });
      if (line.cells.some((cell) => cell.status === 'unknown')) {
        issues.push({ id: uid('issue'), level: 'warning', title: '存在未标注字', detail: `第 ${line.index + 1} 句仍有平仄未确认。`, line: line.index });
      }
    });
    const rhymeCells = template.rhymeLines.map((line) => analysis[line]?.cells.at(-1)).filter(Boolean);
    const rhymeGroups = new Map<string, string[]>();
    rhymeCells.forEach((cell) => {
      if (!cell?.mark.rhyme) {
        issues.push({ id: uid('issue'), level: 'warning', title: '韵脚缺少韵部', detail: `第 ${(cell?.position ?? 0) + 1} 句末字尚未指定韵部。` });
        return;
      }
      rhymeGroups.set(cell.mark.rhyme, [...(rhymeGroups.get(cell.mark.rhyme) ?? []), cell.char]);
    });
    rhymeGroups.forEach((chars, rhyme) => {
      const duplicate = chars.find((char, index) => chars.indexOf(char) !== index);
      if (duplicate) issues.push({ id: uid('issue'), level: 'warning', title: '重复用韵', detail: `韵部 ${rhyme} 重复使用末字“${duplicate}”。` });
    });
    version.invalidated.forEach((stale) => {
      issues.push({
        id: stale.id,
        level: 'warning',
        title: '失效标注待重算',
        detail: `“${stale.char || '?'}”原标 ${stale.mark.tone}${stale.mark.rhyme ? `／韵${stale.mark.rhyme}` : ''}（原第 ${stale.line + 1} 句第 ${stale.position + 1} 字）未能对应回原字。`,
      });
    });
    version.antithesisPairs.filter((pair) => pair.status === 'review').forEach((pair) => {
      issues.push({
        id: `review-${pair.id}`,
        level: 'warning',
        title: '对仗关系待复核',
        detail: `第 ${pair.leftLine + 1} 句 ↔ 第 ${pair.rightLine + 1} 句受正文增删影响，请复核。`,
        line: pair.leftLine,
      });
    });
    const progress = this.adjudicationProgress();
    if (progress.pending > 0) {
      issues.push({ id: 'adjudication-pending', level: 'info', title: '刻本建议待裁决', detail: `尚有 ${progress.pending} 条建议未裁决，采纳前不会写入字格。` });
    }
    if (version.antithesisPairs.length === 0) {
      issues.push({ id: 'antithesis-empty', level: 'info', title: '尚未标记对仗', detail: '可在检视器中把两句建立对仗关系。' });
    }
    if (!issues.some((issue) => issue.level === 'error')) {
      issues.unshift({ id: 'meter-ok', level: 'info', title: '格律检查通过', detail: '当前未发现硬性出律，请继续核对可接受变体。' });
    }
    return issues;
  });

  readonly diff = computed<CharDiff[]>(() => {
    const left = this.workspace().versions.find((version) => version.id === this.baselineVersionId());
    const right = this.activeVersion();
    if (!left || left.id === right.id) return [];
    const leftChars = Array.from(left.text.replace(/\n/g, ''));
    const rightChars = Array.from(right.text.replace(/\n/g, ''));
    const size = Math.max(leftChars.length, rightChars.length);
    return Array.from({ length: size }, (_, index) => ({
      index,
      left: leftChars[index] ?? '',
      right: rightChars[index] ?? '',
      changed: leftChars[index] !== rightChars[index],
    }));
  });

  readonly differences = computed(() => this.diff().filter((item) => item.changed).map((item) => item.index));
  readonly baselineVersion = computed(() => this.workspace().versions.find((version) => version.id === this.baselineVersionId()));

  readonly activeBatches = computed(() => this.workspace().batches.filter((batch) => batch.versionId === this.activeVersion().id));
  readonly activeBatch = computed(() => this.workspace().batches.find((batch) => batch.id === this.activeBatchId()) ?? null);

  /** 字格、异文对照与导出共用同一份裁决进度 */
  readonly adjudicationProgress = computed<AdjudicationProgress>(() => {
    const tally: AdjudicationProgress = { total: 0, decided: 0, adopted: 0, rejected: 0, matched: 0, pending: 0, percent: 100 };
    this.activeBatches().forEach((batch) => {
      const part = summarizeBatch(batch);
      tally.total += part.total;
      tally.decided += part.decided;
      tally.adopted += part.adopted;
      tally.rejected += part.rejected;
      tally.matched += part.matched;
      tally.pending += part.pending;
    });
    tally.percent = tally.total ? Math.round((tally.decided / tally.total) * 100) : 100;
    return tally;
  });

  /** 有待裁决建议的字位集合，供字格角标使用 */
  readonly pendingSuggestionCells = computed(() => {
    const cells = new Set<string>();
    this.activeBatches().forEach((batch) => {
      batch.items.filter((item) => item.status === 'pending').forEach((item) => cells.add(`${item.line}:${item.position}`));
    });
    return cells;
  });

  readonly currentBatchItem = computed<SuggestionItem | null>(() => {
    const batch = this.activeBatch();
    if (!batch) return null;
    return batch.items[batch.cursor] ?? batch.items.find((item) => item.status === 'pending') ?? batch.items[0] ?? null;
  });

  batchProgress(batch: SuggestionBatch): AdjudicationProgress {
    return summarizeBatch(batch);
  }

  selectVersion(id: string): void {
    this.workspace.update((workspace) => ({ ...workspace, activeVersionId: id }));
  }

  selectCell(line: number, position: number): void {
    this.selectedLine.set(line);
    this.selectedPosition.set(position);
  }

  setTemplate(id: string): void {
    this.commit((workspace) => {
      workspace.templateId = id;
    });
  }

  updateText(text: string): void {
    this.commit((workspace) => {
      remapVersionText(this.versionIn(workspace), text);
    });
  }

  updateTitle(title: string): void {
    this.commit((workspace) => {
      workspace.title = title;
    });
  }

  updateVersionSource(source: string): void {
    this.commit((workspace) => {
      this.versionIn(workspace).source = source;
    });
  }

  setMark(patch: Partial<CharacterMark>): void {
    this.commit((workspace) => {
      const version = this.versionIn(workspace);
      const id = version.charIds[this.selectedLine()]?.[this.selectedPosition()];
      if (!id) return;
      const existing = version.marks[id];
      // 只有改动平仄或韵组才算新的手工判定；停顿、批注等维护操作保留既有来源
      const touchesVerdict = patch.tone !== undefined || patch.rhyme !== undefined;
      const origin = patch.origin ?? (touchesVerdict || !existing ? '手工校定' : existing.origin);
      version.marks[id] = { ...defaultMark(), ...existing, ...patch, origin };
    });
  }

  /** 裁决条目对应的实时字格标注；原字已删时返回 null */
  liveMarkOf(item: SuggestionItem): CharacterMark | null {
    const batch = this.activeBatch();
    const version = this.workspace().versions.find((entry) => entry.id === (batch?.versionId ?? this.activeVersion().id));
    if (!version || !version.charIds.some((line) => line.includes(item.charId))) return null;
    return version.marks[item.charId] ?? defaultMark();
  }

  cycleTone(): void {
    const cell = this.selectedCell();
    const next: Record<Tone, MarkTone | '?'> = { '?': '平', '平': '仄', '仄': '中', '中': '?' };
    this.setMark({ tone: next[cell?.actual ?? '?'] });
  }

  togglePause(): void {
    const cell = this.selectedCell();
    this.setMark({ pauseAfter: !(cell?.mark.pauseAfter ?? false) });
  }

  cycleRhyme(): void {
    const cell = this.selectedCell();
    const current = cell?.mark.rhyme ?? '';
    const next = current === '' ? 'A' : current === 'A' ? 'B' : current === 'B' ? 'C' : '';
    this.setMark({ rhyme: next });
  }

  addAntithesis(): void {
    const line = this.selectedLine();
    const other = line === 0 ? 1 : line - 1;
    this.commit((workspace) => {
      const version = this.versionIn(workspace);
      if (version.antithesisPairs.some((pair) => pair.leftLine === Math.min(line, other) && pair.rightLine === Math.max(line, other))) return;
      version.antithesisPairs.push({ id: uid('pair'), leftLine: Math.min(line, other), rightLine: Math.max(line, other), note: '结构相对，词性相应。', status: 'active' });
    });
  }

  removeAntithesis(id: string): void {
    this.commit((workspace) => {
      const version = this.versionIn(workspace);
      version.antithesisPairs = version.antithesisPairs.filter((pair) => pair.id !== id);
    });
  }

  updateAntithesis(id: string, note: string): void {
    this.commit((workspace) => {
      const pair = this.versionIn(workspace).antithesisPairs.find((item) => item.id === id);
      if (pair) pair.note = note;
    });
  }

  confirmAntithesis(id: string): void {
    this.commit((workspace) => {
      const pair = this.versionIn(workspace).antithesisPairs.find((item) => item.id === id);
      if (pair) pair.status = 'active';
    });
  }

  discardInvalidated(id: string): void {
    this.commit((workspace) => {
      const version = this.versionIn(workspace);
      version.invalidated = version.invalidated.filter((item) => item.id !== id);
    });
  }

  /** 把失效标注重新套用到当前选中字，完成人工重算 */
  reapplyInvalidated(id: string): void {
    this.commit((workspace) => {
      const version = this.versionIn(workspace);
      const stale = version.invalidated.find((item) => item.id === id);
      const targetId = version.charIds[this.selectedLine()]?.[this.selectedPosition()];
      if (!stale || !targetId) return;
      version.marks[targetId] = { ...stale.mark, origin: stale.mark.origin || '手工校定' };
      version.invalidated = version.invalidated.filter((item) => item.id !== id);
    });
  }

  /**
   * 把新见刻本的整段建议登记为待裁决批次：逐字与当前字位对照，
   * 只生成对照项，不改动任何字格标注。
   * 输入格式：每行对应一句，取其中「平/仄/中」字符依次对照；行尾可附「韵:X」作为该句末字韵组建议。
   */
  createSuggestionBatch(name: string, source: string, input: string): void {
    const version = this.activeVersion();
    const suggestionLines = input.split('\n').filter((line) => line.trim());
    const items: SuggestionItem[] = [];
    suggestionLines.slice(0, this.lines().length).forEach((suggestion, lineIndex) => {
      const rhymeMatch = suggestion.match(/韵\s*[:：]\s*(\S+)/);
      const suggestedRhyme = rhymeMatch?.[1] ?? '';
      const tones = Array.from(suggestion.replace(/韵\s*[:：]\s*\S+/g, '')).filter((char): char is MarkTone => char === '平' || char === '仄' || char === '中');
      const charCount = version.charIds[lineIndex]?.length ?? 0;
      for (let position = 0; position < charCount; position += 1) {
        const suggestedTone = tones[position] ?? '';
        const isLast = position === charCount - 1;
        const rhyme = isLast ? suggestedRhyme : '';
        if (!suggestedTone && !rhyme) continue;
        const charId = version.charIds[lineIndex][position];
        const manual = clone(version.marks[charId] ?? defaultMark());
        const toneClash = !!suggestedTone && manual.tone !== '?' && manual.tone !== suggestedTone;
        const rhymeClash = !!rhyme && !!manual.rhyme && manual.rhyme !== rhyme;
        const matched = !toneClash && !rhymeClash && (!suggestedTone || manual.tone === suggestedTone) && (!rhyme || manual.rhyme === rhyme);
        items.push({
          id: uid('item'),
          charId,
          char: charsOf(this.lines()[lineIndex] ?? '')[position] ?? '',
          line: lineIndex,
          position,
          suggestedTone,
          suggestedRhyme: rhyme,
          manual,
          conflict: toneClash || rhymeClash,
          status: matched && (manual.tone !== '?' || !!manual.rhyme) ? 'matched' : 'pending',
        });
      }
    });
    if (!items.length) {
      this.toast.set('未解析到可用建议，请核对格式');
      return;
    }
    const batch: SuggestionBatch = {
      id: uid('batch'),
      name: name.trim() || `刻本建议 ${this.workspace().batches.length + 1}`,
      source: source.trim(),
      createdAt: new Date().toISOString(),
      versionId: version.id,
      items,
      cursor: Math.max(0, items.findIndex((item) => item.status === 'pending')),
    };
    this.commit((workspace) => {
      workspace.batches.unshift(batch);
    });
    this.activeBatchId.set(batch.id);
    this.toast.set(`已登记 ${items.length} 条建议，待逐字裁决`);
  }

  /** 采纳：把建议写入字格并留下来源；手工原值仍保留在批次记录里 */
  adoptSuggestion(itemId: string): void {
    this.resolveSuggestion(itemId, 'adopted');
  }

  /** 保留手定：建议留档不写入字格 */
  rejectSuggestion(itemId: string): void {
    this.resolveSuggestion(itemId, 'rejected');
  }

  private resolveSuggestion(itemId: string, verdict: 'adopted' | 'rejected'): void {
    const batchId = this.activeBatchId();
    this.commit((workspace) => {
      const batch = workspace.batches.find((item) => item.id === batchId);
      const item = batch?.items.find((entry) => entry.id === itemId);
      if (!batch || !item || item.status !== 'pending') return;
      const version = workspace.versions.find((entry) => entry.id === batch.versionId);
      if (!version) return;
      if (!version.charIds.flat().includes(item.charId)) {
        item.status = 'obsolete';
        return;
      }
      if (verdict === 'adopted') {
        const current = version.marks[item.charId] ?? defaultMark();
        version.marks[item.charId] = {
          ...current,
          tone: item.suggestedTone || current.tone,
          rhyme: item.suggestedRhyme || current.rhyme,
          origin: batch.name,
        };
      }
      item.status = verdict;
      const next = batch.items.findIndex((entry, index) => index > batch.cursor && entry.status === 'pending');
      const fallback = batch.items.findIndex((entry) => entry.status === 'pending');
      batch.cursor = next >= 0 ? next : Math.max(fallback, 0);
    });
    const cursorItem = this.activeBatch()?.items[this.activeBatch()?.cursor ?? 0];
    if (cursorItem) this.selectCell(cursorItem.line, cursorItem.position);
  }

  resumeBatch(batchId: string): void {
    this.activeBatchId.set(batchId);
    const batch = this.workspace().batches.find((item) => item.id === batchId);
    if (!batch) return;
    const pendingIndex = batch.items.findIndex((entry, index) => index >= batch.cursor && entry.status === 'pending');
    const target = batch.items[pendingIndex >= 0 ? pendingIndex : batch.cursor] ?? batch.items[0];
    if (target) this.selectCell(target.line, target.position);
  }

  stepBatchItem(delta: number): void {
    const batch = this.activeBatch();
    if (!batch || !batch.items.length) return;
    const next = Math.min(batch.items.length - 1, Math.max(0, batch.cursor + delta));
    this.commit((workspace) => {
      const target = workspace.batches.find((item) => item.id === batch.id);
      if (target) target.cursor = next;
    });
    const item = batch.items[next];
    if (item) this.selectCell(item.line, item.position);
  }

  jumpToBatchItem(index: number): void {
    const batch = this.activeBatch();
    if (!batch || !batch.items[index]) return;
    this.commit((workspace) => {
      const target = workspace.batches.find((item) => item.id === batch.id);
      if (target) target.cursor = index;
    });
    const item = batch.items[index];
    this.selectCell(item.line, item.position);
  }

  removeBatch(batchId: string): void {
    this.commit((workspace) => {
      workspace.batches = workspace.batches.filter((batch) => batch.id !== batchId);
    });
    if (this.activeBatchId() === batchId) this.activeBatchId.set('');
  }

  snapshot(): void {
    const active = clone(this.activeVersion());
    active.id = uid('version');
    active.name = `校勘稿 ${this.workspace().versions.length}`;
    active.createdAt = new Date().toISOString();
    this.commit((workspace) => {
      workspace.versions.unshift(active);
      workspace.activeVersionId = active.id;
    });
    this.toast.set('已建立独立校勘稿');
  }

  duplicateActiveAsBaseline(): void {
    this.baselineVersionId.set(this.activeVersion().id);
  }

  nextDifference(): void {
    const values = this.differences();
    if (!values.length) return;
    const current = values.findIndex((index) => index >= this.currentDiffIndex());
    this.currentDiffIndex.set(values[(current + 1) % values.length]);
  }

  previousDifference(): void {
    const values = this.differences();
    if (!values.length) return;
    const reverse = [...values].reverse();
    const current = reverse.findIndex((index) => index <= this.currentDiffIndex());
    this.currentDiffIndex.set(reverse[(current + 1) % reverse.length]);
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(clone(this.workspace()));
    this.workspace.set(previous);
    this.undoCount.set(this.undoStack.length);
    this.redoCount.set(this.redoStack.length);
    this.persist();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.workspace()));
    this.workspace.set(next);
    this.undoCount.set(this.undoStack.length);
    this.redoCount.set(this.redoStack.length);
    this.persist();
  }

  exportProofreadCopy(): string {
    const active = this.activeVersion();
    const lines = this.analysis().map((line) => {
      const tags = line.cells.map((cell) => {
        const origin = cell.mark.origin ? `〈${cell.mark.origin}〉` : '';
        return `${cell.char}${cell.actual === '?' ? '□' : `(${cell.actual})`}${origin}`;
      }).join(' ');
      return `第 ${line.index + 1} 句：${tags}`;
    });
    const notes = this.issues().map((issue) => `[${issue.level.toUpperCase()}] ${issue.title}：${issue.detail}`);
    const progress = this.adjudicationProgress();
    const adjudication = [
      `裁决进度：${progress.decided}/${progress.total}（采纳 ${progress.adopted} · 保留手定 ${progress.rejected} · 一致 ${progress.matched} · 待裁决 ${progress.pending}）`,
      ...this.activeBatches().map((batch) => {
        const part = summarizeBatch(batch);
        return `- 批次「${batch.name}」${batch.source ? `（${batch.source}）` : ''}：已裁决 ${part.decided}/${part.total}，采纳 ${part.adopted}，保留手定 ${part.rejected}`;
      }),
    ];
    const stale = active.invalidated.map((item) => `- “${item.char || '?'}”原标 ${item.mark.tone}${item.mark.rhyme ? `／韵${item.mark.rhyme}` : ''}（原第 ${item.line + 1} 句第 ${item.position + 1} 字）：${item.reason}`);
    const reviewPairs = active.antithesisPairs.filter((pair) => pair.status === 'review').map((pair) => `- 第 ${pair.leftLine + 1} 句 ↔ 第 ${pair.rightLine + 1} 句待复核`);
    return [
      `# ${this.workspace().title} · 格律校对稿`, '',
      `底本：${active.name}`, `出处：${active.source}`, '',
      '## 字音标注', ...lines, '',
      '## 刻本建议裁决', ...adjudication, '',
      '## 检查记录', ...notes,
      ...(stale.length ? ['', '## 失效标注（待重算）', ...stale] : []),
      ...(reviewPairs.length ? ['', '## 待复核对仗', ...reviewPairs] : []),
    ].join('\n');
  }

  downloadProofreadCopy(): void {
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([this.exportProofreadCopy()], { type: 'text/markdown;charset=utf-8' }));
    anchor.download = `${this.workspace().title}-格律校对稿.md`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  selectedCell(): AnalysisCell | undefined {
    return this.analysis()[this.selectedLine()]?.cells[this.selectedPosition()];
  }

  private commit(mutator: (workspace: PoemWorkspace) => void): void {
    this.undoStack.push(clone(this.workspace()));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
    const next = clone(this.workspace());
    mutator(next);
    next.updatedAt = new Date().toISOString();
    this.workspace.set(next);
    this.undoCount.set(this.undoStack.length);
    this.redoCount.set(0);
    this.persist();
  }

  private versionIn(workspace: PoemWorkspace): PoemVersion {
    const version = workspace.versions.find((item) => item.id === workspace.activeVersionId) ?? workspace.versions[0];
    return version;
  }

  private persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.workspace()));
  }

  private isAcceptableVariant(template: MeterTemplate, line: number, position: number): boolean {
    if (template.lineLength === 5) return position === 0 || position === 2;
    return position === 0 || position === 2 || position === 4;
  }
}
