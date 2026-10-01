const { updateBatchItem, requeueBatchItem } = require('./batchItemStore');

function makeConn(responses) {
  const query = jest.fn();
  responses.forEach((r) => query.mockResolvedValueOnce(r));
  query.mockResolvedValue([{}]);
  return {
    beginTransaction: jest.fn().mockResolvedValue(),
    query,
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
  };
}

describe('updateBatchItem (partagé route PUT + orchestrateur)', () => {
  it('item introuvable : rollback, { notFound: true }', async () => {
    const conn = makeConn([[[]]]);
    const pool = { getConnection: jest.fn().mockResolvedValue(conn) };
    await expect(updateBatchItem(pool, 'b1', 'i1', { status: 'fait' })).resolves.toEqual({ notFound: true });
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  it('dernier item terminal : lot "done", réclamation atomique de l\'email (shouldNotify)', async () => {
    const conn = makeConn([
      [[{ id: 'i1', started_at: 1000 }]],                       // SELECT existant
      [{}],                                                       // UPDATE item
      [[{ total: 2, done_ct: 1, error_ct: 1, terminal_ct: 2 }]], // recomptage
      [{}],                                                       // UPDATE batches
      [{ affectedRows: 1 }],                                      // email_sent 0 -> 1
    ]);
    const pool = { getConnection: jest.fn().mockResolvedValue(conn) };
    const r = await updateBatchItem(pool, 'b1', 'i1', { status: 'fait', articleId: 'a1', completedAt: 5000, costUsd: 0.2 });
    expect(r).toEqual({ batchStatus: 'done', shouldNotify: true });
    const [batchSql, batchParams] = conn.query.mock.calls[3];
    expect(batchSql).toMatch(/UPDATE batches SET completed_count=\?/);
    expect(batchParams).toEqual([1, 1, 'done', 'done', expect.any(Number), 0.2, 4000, 'b1']);
    expect(conn.commit).toHaveBeenCalled();
  });

  it('email déjà réclamé par un item concurrent : shouldNotify false', async () => {
    const conn = makeConn([
      [[{ id: 'i1', started_at: null }]], [{}],
      [[{ total: 1, done_ct: 1, error_ct: 0, terminal_ct: 1 }]], [{}],
      [{ affectedRows: 0 }],
    ]);
    const pool = { getConnection: jest.fn().mockResolvedValue(conn) };
    await expect(updateBatchItem(pool, 'b1', 'i1', { status: 'fait' })).resolves.toEqual({ batchStatus: 'done', shouldNotify: false });
  });

  it('une erreur SQL fait un rollback et remonte', async () => {
    const conn = makeConn([]);
    conn.query.mockReset();
    conn.query.mockRejectedValue(new Error('deadlock'));
    const pool = { getConnection: jest.fn().mockResolvedValue(conn) };
    await expect(updateBatchItem(pool, 'b1', 'i1', {})).rejects.toThrow('deadlock');
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });
});

describe('requeueBatchItem', () => {
  it('true quand l\'item est remis en file (retry_count 0 -> 1)', async () => {
    const pool = { query: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) };
    await expect(requeueBatchItem(pool, 'b1', 'i1', 'Audit illisible')).resolves.toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/retry_count=retry_count\+1/);
    expect(sql).toMatch(/AND retry_count=0/);
    expect(params).toEqual(['Audit illisible', expect.any(Number), 'i1', 'b1']);
  });

  it('false quand déjà réessayé (aucune ligne touchée)', async () => {
    const pool = { query: jest.fn().mockResolvedValue([{ affectedRows: 0 }]) };
    await expect(requeueBatchItem(pool, 'b1', 'i1', 'x')).resolves.toBe(false);
  });
});
