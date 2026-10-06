export type Tone = '平' | '仄' | '中' | '?';
export type MarkTone = '平' | '仄' | '中';

/** 标注的判定来源 */
export type MarkOrigin = 'manual' | 'suggestion';

/** 单条标注的完整来源链，采纳建议后也保留手工痕迹 */
export interface MarkProvenance {
  origin: MarkOrigin;
  /** 来源版本/刻本名称，手工标注可为空 */
  source: string;
  /** 采纳自哪一条建议（suggestion id） */
  suggestionId?: string;
  /** 来自哪个批次 */
  batchId?: string;
  /** 判定依据原文 */
  basis: string;
  decidedAt: string;
}

export interface CharacterMark {
  tone: MarkTone | '?';
  rhyme: string;
  pauseAfter: boolean;
  basis: string;
  note: string;
  /** 该标注锚定的原字，正文增删后用于核对；不一致即失效 */
  anchorChar: string;
  /** 最近一次判定来源；历史见 history */
  origin: MarkOrigin;
  history: MarkProvenance[];
}

/** 正文增删后对不上原字、已从字格摘除的失效标注 */
export interface OrphanMark {
  id: string;
  fromVersionId: string;
  oldLine: number;
  oldPosition: number;
  oldChar: string;
  mark: CharacterMark;
  reason: 'character-changed' | 'character-removed';
  detachedAt: string;
}

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'kept-both' | 'obsolete';
export type SuggestionField = 'tone' | 'rhyme' | 'pauseAfter' | 'basis' | 'note';

export interface MarkSuggestion {
  id: string;
  /** 建议作用的字段 */
  field: SuggestionField;
  /** 建议值（pauseAfter 等布尔字段序列化后还原） */
  value: string;
  /** 生成建议时该字位的现值，便于逐字对照 */
  currentValue: string;
  /** 与当前手工判定是否冲突（生成时快照，列表中另做实时复核） */
  conflict: boolean;
  /** 建议附带的依据说明 */
  reason: string;
  status: SuggestionStatus;
  decidedAt?: string;
}

/** 字位上的整段版本建议：一个字一条容器，内含分字段建议 */
export interface CellSuggestion {
  id: string;
  /** 锚定稳定字位 id */
  charId: string;
  /** 生成时锚定的字，用于失效判断 */
  anchorChar: string;
  /** 第几句第几字（仅展示用） */
  line: number;
  position: number;
  sourceName: string;
  items: MarkSuggestion[];
}

export interface SuggestionBatch {
  id: string;
  name: string;
  source: string;
  note: string;
  versionId: string;
  createdAt: string;
  /** 逐字建议 */
  cells: CellSuggestion[];
  /** 中断后续裁：当前进行到的 cellSuggestion id */
  cursorId: string | null;
  /** 批次是否被中断挂起 */
  suspended: boolean;
}

export interface PoemVersion {
  id: string;
  name: string;
  source: string;
  createdAt: string;
  text: string;
  /** 与 text 逐句对应的稳定字位 id（仅含不计标点的汉字） */
  charIds: string[][];
  marks: Record<string, CharacterMark>;
  antithesisPairs: AntithesisPair[];
}

export interface AntithesisPair {
  id: string;
  leftLine: number;
  rightLine: number;
  note: string;
  /** 受正文增删影响后转待复核 */
  review: 'confirmed' | 'pending';
}

export interface PoemWorkspace {
  schemaVersion: 2;
  title: string;
  author: string;
  templateId: string;
  versions: PoemVersion[];
  activeVersionId: string;
  batches: SuggestionBatch[];
  orphans: OrphanMark[];
  updatedAt: string;
}

export interface MeterTemplate {
  id: string;
  name: string;
  summary: string;
  lineCount: number;
  lineLength: number;
  pattern: Tone[];
  rhymeLines: number[];
}

export interface AnalysisCell {
  charId: string;
  char: string;
  position: number;
  expected: Tone;
  actual: Tone;
  status: 'correct' | 'variant' | 'error' | 'unknown' | 'neutral';
  message: string;
  mark: CharacterMark;
  /** 该字位上待裁决的建议（跨批次） */
  pendingSuggestions: { batchId: string; batchName: string; item: MarkSuggestion; cell: CellSuggestion }[];
}

export interface AnalysisLine {
  index: number;
  cells: AnalysisCell[];
  rhymeChars: string[];
  errors: number;
  variants: number;
}

export interface PoemIssue {
  id: string;
  level: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  line?: number;
  position?: number;
}

export interface CharDiff {
  index: number;
  left: string;
  right: string;
  changed: boolean;
  /** 右侧当前版本对应的稳定字位 id，用于显示同一份裁决进度 */
  rightCharId?: string;
  /** 该字位是否有待裁决建议 */
  hasPending?: boolean;
}

/** 批次裁决进度统计 */
export interface BatchProgress {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  keptBoth: number;
  obsolete: number;
  conflicts: number;
  percent: number;
}
