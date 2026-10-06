export type Tone = '平' | '仄' | '中' | '?';
export type MarkTone = '平' | '仄' | '中';

export interface CharacterMark {
  tone: MarkTone | '?';
  rhyme: string;
  pauseAfter: boolean;
  basis: string;
  note: string;
  /** 标注来源：手工校定或采纳的建议批次名 */
  origin: string;
}

export interface PoemVersion {
  id: string;
  name: string;
  source: string;
  createdAt: string;
  text: string;
  /** 每句每个计律字的稳定字符 ID，marks 以其为键，保证正文增删后标注跟着原字走 */
  charIds: string[][];
  marks: Record<string, CharacterMark>;
  /** 正文增删后未能对应回原字的旧标注，先失效待重算 */
  invalidated: InvalidatedMark[];
  antithesisPairs: AntithesisPair[];
}

export interface InvalidatedMark {
  id: string;
  char: string;
  line: number;
  position: number;
  mark: CharacterMark;
  reason: string;
}

export interface AntithesisPair {
  id: string;
  leftLine: number;
  rightLine: number;
  note: string;
  /** 正文增删波及到相关句时转为 review，待人工复核 */
  status: 'active' | 'review';
}

export type SuggestionStatus = 'pending' | 'adopted' | 'rejected' | 'matched' | 'obsolete';

export interface SuggestionItem {
  id: string;
  /** 目标字符的稳定 ID，正文再改也能找回原字 */
  charId: string;
  char: string;
  line: number;
  position: number;
  suggestedTone: MarkTone | '';
  suggestedRhyme: string;
  /** 导入时的手定快照，与建议冲突时两版并存 */
  manual: CharacterMark;
  conflict: boolean;
  status: SuggestionStatus;
}

export interface SuggestionBatch {
  id: string;
  name: string;
  source: string;
  createdAt: string;
  versionId: string;
  items: SuggestionItem[];
  /** 裁决游标：中断后从上次位置继续 */
  cursor: number;
}

export interface PoemWorkspace {
  title: string;
  author: string;
  templateId: string;
  versions: PoemVersion[];
  activeVersionId: string;
  batches: SuggestionBatch[];
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
  char: string;
  position: number;
  expected: Tone;
  actual: Tone;
  status: 'correct' | 'variant' | 'error' | 'unknown' | 'neutral';
  message: string;
  mark: CharacterMark;
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
}

export interface AdjudicationProgress {
  total: number;
  decided: number;
  adopted: number;
  rejected: number;
  matched: number;
  pending: number;
  percent: number;
}
