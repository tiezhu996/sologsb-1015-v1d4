import { computed, Injectable, signal } from '@angular/core';
import type {
  AnalysisCell,
  AnalysisLine,
  AntithesisPair,
  BatchProgress,
  CellSuggestion,
  CharacterMark,
  CharDiff,
  MarkProvenance,
  MarkSuggestion,
  MarkTone,
  MeterTemplate,
  OrphanMark,
  PoemIssue,
  PoemVersion,
  PoemWorkspace,
  SuggestionBatch,
  SuggestionField,
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
const PUNCTUATION = new Set(['，', '。', '！', '？', '；', '：', '、', ' ', '\t', '…', '—', '「', '」', '『', '』', '（', '）']);
const TONE_DICTIONARY: Record<string, Tone> = {
  春: '平', 眠: '平', 不: '仄', 觉: '仄', 晓: '仄', 处: '仄', 闻: '平', 啼: '平', 鸟: '仄',
  夜: '仄', 来: '平', 风: '平', 雨: '仄', 声: '平', 花: '平', 落: '仄', 知: '平', 多: '平', 少: '仄',
  国: '仄', 破: '仄', 山: '平', 河: '平', 在: '仄', 城: '平', 深: '平', 木: '仄', 草: '仄', 独: '仄',
  明: '平', 月: '仄', 高: '平', 天: '平', 故: '仄', 乡: '平', 万: '仄', 里: '仄', 江: '平', 船: '平',
};

const clone = <T>(value: T): T => structuredClone(value);
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function cellKey(line: number, position: number): string {
  return `${line}:${position}`;
}

/** 去掉标点，只保留计律字符 */
export function lineChars(line: string): string[] {
  return Array.from(line).filter((char) => !PUNCTUATION.has(char));
}

export function buildCharIds(text: string): string[][] {
  return text.split('\n').map((line) => lineChars(line).map(() => uid('char')));
}

export function defaultMark(anchorChar = ''): CharacterMark {
  return { tone: '?', rhyme: '', pauseAfter: false, basis: '', note: '', anchorChar, origin: 'manual', history: [] };
}

/* ------------------------------------------------------------------ */
/* 正文增删对账：旧标注跟着原字走（LCS 对齐），对不上的摘出失效重算     */
/* ------------------------------------------------------------------ */

interface LcsOp {
  type: 'keep' | 'insert' | 'remove';
  oldIndex?: number;
  newIndex?: number;
}

function diffChars(oldChars: string[], newChars: string[]): LcsOp[] {
  const m = oldChars.length;
  const n = newChars.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = oldChars[i] === newChars[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: LcsOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldChars[i] === newChars[j]) {
      ops.push({ type: 'keep', oldIndex: i, newIndex: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'remove', oldIndex: i });
      i++;
    } else {
      ops.push({ type: 'insert', newIndex: j });
      j++;
    }
  }
  while (i < m) ops.push({ type: 'remove', oldIndex: i++ });
  while (j < n) ops.push({ type: 'insert', newIndex: j++ });
  return ops;
}

interface ReconcileResult {
  charIds: string[][];
  marks: Record<string, CharacterMark>;
  orphans: OrphanMark[];
  /** 受影响需要转待复核的旧句号 */
  affectedLines: Set<number>;
  /** 新增字位（待标） */
  inserted: { line: number; position: number; char: string }[];
}

/**
 * 按行做 LCS 对齐：相同原字的标注随字迁移到新字位（charId 不变）；
 * 改字/删字对不上的旧标注摘为 orphan 失效重算；新字留空待标。
 */
function reconcileText(version: PoemVersion, newText: string, now: string): ReconcileResult {
  const oldLines = version.text.split('\n');
  const newLines = newText.split('\n');
  const charIds: string[][] = [];
  const marks: Record<string, CharacterMark> = {};
  const orphans: OrphanMark[] = [];
  const affectedLines = new Set<number>();
  const inserted: ReconcileResult['inserted'] = [];

  const lineCount = Math.max(oldLines.length, newLines.length);
  for (let line = 0; line < lineCount; line++) {
    const oldChars = oldLines[line] ? lineChars(oldLines[line]) : [];
    const newChars = newLines[line] ? lineChars(newLines[line]) : [];
    const oldIds = version.charIds[line] ?? [];
    const rowIds: string[] = [];

    if (line >= oldLines.length) {
      // 整句新增：全部待标
      newChars.forEach((char, position) => {
        rowIds.push(uid('char'));
        inserted.push({ line, position, char });
      });
      affectedLines.add(line);
    } else if (line >= newLines.length) {
      // 整句删除：该句旧标注全部失效
      oldChars.forEach((char, position) => {
        const charId = oldIds[position];
        const mark = charId ? version.marks[charId] : undefined;
        if (charId && mark && markHasJudgement(mark)) {
          orphans.push(makeOrphan(version.id, line, position, char, mark, 'character-removed', now));
        }
      });
      affectedLines.add(line);
    } else {
      const ops = diffChars(oldChars, newChars);
      for (const op of ops) {
        if (op.type === 'keep') {
          const oldPosition = op.oldIndex!;
          const newPosition = op.newIndex!;
          const charId = oldIds[oldPosition] ?? uid('char');
          rowIds[newPosition] = charId;
          const mark = version.marks[charId];
          if (mark) {
            mark.anchorChar = newChars[newPosition];
            marks[charId] = mark;
          }
        } else if (op.type === 'insert') {
          const newPosition = op.newIndex!;
          rowIds[newPosition] = uid('char');
          inserted.push({ line, position: newPosition, char: newChars[newPosition] });
          affectedLines.add(line);
        } else {
          const oldPosition = op.oldIndex!;
          const charId = oldIds[oldPosition];
          const mark = charId ? version.marks[charId] : undefined;
          if (charId && mark && markHasJudgement(mark)) {
            orphans.push(makeOrphan(version.id, line, oldPosition, oldChars[oldPosition], mark, 'character-changed', now));
          }
          affectedLines.add(line);
        }
      }
    }
    charIds.push(rowIds);
  }
  return { charIds, marks, orphans, affectedLines, inserted };
}

function markHasJudgement(mark: CharacterMark): boolean {
  return mark.tone !== '?' || !!mark.rhyme || mark.pauseAfter || !!mark.basis || !!mark.note;
}

function makeOrphan(
  versionId: string,
  line: number,
  position: number,
  oldChar: string,
  mark: CharacterMark,
  reason: OrphanMark['reason'],
  now: string,
): OrphanMark {
  return { id: uid('orphan'), fromVersionId: versionId, oldLine: line, oldPosition: position, oldChar, mark: clone(mark), reason, detachedAt: now };
}

/* ------------------------------------------------------------------ */
/* 旧数据升级（schema v1 → v2）：既有标注按原字锚定，绝不串到别字        */
/* ------------------------------------------------------------------ */

interface LegacyWorkspace {
  title?: string;
  author?: string;
  templateId?: string;
  versions?: Array<{
    id?: string;
    name?: string;
    source?: string;
    createdAt?: string;
    text?: string;
    marks?: Record<string, CharacterMark | Record<string, unknown>>;
    antithesisPairs?: Array<{ id?: string; leftLine?: number; rightLine?: number; note?: string }>;
  }>;
  activeVersionId?: string;
}

function isLegacy(data: unknown): data is LegacyWorkspace {
  return !!data && typeof data === 'object' && (data as PoemWorkspace).schemaVersion !== 2 && Array.isArray((data as LegacyWorkspace).versions);
}

function upgradeLegacy(raw: LegacyWorkspace, now: string): PoemWorkspace {
  const versions: PoemVersion[] = (raw.versions ?? []).map((legacy, versionIndex) => {
    const text = legacy.text ?? '';
    const charIds = buildCharIds(text);
    const marks: Record<string, CharacterMark> = {};
    text.split('\n').forEach((lineText, line) => {
      lineChars(lineText).forEach((char, position) => {
        const legacyMark = legacy.marks?.[cellKey(line, position)] as CharacterMark | undefined;
        if (!legacyMark) return;
        const mark = normalizeMark(legacyMark, char);
        // 升级锚定：记录中只有旧键 “句:字”，原字一致才挂上；对不上的不串字
        if (markHasJudgement(mark)) {
          marks[charIds[line][position]] = mark;
        }
      });
    });
    const antithesisPairs: AntithesisPair[] = (legacy.antithesisPairs ?? []).map((pair) => ({
      id: pair.id ?? uid('pair'),
      leftLine: pair.leftLine ?? 0,
      rightLine: pair.rightLine ?? 1,
      note: pair.note ?? '',
      review: 'confirmed',
    }));
    return {
      id: legacy.id ?? `version-${versionIndex}`,
      name: legacy.name ?? `版本 ${versionIndex + 1}`,
      source: legacy.source ?? '',
      createdAt: legacy.createdAt ?? now,
      text,
      charIds,
      marks,
      antithesisPairs,
    };
  });
  return {
    schemaVersion: 2,
    title: raw.title ?? '无题',
    author: raw.author ?? '',
    templateId: raw.templateId ?? METER_TEMPLATES[0].id,
    versions,
    activeVersionId: raw.activeVersionId ?? versions[0]?.id ?? '',
    batches: [],
    orphans: [],
    updatedAt: now,
  };
}

function normalizeMark(input: Partial<CharacterMark>, anchorChar: string): CharacterMark {
  const tone = (input.tone === '平' || input.tone === '仄' || input.tone === '中' ? input.tone : '?') as MarkTone | '?';
  return {
    tone,
    rhyme: input.rhyme ?? '',
    pauseAfter: !!input.pauseAfter,
    basis: input.basis ?? '',
    note: input.note ?? '',
    anchorChar,
    origin: input.origin === 'suggestion' ? 'suggestion' : 'manual',
    history: Array.isArray(input.history) ? input.history.slice(-12) : [],
  };
}

/* ------------------------------------------------------------------ */
/* 初始工作区                                                          */
/* ------------------------------------------------------------------ */

function initialWorkspace(): PoemWorkspace {
  const now = new Date().toISOString();
  const spring = '春眠不觉晓，\n处处闻啼鸟。\n夜来风雨声，\n花落知多少。';

  const buildVersion = (id: string, name: string, source: string): PoemVersion => {
    const charIds = buildCharIds(spring);
    const marks: Record<string, CharacterMark> = {};
    const rhymeChars: Array<[string, number, string]> = [
      ['晓', 0, '上声十七筱'],
      ['鸟', 1, '上声十七筱'],
      ['声', 2, '下平八庚'],
      ['少', 3, '上声十七筱'],
    ];
    rhymeChars.forEach(([char, line, rhymeBasis]) => {
      marks[charIds[line][4]] = {
        ...defaultMark(char),
        tone: '平',
        rhyme: 'A',
        basis: `《平水韵》${rhymeBasis}`,
        note: `${char} 为韵脚`,
        history: [manualProvenance(`《平水韵》${rhymeBasis}`, now)],
      };
    });
    [0, 1, 2].forEach((line) => {
      marks[charIds[line][2]] = { ...defaultMark('闻'), tone: '平', basis: '平水韵', history: [manualProvenance('平水韵', now)] };
    });
    return { id, name, source, createdAt: now, text: spring, charIds, marks, antithesisPairs: [] };
  };

  return {
    schemaVersion: 2,
    title: '春晓',
    author: '孟浩然',
    templateId: 'wuyan-zeqi',
    versions: [
      buildVersion('version-main', '通行本 · 孟浩然集', '《孟浩然诗集笺注》'),
      buildVersion('version-song', '宋刻本异文', '宋蜀刻本'),
    ],
    activeVersionId: 'version-main',
    batches: [],
    orphans: [],
    updatedAt: now,
  };
}

function manualProvenance(basis: string, now: string, source = ''): MarkProvenance {
  return { origin: 'manual', source, basis, decidedAt: now };
}

function loadWorkspace(): PoemWorkspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return initialWorkspace();
    const parsed = JSON.parse(raw) as unknown;
    if (isLegacy(parsed)) return upgradeLegacy(parsed, new Date().toISOString());
    const workspace = parsed as PoemWorkspace;
    return workspace.versions?.length ? workspace : initialWorkspace();
  } catch {
    return initialWorkspace();
  }
}

/* ------------------------------------------------------------------ */
/* 建议字段值序列化                                                      */
/* ------------------------------------------------------------------ */

export function serializeField(field: SuggestionField, mark: CharacterMark): string {
  if (field === 'pauseAfter') return mark.pauseAfter ? 'true' : 'false';
  return mark[field];
}

export function fieldLabel(field: SuggestionField): string {
  return field === 'tone' ? '平仄' : field === 'rhyme' ? '韵组' : field === 'pauseAfter' ? '停顿' : field === 'basis' ? '依据' : '批注';
}

export function displayValue(field: SuggestionField, value: string): string {
  if (field === 'pauseAfter') return value === 'true' ? '此字后停顿' : '不停顿';
  if (field === 'tone' && value === '?') return '待定';
  return value === '' ? '（空）' : value;
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

@Injectable({ providedIn: 'root' })
export class PoetryStoreService {
  readonly workspace = signal<PoemWorkspace>(loadWorkspace());
  readonly selectedLine = signal(0);
  readonly selectedPosition = signal(4);
  readonly baselineVersionId = signal<string>('');
  readonly currentDiffIndex = signal(0);
  readonly toast = signal('');
  readonly undoCount = signal(0);
  readonly redoCount = signal(0);

  /** 当前正在裁决的批次 id（中断续裁） */
  readonly activeBatchId = signal<string | null>(null);

  private undoStack: PoemWorkspace[] = [];
  private redoStack: PoemWorkspace[] = [];
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  readonly activeVersion = computed(() => {
    const state = this.workspace();
    return state.versions.find((version) => version.id === state.activeVersionId) ?? state.versions[0];
  });

  readonly template = computed(() => METER_TEMPLATES.find((item) => item.id === this.workspace().templateId) ?? METER_TEMPLATES[0]);

  readonly lines = computed(() => this.activeVersion().text.split('\n'));

  /** 当前版本的待裁决批次 */
  readonly activeBatches = computed(() => {
    const versionId = this.activeVersion().id;
    return this.workspace().batches.filter((batch) => batch.versionId === versionId);
  });

  readonly activeBatch = computed(() => {
    const id = this.activeBatchId();
    const batches = this.activeBatches();
    return batches.find((batch) => batch.id === id) ?? null;
  });

  /** charId → 待裁决建议索引，供字格、对照、导出共用同一份进度 */
  private pendingByChar = computed(() => {
    const map = new Map<string, AnalysisCell['pendingSuggestions']>();
    for (const batch of this.workspace().batches) {
      for (const cell of batch.cells) {
        for (const item of cell.items) {
          if (item.status !== 'pending') continue;
          const list = map.get(cell.charId) ?? [];
          list.push({ batchId: batch.id, batchName: batch.name, item, cell });
          map.set(cell.charId, list);
        }
      }
    }
    return map;
  });

  readonly analysis = computed<AnalysisLine[]>(() => {
    const version = this.activeVersion();
    const template = this.template();
    const pending = this.pendingByChar();
    return this.lines().map((line, lineIndex) => {
      const chars = lineChars(line);
      const cells: AnalysisCell[] = chars.map((char, position) => {
        const charId = version.charIds[lineIndex]?.[position] ?? '';
        const mark = (charId && version.marks[charId]) || defaultMark(char);
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
        } else if (this.isAcceptableVariant(template, position)) {
          status = 'variant';
          message = '一三五位置的可接受变体';
        } else {
          status = 'error';
          message = `此处应为${expected}声`;
        }
        return { charId, char, position, expected, actual, status, message, mark, pendingSuggestions: charId ? pending.get(charId) ?? [] : [] };
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
        issues.push({ id: uid('issue'), level: 'warning', title: '存在未标注字', detail: `第 ${line.index + 1} 句仍有平仄未确认（新增字待标）。`, line: line.index });
      }
      line.cells
        .filter((cell) => cell.pendingSuggestions.length > 0)
        .forEach((cell) => {
          const conflicts = cell.pendingSuggestions.filter((entry) => this.isConflict(entry.item, cell.mark));
          if (conflicts.length) {
            issues.push({
              id: uid('issue'),
              level: 'warning',
              title: '手工判定与版本建议冲突',
              detail: `第 ${line.index + 1} 句“${cell.char}”有 ${conflicts.length} 条建议与现定不一致，两版并存待裁决。`,
              line: line.index,
              position: cell.position,
            });
          }
        });
    });
    const rhymeCells = template.rhymeLines.map((line) => analysis[line]?.cells.at(-1)).filter(Boolean);
    const rhymeGroups = new Map<string, string[]>();
    rhymeCells.forEach((cell, index) => {
      if (!cell?.mark.rhyme) {
        issues.push({ id: uid('issue'), level: 'warning', title: '韵脚缺少韵部', detail: `第 ${template.rhymeLines[index] + 1} 句末字尚未指定韵部。` });
        return;
      }
      rhymeGroups.set(cell.mark.rhyme, [...(rhymeGroups.get(cell.mark.rhyme) ?? []), cell.char]);
    });
    rhymeGroups.forEach((chars, rhyme) => {
      const duplicate = chars.find((char, index) => chars.indexOf(char) !== index);
      if (duplicate) issues.push({ id: uid('issue'), level: 'warning', title: '重复用韵', detail: `韵部 ${rhyme} 重复使用末字“${duplicate}”。` });
    });
    version.antithesisPairs
      .filter((pair) => pair.review === 'pending')
      .forEach((pair) => {
        issues.push({
          id: uid('issue'),
          level: 'warning',
          title: '对仗关系待复核',
          detail: `第 ${pair.leftLine + 1} 句 ↔ 第 ${pair.rightLine + 1} 句因正文增拆受影响，请复核后确认。`,
          line: pair.leftLine,
        });
      });
    this.workspace()
      .orphans.filter((orphan) => orphan.fromVersionId === version.id)
      .forEach((orphan) => {
        issues.push({
          id: orphan.id,
          level: 'warning',
          title: orphan.reason === 'character-removed' ? '旧标注因删字失效' : '旧标注因改字失效',
          detail: `原第 ${orphan.oldLine + 1} 句第 ${orphan.oldPosition + 1} 字“${orphan.oldChar}”的标注已摘出，需重算。`,
          line: orphan.oldLine,
        });
      });
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
    const pending = this.pendingByChar();
    const leftChars = Array.from(left.text.replace(/\n/g, ''));
    const rightChars = Array.from(right.text.replace(/\n/g, ''));
    const rightIds: string[] = [];
    right.charIds.forEach((row) => rightIds.push(...row));
    const size = Math.max(leftChars.length, rightChars.length);
    return Array.from({ length: size }, (_, index) => ({
      index,
      left: leftChars[index] ?? '',
      right: rightChars[index] ?? '',
      changed: leftChars[index] !== rightChars[index],
      rightCharId: rightIds[index],
      hasPending: rightIds[index] ? pending.has(rightIds[index]) : false,
    }));
  });

  readonly differences = computed(() => this.diff().filter((item) => item.changed).map((item) => item.index));
  readonly baselineVersion = computed(() => this.workspace().versions.find((version) => version.id === this.baselineVersionId()));

  /* ---------------- 基础编辑 ---------------- */

  selectVersion(id: string): void {
    this.workspace.update((workspace) => ({ ...workspace, activeVersionId: id }));
    const batch = this.workspace().batches.find((item) => item.id === this.activeBatchId() && item.versionId === id);
    if (!batch) this.activeBatchId.set(null);
    this.selectedLine.set(0);
    this.selectedPosition.set(0);
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
    if (text === this.activeVersion().text) return;
    const now = new Date().toISOString();
    this.commit((workspace) => {
      const version = this.versionIn(workspace);
      const result = reconcileText(version, text, now);
      version.text = text;
      version.charIds = result.charIds;
      version.marks = result.marks;
      // 受影响句上的对仗转待复核
      version.antithesisPairs.forEach((pair) => {
        if (result.affectedLines.has(pair.leftLine) || result.affectedLines.has(pair.rightLine)) {
          pair.review = 'pending';
        }
      });
      // 锚定原字已不存在的建议整字位作废
      const liveIds = new Set(result.charIds.flat());
      workspace.batches
        .filter((batch) => batch.versionId === version.id)
        .forEach((batch) => {
          batch.cells.forEach((cell) => {
            if (!liveIds.has(cell.charId)) {
              cell.items.forEach((item) => {
                if (item.status === 'pending') {
                  item.status = 'obsolete';
                  item.decidedAt = now;
                }
              });
            }
          });
        });
      workspace.orphans = [...result.orphans, ...workspace.orphans].slice(0, 200);
    });
    if (text !== this.activeVersion().text) this.flash('正文已更新：旧标注随原字迁移，对不上的已失效待重算');
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

  /** 手工改标注：与待裁建议冲突时两版并存，不改建议、不串来源 */
  setMark(patch: Partial<CharacterMark>): void {
    const now = new Date().toISOString();
    this.commit((workspace) => {
      const version = this.versionIn(workspace);
      const charId = version.charIds[this.selectedLine()]?.[this.selectedPosition()];
      if (!charId) return;
      const existing = version.marks[charId] ?? defaultMark(this.currentChar(version, this.selectedLine(), this.selectedPosition()));
      const next: CharacterMark = { ...existing, ...patch, anchorChar: existing.anchorChar, origin: 'manual' };
      next.history = [...existing.history, manualProvenance(patch.basis ?? existing.basis, now, version.source)].slice(-12);
      version.marks[charId] = next;
    });
  }

  private currentChar(version: PoemVersion, line: number, position: number): string {
    return lineChars(version.text.split('\n')[line] ?? '')[position] ?? '';
  }

  cycleTone(): void {
    const cell = this.selectedCell();
    const next: Record<Tone, MarkTone | '?'> = { '?': '平', 平: '仄', 仄: '中', 中: '?' };
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
      version.antithesisPairs.push({ id: uid('pair'), leftLine: Math.min(line, other), rightLine: Math.max(line, other), note: '结构相对，词性相应。', review: 'confirmed' });
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
      if (pair) pair.review = 'confirmed';
    });
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
    this.activeBatchId.set(null);
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

  /* ---------------- 失效标注重挂 ---------------- */

  /** 把失效标注重新挂到指定字位（原字核对通过才允许），并转为该字待标重算 */
  reattachOrphan(orphanId: string, line: number, position: number): void {
    this.commit((workspace) => {
      const version = this.versionIn(workspace);
      const orphan = workspace.orphans.find((item) => item.id === orphanId && item.fromVersionId === version.id);
      if (!orphan) return;
      const charId = version.charIds[line]?.[position];
      const char = charId ? this.currentChar(version, line, position) : '';
      if (!charId || char !== orphan.oldChar) return; // 不是同一个原字，绝不串挂
      const mark = clone(orphan.mark);
      mark.anchorChar = char;
      version.marks[charId] = mark;
      workspace.orphans = workspace.orphans.filter((item) => item.id !== orphanId);
    });
    this.flash('失效标注已按原字重挂，请复核重算');
  }

  discardOrphan(orphanId: string): void {
    this.commit((workspace) => {
      workspace.orphans = workspace.orphans.filter((item) => item.id !== orphanId);
    });
  }

  /* ---------------- 建议批次 ---------------- */

  /**
   * 依据新见刻本文本生成待裁决批次：只建建议，绝不改正文字格。
   * 平仄可由字书自动拟，其余字段以草稿形式留给校勘员在提交前微调。
   */
  previewBatchDraft(source: string, name: string, _note: string): { cells: CellSuggestion[]; conflicts: number } {
    const version = this.activeVersion();
    const sourceLines = source.split('\n');
    const cells: CellSuggestion[] = [];
    let conflicts = 0;
    version.text.split('\n').forEach((lineText, line) => {
      const chars = lineChars(lineText);
      const sourceChars = sourceLines[line] ? lineChars(sourceLines[line]) : chars;
      chars.forEach((char, position) => {
        const charId = version.charIds[line]?.[position];
        if (!charId) return;
        const mark = version.marks[charId] ?? defaultMark(char);
        const proposedTone = TONE_DICTIONARY[char] ?? mark.tone;
        const fields: Array<{ field: SuggestionField; value: string }> = [];
        // 仅在刻本能提供字音判断（字书命中或已有判定）时生成平仄建议
        if (proposedTone !== '?') fields.push({ field: 'tone', value: proposedTone });
        const items: MarkSuggestion[] = fields.map(({ field, value }) => {
          const currentValue = serializeField(field, mark);
          const conflict = currentValue !== value && !(field === 'tone' && currentValue === '?');
          if (conflict) conflicts++;
          return {
            id: uid('sug'),
            field,
            value,
            currentValue,
            conflict,
            reason: `${name}：据刻本用字拟${fieldLabel(field)}`,
            status: 'pending',
          };
        });
        // 刻本该字与当前不同，记录一条批注建议供参考，不改正文
        const sourceChar = sourceChars[position];
        if (sourceChar && sourceChar !== char) {
          items.push({
            id: uid('sug'),
            field: 'note',
            value: `${name}作“${sourceChar}”，今本从“${char}”。`,
            currentValue: mark.note,
            conflict: mark.note !== '' && mark.note !== `${name}作“${sourceChar}”，今本从“${char}”。`,
            reason: '异文出校',
            status: 'pending',
          });
          if (items[items.length - 1].conflict) conflicts++;
        }
        if (items.length) {
          cells.push({ id: uid('cell-sug'), charId, anchorChar: char, line, position, sourceName: name, items });
        }
      });
    });
    return { cells, conflicts };
  }

  createBatchFromDraft(source: string, name: string, note: string, cells: CellSuggestion[]): string {
    const version = this.activeVersion();
    const id = uid('batch');
    const batch: SuggestionBatch = {
      id,
      name: name || '新见刻本批次',
      source,
      note,
      versionId: version.id,
      createdAt: new Date().toISOString(),
      cells,
      cursorId: cells[0]?.id ?? null,
      suspended: false,
    };
    this.commit((workspace) => {
      workspace.batches.unshift(batch);
    });
    this.activeBatchId.set(id);
    this.flash('版本建议已进入待裁决批次，字格未改动');
    return id;
  }

  /** 便捷入口：按刻本文本直接生成平仄/异文批次 */
  importBatch(source: string, name: string, note: string): string {
    const draft = this.previewBatchDraft(source, name, note);
    return this.createBatchFromDraft(source, name, note, draft.cells);
  }

  selectBatch(id: string): void {
    const batch = this.workspace().batches.find((item) => item.id === id && item.versionId === this.activeVersion().id);
    if (!batch) return;
    // 切换即视为中断当前批次；目标批次从上次位置继续
    this.commit((workspace) => {
      workspace.batches.forEach((item) => {
        if (item.id === id) item.suspended = false;
      });
    });
    this.activeBatchId.set(id);
    this.jumpToCursor(id);
  }

  suspendBatch(): void {
    const id = this.activeBatchId();
    if (!id) return;
    this.commit((workspace) => {
      const batch = workspace.batches.find((item) => item.id === id);
      if (batch) batch.suspended = true;
    });
    this.flash('批次已中断，进度与位置已保留');
  }

  resumeBatch(id: string): void {
    this.selectBatch(id);
    this.flash('已从上次裁决位置继续');
  }

  removeBatch(id: string): void {
    this.commit((workspace) => {
      workspace.batches = workspace.batches.filter((item) => item.id !== id);
    });
    if (this.activeBatchId() === id) this.activeBatchId.set(null);
  }

  /** 编辑草稿（提交前对整段建议的逐字微调） */
  updateDraftItem(cells: CellSuggestion[], cellId: string, itemId: string, patch: Partial<MarkSuggestion>): CellSuggestion[] {
    return cells.map((cell) => {
      if (cell.id !== cellId) return cell;
      return { ...cell, items: cell.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)) };
    });
  }

  removeDraftItem(cells: CellSuggestion[], cellId: string, itemId: string): CellSuggestion[] {
    return cells
      .map((cell) => (cell.id === cellId ? { ...cell, items: cell.items.filter((item) => item.id !== itemId) } : cell))
      .filter((cell) => cell.items.length > 0);
  }

  addDraftField(cells: CellSuggestion[], cellId: string, field: SuggestionField, value: string): CellSuggestion[] {
    return cells.map((cell) => {
      if (cell.id !== cellId || cell.items.some((item) => item.field === field)) return cell;
      const version = this.activeVersion();
      const mark = version.marks[cell.charId] ?? defaultMark(cell.anchorChar);
      const currentValue = serializeField(field, mark);
      return {
        ...cell,
        items: [
          ...cell.items,
          {
            id: uid('sug'),
            field,
            value,
            currentValue,
            conflict: currentValue !== value,
            reason: '校勘员补拟',
            status: 'pending',
          },
        ],
      };
    });
  }

  /* ---------------- 单条/整字位裁决 ---------------- */

  /** 采纳单条建议：写入字格并保留来源；与手定冲突时以来源链留痕 */
  acceptSuggestion(batchId: string, cellId: string, itemId: string): void {
    const now = new Date().toISOString();
    this.commit((workspace) => {
      const batch = workspace.batches.find((item) => item.id === batchId);
      const cell = batch?.cells.find((entry) => entry.id === cellId);
      const sug = cell?.items.find((entry) => entry.id === itemId);
      if (!batch || !cell || !sug || sug.status !== 'pending') return;
      const version = workspace.versions.find((item) => item.id === batch.versionId);
      if (!version) return;
      const [line, position] = this.locateCharId(version, cell.charId);
      if (line < 0) {
        sug.status = 'obsolete';
        sug.decidedAt = now;
        return;
      }
      const existing = version.marks[cell.charId] ?? defaultMark(cell.anchorChar);
      const patch: Partial<CharacterMark> = {};
      if (sug.field === 'pauseAfter') patch.pauseAfter = sug.value === 'true';
      else patch[sug.field] = sug.value as never;
      const next: CharacterMark = { ...existing, ...patch, anchorChar: existing.anchorChar, origin: 'suggestion' };
      const provenance: MarkProvenance = {
        origin: 'suggestion',
        source: batch.name,
        suggestionId: sug.id,
        batchId: batch.id,
        basis: sug.reason,
        decidedAt: now,
      };
      next.history = [...existing.history, provenance].slice(-12);
      version.marks[cell.charId] = next;
      sug.status = 'accepted';
      sug.decidedAt = now;
      this.advanceCursor(batch, cellId);
    });
  }

  rejectSuggestion(batchId: string, cellId: string, itemId: string): void {
    const now = new Date().toISOString();
    this.commit((workspace) => {
      const batch = workspace.batches.find((item) => item.id === batchId);
      const cell = batch?.cells.find((entry) => entry.id === cellId);
      const sug = cell?.items.find((entry) => entry.id === itemId);
      if (!batch || !cell || !sug || sug.status !== 'pending') return;
      sug.status = 'rejected';
      sug.decidedAt = now;
      this.advanceCursor(batch, cellId);
    });
  }

  /** 采纳该字位全部建议；冲突字段也保留建议值（来源链可回溯手定旧版） */
  acceptCell(batchId: string, cellId: string): void {
    const batch = this.workspace().batches.find((item) => item.id === batchId);
    const cell = batch?.cells.find((entry) => entry.id === cellId);
    cell?.items.filter((item) => item.status === 'pending').forEach((item) => this.acceptSuggestion(batchId, cellId, item.id));
  }

  rejectCell(batchId: string, cellId: string): void {
    const batch = this.workspace().batches.find((item) => item.id === batchId);
    const cell = batch?.cells.find((entry) => entry.id === cellId);
    cell?.items.filter((item) => item.status === 'pending').forEach((item) => this.rejectSuggestion(batchId, cellId, item.id));
  }

  /** 冲突字位：保留两版——建议不入字格（手定不动），建议标记“并存留档”可随时再裁 */
  keepBoth(cellId: string): void {
    const now = new Date().toISOString();
    this.commit((workspace) => {
      const batch = workspace.batches.find((item) => item.cells.some((cell) => cell.id === cellId));
      const cell = batch?.cells.find((entry) => entry.id === cellId);
      if (!batch || !cell) return;
      cell.items.forEach((item) => {
        if (item.status === 'pending') {
          item.status = 'kept-both';
          item.reason = `${item.reason}（与手定冲突，两版并存）`;
          item.decidedAt = now;
        }
      });
      this.advanceCursor(batch, cellId);
    });
    this.flash('已保留两版：手定不动，建议留档，可在该字位撤回再裁');
  }

  /** 撤销一条已裁决建议，恢复为待裁决（字格不自动回滚） */
  reopenSuggestion(batchId: string, itemId: string): void {
    this.commit((workspace) => {
      const batch = workspace.batches.find((item) => item.id === batchId);
      if (!batch) return;
      batch.cells.forEach((cell) => {
        const sug = cell.items.find((item) => item.id === itemId);
        if (sug && (sug.status === 'accepted' || sug.status === 'rejected' || sug.status === 'kept-both')) {
          sug.status = 'pending';
          sug.decidedAt = undefined;
          if (!batch.cursorId) batch.cursorId = cell.id;
        }
      });
    });
  }

  batchProgress(batchId: string): BatchProgress {
    const batch = this.workspace().batches.find((item) => item.id === batchId);
    if (!batch) return { total: 0, pending: 0, accepted: 0, rejected: 0, keptBoth: 0, obsolete: 0, conflicts: 0, percent: 0 };
    const items = batch.cells.flatMap((cell) => cell.items);
    const version = this.workspace().versions.find((item) => item.id === batch.versionId);
    const count = (status: MarkSuggestion['status']) => items.filter((item) => item.status === status).length;
    let conflicts = 0;
    if (version) {
      batch.cells.forEach((cell) => {
        const mark = version.marks[cell.charId];
        cell.items.forEach((item) => {
          if (item.status === 'pending' && mark && this.isConflict(item, mark)) conflicts++;
        });
      });
    }
    const accepted = count('accepted');
    const rejected = count('rejected');
    const keptBoth = count('kept-both');
    const obsolete = count('obsolete');
    const decided = accepted + rejected + keptBoth + obsolete;
    return {
      total: items.length,
      pending: count('pending'),
      accepted,
      rejected,
      keptBoth,
      obsolete,
      conflicts,
      percent: items.length ? Math.round((decided / items.length) * 100) : 100,
    };
  }

  isConflict(item: MarkSuggestion, mark: CharacterMark): boolean {
    const current = serializeField(item.field, mark);
    if (item.field === 'tone' && current === '?') return false; // 未标字不算冲突
    return current !== item.value;
  }

  private advanceCursor(batch: SuggestionBatch, decidedCellId: string): void {
    const cell = batch.cells.find((entry) => entry.id === decidedCellId);
    if (cell && cell.items.some((item) => item.status === 'pending')) return; // 本字位还有未裁字段
    const next = batch.cells.find((entry) => entry.items.some((item) => item.status === 'pending'));
    batch.cursorId = next?.id ?? null;
    if (!next) batch.suspended = false;
    if (next) {
      const version = this.workspace().versions.find((item) => item.id === batch.versionId);
      if (version) {
        const [line, position] = this.locateCharId(version, next.charId);
        if (line >= 0) {
          this.selectedLine.set(line);
          this.selectedPosition.set(position);
        }
      }
    }
  }

  private jumpToCursor(batchId: string): void {
    const batch = this.workspace().batches.find((item) => item.id === batchId);
    const version = this.workspace().versions.find((item) => item.id === batch?.versionId);
    if (!batch || !version) return;
    const target = batch.cells.find((cell) => cell.id === batch.cursorId) ?? batch.cells.find((cell) => cell.items.some((item) => item.status === 'pending'));
    if (!target) return;
    const [line, position] = this.locateCharId(version, target.charId);
    if (line >= 0) this.selectCell(line, position);
  }

  private locateCharId(version: PoemVersion, charId: string): [number, number] {
    for (let line = 0; line < version.charIds.length; line++) {
      const position = version.charIds[line].indexOf(charId);
      if (position >= 0) return [line, position];
    }
    return [-1, -1];
  }

  /* ---------------- 撤销/重做 ---------------- */

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

  /* ---------------- 导出（同一份裁决进度） ---------------- */

  exportProofreadCopy(): string {
    const workspace = this.workspace();
    const active = this.activeVersion();
    const lines = this.analysis().map((line) => {
      const tags = line.cells
        .map((cell) => {
          const tone = `${cell.char}${cell.actual === '?' ? '□' : `(${cell.actual})`}`;
          const origin = cell.mark.origin === 'suggestion' ? '*' : '';
          const pending = cell.pendingSuggestions.length ? '〔待裁〕' : '';
          return `${tone}${origin}${pending}`;
        })
        .join(' ');
      return `第 ${line.index + 1} 句：${tags}`;
    });
    const notes = this.issues().map((issue) => `[${issue.level.toUpperCase()}] ${issue.title}：${issue.detail}`);

    const batchSections: string[] = [];
    workspace.batches
      .filter((batch) => batch.versionId === active.id)
      .forEach((batch) => {
        const progress = this.batchProgress(batch.id);
        batchSections.push(`### 批次：${batch.name}（${batch.source}）`, '', `- 裁决进度：${progress.percent}%（采纳 ${progress.accepted} / 存弃 ${progress.rejected} / 两版并存 ${progress.keptBoth} / 待裁 ${progress.pending} / 作废 ${progress.obsolete}）`, `- 状态：${batch.suspended ? '中断，停于上次位置' : '进行中或已完成'}`, '');
        batch.cells.forEach((cell) => {
          const decided = cell.items
            .map((item) => {
              const verdict = item.status === 'accepted' ? '采纳' : item.status === 'rejected' ? '存弃' : item.status === 'kept-both' ? '两版并存' : item.status === 'obsolete' ? '作废' : '待裁';
              return `${fieldLabel(item.field)}「${displayValue(item.field, item.value)}」${verdict}`;
            })
            .join('；');
          batchSections.push(`- 第 ${cell.line + 1} 句第 ${cell.position + 1} 字“${cell.anchorChar}”：${decided}`);
        });
        batchSections.push('');
      });

    const orphanLines = workspace.orphans
      .filter((orphan) => orphan.fromVersionId === active.id)
      .map((orphan) => `- 原第 ${orphan.oldLine + 1} 句第 ${orphan.oldPosition + 1} 字“${orphan.oldChar}”：${orphan.reason === 'character-removed' ? '删字' : '改字'}失效，平仄 ${orphan.mark.tone}、韵组 ${orphan.mark.rhyme || '—'}，待重算`);

    const pairLines = active.antithesisPairs.map(
      (pair) => `- 第 ${pair.leftLine + 1} 句 ↔ 第 ${pair.rightLine + 1} 句：${pair.review === 'pending' ? '【待复核】' : '已确认'} ${pair.note}`,
    );

    return [
      `# ${workspace.title} · 格律校对稿`,
      '',
      `底本：${active.name}`,
      `出处：${active.source}`,
      `导出于：${new Date().toISOString()}`,
      '',
      '## 字音标注',
      ...lines,
      '',
      '> 带 * 者为采纳版本建议写入，〔待裁〕表示该字仍有未决建议。',
      '',
      '## 检查记录',
      ...notes,
      '',
      '## 版本建议裁决进度',
      ...(batchSections.length ? batchSections : ['暂无待裁决批次。']),
      '## 失效标注',
      ...(orphanLines.length ? orphanLines : ['无。']),
      '',
      '## 对仗关系',
      ...(pairLines.length ? pairLines : ['无。']),
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

  /* ---------------- 内部 ---------------- */

  private flash(message: string): void {
    this.toast.set(message);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(''), 2600);
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
    return workspace.versions.find((item) => item.id === workspace.activeVersionId) ?? workspace.versions[0];
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.workspace()));
    } catch {
      // 存储满或被禁用时忽略，本次会话内仍可继续
    }
  }

  private isAcceptableVariant(template: MeterTemplate, position: number): boolean {
    if (template.lineLength === 5) return position === 0 || position === 2;
    return position === 0 || position === 2 || position === 4;
  }
}
