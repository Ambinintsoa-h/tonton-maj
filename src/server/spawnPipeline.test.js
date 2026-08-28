const { EventEmitter } = require('events');

jest.mock('child_process', () => ({ spawn: jest.fn() }));
const { spawn } = require('child_process');
const { spawnPipeline } = require('./spawnPipeline');

// Fabrique un faux process enfant : stdout/stderr en EventEmitter, stdin en
// enregistreur simple -- suffisant pour piloter le protocole NDJSON sans
// jamais lancer un vrai process Node.
function fakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stdout.setEncoding = jest.fn();
  proc.stderr = new EventEmitter();
  proc.stderr.setEncoding = jest.fn();
  proc.stdin = { write: jest.fn(), end: jest.fn() };
  proc.kill = jest.fn();
  return proc;
}

const emitLines = (proc, lines) => {
  proc.stdout.emit('data', lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
};

beforeEach(() => {
  spawn.mockReset();
});

describe('spawnPipeline', () => {
  it('écrit l\'input en JSON sur stdin puis ferme stdin', async () => {
    const proc = fakeProc();
    spawn.mockReturnValue(proc);
    const p = spawnPipeline({ articleUrl: 'https://x.test/a' });
    expect(proc.stdin.write).toHaveBeenCalledWith(JSON.stringify({ articleUrl: 'https://x.test/a' }));
    expect(proc.stdin.end).toHaveBeenCalled();
    emitLines(proc, [{ type: 'result', ok: true, articleId: 'a1' }]);
    proc.emit('close', 0);
    await expect(p).resolves.toEqual({ type: 'result', ok: true, articleId: 'a1', steps: [] });
  });

  it('collecte les lignes {type:"step"} et les transmet à onStep', async () => {
    const proc = fakeProc();
    spawn.mockReturnValue(proc);
    const onStep = jest.fn();
    const p = spawnPipeline({ articleUrl: 'x' }, { onStep });
    emitLines(proc, [{ type: 'step', text: 'Audit...' }, { type: 'step', text: 'Génération...' }]);
    emitLines(proc, [{ type: 'result', ok: true, articleId: 'a1' }]);
    proc.emit('close', 0);
    const out = await p;
    expect(out.steps).toEqual(['Audit...', 'Génération...']);
    expect(onStep).toHaveBeenNthCalledWith(1, 'Audit...');
    expect(onStep).toHaveBeenNthCalledWith(2, 'Génération...');
  });

  it('reconstitue un message NDJSON coupé entre deux paquets stdout', async () => {
    const proc = fakeProc();
    spawn.mockReturnValue(proc);
    const p = spawnPipeline({});
    const full = JSON.stringify({ type: 'result', ok: true, articleId: 'a1' });
    proc.stdout.emit('data', full.slice(0, 10));
    proc.stdout.emit('data', full.slice(10) + '\n');
    proc.emit('close', 0);
    await expect(p).resolves.toEqual({ type: 'result', ok: true, articleId: 'a1', steps: [] });
  });

  it('rejette si le process se ferme sans jamais renvoyer de résultat', async () => {
    const proc = fakeProc();
    spawn.mockReturnValue(proc);
    const p = spawnPipeline({});
    proc.emit('close', 1);
    await expect(p).rejects.toThrow(/aucun résultat/);
  });

  it('rejette si le pipeline renvoie ok:false, avec le message d\'erreur du runner', async () => {
    const proc = fakeProc();
    spawn.mockReturnValue(proc);
    const p = spawnPipeline({});
    emitLines(proc, [{ type: 'result', ok: false, error: 'Audit illisible' }]);
    proc.emit('close', 1);
    await expect(p).rejects.toThrow('Audit illisible');
  });

  it('rejette si le process ne démarre pas du tout', async () => {
    const proc = fakeProc();
    spawn.mockReturnValue(proc);
    const p = spawnPipeline({});
    proc.emit('error', new Error('ENOENT'));
    await expect(p).rejects.toThrow(/Impossible de démarrer/);
  });

  it('ignore silencieusement une ligne stdout non-JSON', async () => {
    const proc = fakeProc();
    spawn.mockReturnValue(proc);
    const p = spawnPipeline({});
    proc.stdout.emit('data', 'ceci n\'est pas du JSON\n');
    emitLines(proc, [{ type: 'result', ok: true, articleId: 'a1' }]);
    proc.emit('close', 0);
    await expect(p).resolves.toEqual({ type: 'result', ok: true, articleId: 'a1', steps: [] });
  });
});
