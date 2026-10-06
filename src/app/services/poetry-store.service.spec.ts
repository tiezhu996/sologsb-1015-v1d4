import { cellKey, lineChars, PoetryStoreService, serializeField } from './poetry-store.service';

function freshStore(): PoetryStoreService {
  localStorage.clear();
  return new PoetryStoreService();
}

describe('PoetryStoreService · 版本建议裁决工作流', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('初始：字格有手定标注，批次为空', () => {
    const store = freshStore();
    const version = store.activeVersion();
    expect(version.charIds.length).toBe(4);
    expect(version.charIds[0].length).toBe(5);
    expect(version.marks[version.charIds[0][4]].tone).toBe('平');
    expect(store.activeBatches().length).toBe(0);
  });

  it('导入批次：只生成建议，不改字格，且逐字锚定', () => {
    const store = freshStore();
    const before = store.activeVersion().marks;
    const batchId = store.importBatch(store.activeVersion().text, '明刻本', '测试来源');
    const batch = store.activeBatches()[0];
    expect(batch.id).toBe(batchId);
    expect(batch.cells.length).toBeGreaterThan(0);
    // 字格未被建议改动
    expect(store.activeVersion().marks).toEqual(before);
    // 每条建议都锚到稳定 charId
    batch.cells.forEach((cell) => expect(cell.charId).toMatch(/^char-/));
    // 进入待裁，光标在第一字位
    expect(store.activeBatchId()).toBe(batchId);
    expect(batch.cursorId).toBe(batch.cells[0].id);
  });

  it('采纳后才写入字格并留下来源；未采纳前两版并存', () => {
    const store = freshStore();
    // 手定第 1 句第 1 字为仄（春=平，制造冲突）
    store.selectCell(0, 0);
    store.setMark({ tone: '仄', basis: '手定依据' });
    const charId = store.activeVersion().charIds[0][0];
    expect(store.activeVersion().marks[charId].tone).toBe('仄');

    const batchId = store.importBatch(store.activeVersion().text, '刻本', '来源');
    const batch = store.activeBatches()[0];
    const cell = batch.cells.find((item) => item.charId === charId)!;
    const toneSug = cell.items.find((item) => item.field === 'tone')!;
    // 建议为平，与手定仄冲突；此时字格仍是仄
    expect(toneSug.value).toBe('平');
    expect(store.isConflict(toneSug, store.activeVersion().marks[charId])).toBeTrue();
    expect(store.activeVersion().marks[charId].tone).toBe('仄');

    store.acceptSuggestion(batchId, cell.id, toneSug.id);
    const mark = store.activeVersion().marks[charId];
    expect(mark.tone).toBe('平');
    expect(mark.origin).toBe('suggestion');
    const adopted = mark.history.find((entry) => entry.origin === 'suggestion');
    expect(adopted?.source).toBe('刻本');
    expect(adopted?.suggestionId).toBe(toneSug.id);
    // 手定记录仍在来源链中
    expect(mark.history.some((entry) => entry.origin === 'manual')).toBeTrue();
  });

  it('否决建议不改动字格', () => {
    const store = freshStore();
    store.selectCell(0, 0);
    store.setMark({ tone: '仄' });
    const charId = store.activeVersion().charIds[0][0];
    const batchId = store.importBatch(store.activeVersion().text, '刻本', '');
    const cell = store.activeBatches()[0].cells.find((item) => item.charId === charId)!;
    const sug = cell.items.find((item) => item.field === 'tone')!;
    store.rejectSuggestion(batchId, cell.id, sug.id);
    expect(store.activeVersion().marks[charId].tone).toBe('仄');
    expect(sug.status).toBe('rejected');
  });

  it('中断批次后从上次字位继续', () => {
    const store = freshStore();
    const batchId = store.importBatch(store.activeVersion().text, '刻本', '');
    const batch = store.activeBatches()[0];
    // 裁掉第一个字位全部建议
    store.acceptCell(batchId, batch.cells[0].id);
    const savedCursor = store.activeBatches()[0].cursorId;
    expect(savedCursor).toBe(batch.cells[1].id);
    store.suspendBatch();
    expect(store.activeBatches()[0].suspended).toBeTrue();
    // 模拟离开：清活动批次后恢复
    store.selectVersion(store.activeVersion().id);
    store.resumeBatch(batchId);
    expect(store.activeBatchId()).toBe(batchId);
    const [line, position] = [store.selectedLine(), store.selectedPosition()];
    expect(line).toBe(batch.cells[1].line);
    expect(position).toBe(batch.cells[1].position);
  });

  it('整句进度在字格分析、异文对照中同源可见', () => {
    const store = freshStore();
    store.importBatch(store.activeVersion().text, '刻本', '');
    const pendingChars = new Set(store.analysis().flatMap((line) => line.cells.filter((cell) => cell.pendingSuggestions.length > 0).map((cell) => cell.charId)));
    expect(pendingChars.size).toBeGreaterThan(0);
    // 设底本为第二版本后，异文对照携带待裁标记
    store.duplicateActiveAsBaseline();
    // 手工构造另一版本底本场景：直接选另一个版本
    store.selectVersion(store.workspace().versions[1].id);
    store.baselineVersionId.set(store.workspace().versions[0].id);
    expect(store.diff().some((item) => item.rightCharId)).toBeTrue();
  });
});

describe('PoetryStoreService · 正文增删对账', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('改字：旧标注失效摘出，新字待标，且不串到别字', () => {
    const store = freshStore();
    const version = store.activeVersion();
    // 给“春”加手定标注
    const chunId = version.charIds[0][0];
    store.selectCell(0, 0);
    store.setMark({ tone: '平', basis: '春证' });
    expect(store.activeVersion().marks[chunId].basis).toBe('春证');

    // 把“春”改成“东”
    const text = store.activeVersion().text.replace('春眠', '冬眠');
    store.updateText(text);
    const next = store.activeVersion();
    const dongId = next.charIds[0][0];
    // 新字位是全新 id 且无旧标注（待标）
    expect(dongId).not.toBe(chunId);
    expect(next.marks[dongId]).toBeUndefined();
    // 旧标注进 orphan
    const orphan = store.workspace().orphans.find((item) => item.oldChar === '春');
    expect(orphan).toBeTruthy();
    expect(orphan!.mark.basis).toBe('春证');
    expect(orphan!.reason).toBe('character-changed');
  });

  it('未改的字：标注随原字迁移到新位置（charId 不变）', () => {
    const store = freshStore();
    // 在“眠”（0句1位）加标注
    store.selectCell(0, 1);
    store.setMark({ tone: '平', basis: '眠证' });
    const mianId = store.activeVersion().charIds[0][1];
    // 句首插入一个字：春X眠…
    const text = store.activeVersion().text.replace('春眠', '春醉眠');
    store.updateText(text);
    const next = store.activeVersion();
    // “眠”后移到第 3 位，charId 不变，标注随迁
    expect(next.charIds[0][2]).toBe(mianId);
    expect(next.marks[mianId].basis).toBe('眠证');
  });

  it('删字：失效标注重挂时只允许同原字', () => {
    const store = freshStore();
    store.selectCell(0, 0);
    store.setMark({ tone: '平', basis: '春证' });
    // 删掉“春”
    store.updateText(store.activeVersion().text.replace('春眠', '眠'));
    const orphan = store.workspace().orphans.find((item) => item.oldChar === '春')!;
    expect(orphan.reason).toBe('character-removed');
    // 当前正文没有“春”，无可重挂目标
    const targets = store
      .analysis()
      .flatMap((line) => line.cells)
      .filter((cell) => cell.char === '春');
    expect(targets.length).toBe(0);
    // 把“春”加回到另一个位置，重挂成功且标注不串字
    store.updateText(store.activeVersion().text.replace('眠不觉', '春眠不觉'));
    const candidate = store.activeVersion();
    const charId = candidate.charIds[0][0];
    expect(candidate.marks[charId]).toBeUndefined();
    store.reattachOrphan(orphan.id, 0, 0);
    expect(store.activeVersion().marks[charId].basis).toBe('春证');
  });

  it('增删正文后受影响句上的对仗转待复核', () => {
    const store = freshStore();
    store.selectCell(0, 0);
    store.addAntithesis(); // 0 ↔ 1
    expect(store.activeVersion().antithesisPairs[0].review).toBe('confirmed');
    store.updateText(store.activeVersion().text.replace('春眠', '春醉眠'));
    expect(store.activeVersion().antithesisPairs[0].review).toBe('pending');
    store.confirmAntithesis(store.activeVersion().antithesisPairs[0].id);
    expect(store.activeVersion().antithesisPairs[0].review).toBe('confirmed');
  });

  it('正文改字后，锚定该字的待裁建议自动作废', () => {
    const store = freshStore();
    const batchId = store.importBatch(store.activeVersion().text, '刻本', '');
    expect(store.workspace().batches.find((item) => item.id === batchId)!.cells[0].items.every((item) => item.status === 'pending')).toBeTrue();
    store.updateText(store.activeVersion().text.replace('春', '冬'));
    const cell = store.workspace().batches.find((item) => item.id === batchId)!.cells[0];
    expect(cell.items.every((item) => item.status === 'obsolete')).toBeTrue();
  });

  it('冲突时保留两版：字格维持手定，建议标记并存且可撤回', () => {
    const store = freshStore();
    store.selectCell(0, 0);
    store.setMark({ tone: '仄' });
    const charId = store.activeVersion().charIds[0][0];
    const batchId = store.importBatch(store.activeVersion().text, '刻本', '');
    const cell = store.workspace().batches.find((item) => item.id === batchId)!.cells.find((item) => item.charId === charId)!;
    const sug = cell.items.find((item) => item.field === 'tone')!;
    store.keepBoth(cell.id);
    expect(store.activeVersion().marks[charId].tone).toBe('仄');
    const kept = store.workspace().batches.find((item) => item.id === batchId)!.cells.flatMap((item) => item.items).find((item) => item.id === sug.id)!;
    expect(kept.status).toBe('kept-both');
    store.reopenSuggestion(batchId, sug.id);
    expect(store.workspace().batches.find((item) => item.id === batchId)!.cells.flatMap((item) => item.items).find((item) => item.id === sug.id)!.status).toBe('pending');
  });
});

describe('旧数据 v1 升级', () => {
  it('旧键值标注按原字锚定，既有标注不串到别字', () => {
    const v1 = {
      title: '旧稿',
      author: '作者',
      templateId: 'wuyan-zeqi',
      activeVersionId: 'v1',
      updatedAt: new Date().toISOString(),
      versions: [
        {
          id: 'v1',
          name: '旧版本',
          source: '旧来源',
          createdAt: new Date().toISOString(),
          text: '春眠不觉晓，\n处处闻啼鸟。',
          marks: {
            [cellKey(0, 0)]: { tone: '平', rhyme: '', pauseAfter: false, basis: '春字旧证', note: '' },
            [cellKey(1, 0)]: { tone: '仄', rhyme: '', pauseAfter: false, basis: '处字旧证', note: '' },
          },
          antithesisPairs: [],
        },
      ],
    };
    localStorage.setItem('sologsb-1015-poetry-workspace-v1', JSON.stringify(v1));
    const store = new PoetryStoreService();
    const version = store.activeVersion();
    expect(version.charIds[0].length).toBe(5);
    const firstId = version.charIds[0][0];
    const secondLineFirstId = version.charIds[1][0];
    expect(version.marks[firstId].basis).toBe('春字旧证');
    expect(version.marks[secondLineFirstId].basis).toBe('处字旧证');
    expect(store.workspace().schemaVersion).toBe(2);
  });
});

describe('工具函数', () => {
  it('lineChars 去除标点与空白', () => {
    expect(lineChars('春眠不觉晓， ')).toEqual(['春', '眠', '不', '觉', '晓']);
  });

  it('serializeField 处理布尔停顿', () => {
    expect(serializeField('pauseAfter', { pauseAfter: true } as never)).toBe('true');
  });
});
