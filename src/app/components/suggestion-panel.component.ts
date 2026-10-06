import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzBadgeModule } from 'ng-zorro-antd/badge';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDividerModule } from 'ng-zorro-antd/divider';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { displayValue, fieldLabel, PoetryStoreService } from '../services/poetry-store.service';
import type { CellSuggestion, MarkSuggestion, SuggestionField, SuggestionBatch } from '../models/poem.models';

type DraftCell = CellSuggestion;

@Component({
  selector: 'app-suggestion-panel',
  imports: [
    CommonModule,
    FormsModule,
    NzAlertModule,
    NzBadgeModule,
    NzButtonModule,
    NzDividerModule,
    NzEmptyModule,
    NzInputModule,
    NzProgressModule,
    NzSelectModule,
    NzTagModule,
    NzToolTipModule,
  ],
  templateUrl: './suggestion-panel.component.html',
  styleUrl: './suggestion-panel.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuggestionPanelComponent {
  readonly store = inject(PoetryStoreService);
  readonly fieldLabel = fieldLabel;
  readonly displayValue = displayValue;

  // 导入草稿
  draftName = '新见刻本批注';
  draftSource = '';
  draftNote = '';
  draftText = '';
  readonly draftCells = signal<DraftCell[] | null>(null);
  readonly draftConflicts = signal(0);

  readonly fieldOptions: SuggestionField[] = ['rhyme', 'pauseAfter', 'basis', 'note'];

  readonly batches = computed(() => this.store.activeBatches());
  readonly activeBatch = computed(() => this.store.activeBatch());

  /** 光标所在字位（中断续裁位置） */
  readonly cursorCell = computed(() => {
    const batch = this.activeBatch();
    if (!batch) return null;
    return batch.cells.find((cell) => cell.id === batch.cursorId) ?? batch.cells.find((cell) => cell.items.some((item) => item.status === 'pending')) ?? null;
  });

  /** 当前激活版本的实时字格，用于逐字对照现值 */
  private markByCharId = computed(() => {
    const map = new Map<string, { char: string; line: number; position: number }>();
    const version = this.store.activeVersion();
    version.text.split('\n').forEach((lineText, line) => {
      Array.from(lineText)
        .filter((char) => !/[，。！？；：、\s]/.test(char))
        .forEach((char, position) => {
          const id = version.charIds[line]?.[position];
          if (id) map.set(id, { char, line, position });
        });
    });
    return map;
  });

  cellLocation(cell: CellSuggestion): { char: string; line: number; position: number } | null {
    return this.markByCharId().get(cell.charId) ?? { char: cell.anchorChar, line: cell.line, position: cell.position };
  }

  currentMarkValue(cell: CellSuggestion, field: SuggestionField): string {
    const version = this.store.activeVersion();
    const mark = version.marks[cell.charId];
    if (!mark) return field === 'pauseAfter' ? 'false' : '';
    if (field === 'pauseAfter') return mark.pauseAfter ? 'true' : 'false';
    return mark[field];
  }

  isLiveConflict(cell: CellSuggestion, item: MarkSuggestion): boolean {
    const version = this.store.activeVersion();
    const mark = version.marks[cell.charId];
    if (!mark) return false;
    return this.store.isConflict(item, mark);
  }

  preview(): void {
    const name = this.draftName.trim() || '新见刻本批次';
    const draft = this.store.previewBatchDraft(this.draftText || this.store.activeVersion().text, name, this.draftNote);
    this.draftCells.set(draft.cells);
    this.draftConflicts.set(draft.conflicts);
  }

  editDraftValue(cellId: string, itemId: string, value: string): void {
    const draft = this.draftCells();
    if (!draft) return;
    this.draftCells.set(this.store.updateDraftItem(draft, cellId, itemId, { value, conflict: false }));
  }

  removeDraftItem(cellId: string, itemId: string): void {
    const draft = this.draftCells();
    if (!draft) return;
    this.draftCells.set(this.store.removeDraftItem(draft, cellId, itemId));
  }

  hasField(cell: CellSuggestion, field: SuggestionField): boolean {
    return cell.items.some((item) => item.field === field);
  }

  addField(cellId: string, field: SuggestionField): void {
    const draft = this.draftCells();
    if (!draft) return;
    const value = field === 'pauseAfter' ? 'true' : '';
    this.draftCells.set(this.store.addDraftField(draft, cellId, field, value));
  }

  commitDraft(): void {
    const cells = this.draftCells();
    if (!cells || !cells.length) return;
    const name = this.draftName.trim() || '新见刻本批次';
    this.store.createBatchFromDraft(this.draftSource, name, this.draftNote, cells);
    this.draftCells.set(null);
  }

  cancelDraft(): void {
    this.draftCells.set(null);
  }

  selectBatch(batch: SuggestionBatch): void {
    this.store.selectBatch(batch.id);
  }

  progress(batch: SuggestionBatch) {
    return this.store.batchProgress(batch.id);
  }

  accept(batch: SuggestionBatch, cell: CellSuggestion, item: MarkSuggestion): void {
    this.store.acceptSuggestion(batch.id, cell.id, item.id);
  }

  reject(batch: SuggestionBatch, cell: CellSuggestion, item: MarkSuggestion): void {
    this.store.rejectSuggestion(batch.id, cell.id, item.id);
  }

  acceptAll(batch: SuggestionBatch, cell: CellSuggestion): void {
    this.store.acceptCell(batch.id, cell.id);
  }

  rejectAll(batch: SuggestionBatch, cell: CellSuggestion): void {
    this.store.rejectCell(batch.id, cell.id);
  }

  keepBoth(cell: CellSuggestion): void {
    this.store.keepBoth(cell.id);
  }

  reopen(batch: SuggestionBatch, item: MarkSuggestion): void {
    this.store.reopenSuggestion(batch.id, item.id);
  }

  focusCell(cell: CellSuggestion): void {
    const location = this.cellLocation(cell);
    if (location) this.store.selectCell(location.line, location.position);
  }

  pendingItems(cell: CellSuggestion): MarkSuggestion[] {
    return cell.items.filter((item) => item.status === 'pending');
  }

  decidedItems(cell: CellSuggestion): MarkSuggestion[] {
    return cell.items.filter((item) => item.status !== 'pending');
  }

  batchCellCount(batch: SuggestionBatch): number {
    return batch.cells.filter((cell) => cell.items.some((item) => item.status === 'pending')).length;
  }
}
