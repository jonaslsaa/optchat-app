import { appendFileSync, existsSync, mkdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { controlImport, historyRoots, previewImport, readImport, scanChatGPT, scanClaudeMemories, scanLocal, startImport, type Conversation, type Scan, type Source } from 'pi-optchat/files';
import type { Found, Params, Result } from '../protocol.ts';
import { profileDirectory } from './profiles.ts';

/** Importing another tool's history into a profile, as pi-optchat does it (`pi-optchat/files`): the scan and the preview here,
 * from files and with no model; the import itself in the Pi that has the profile open, which pi-optchat's `startImport` asks
 * through the profile's socket. The page names conversations by their source and id in the scan, so no file it names is read. */
export class Imports {
  private readonly scans = new Map<Source, Promise<Scan>>();
  private readonly previews = new Map<string, AbortController>();
  private readonly home: string;
  private readonly histories: string | undefined;
  /** The home folder as it is named and as the files read in it are: /tmp is /private/tmp on a Mac. */
  private readonly homes: string[];
  private readonly upload: string;
  private readonly owned: (profile: string) => Promise<unknown>;
  /** `histories` is the home folder whose `.claude`, `.codex`, `.pi` and `.omp` are read: none reads none. `app` is the app's
   * own folder, where an uploaded export is kept. `owned` starts the Pi that has a profile, when none has it. */
  constructor({ home, histories, app, owned }: { home: string; histories?: string; app: string; owned: (profile: string) => Promise<unknown> }) {
    this.home = home;
    this.histories = histories;
    this.homes = histories ? [...new Set([histories, existsSync(histories) ? realpathSync(histories) : histories])] : [];
    this.upload = join(app, 'imports');
    this.owned = owned;
  }

  /** The ChatGPT export uploaded last, while the server runs. */
  private exported?: string;
  private read(source: Source): Promise<Scan> {
    const { histories, exported } = this;
    if (source === 'chatgpt') return exported ? scanChatGPT(exported) : Promise.resolve({ conversations: [], warnings: [] });
    if (!histories) return Promise.resolve({ conversations: [], warnings: [] });
    return historyRoots(source, histories).then(roots => source === 'claude-memory' ? scanClaudeMemories(roots[0]) : scanLocal(source, roots));
  }
  private scan(source: Source, fresh = false) {
    let scan = this.scans.get(source);
    if (!scan || fresh) {
      this.scans.set(source, scan = this.read(source));
      // One that failed is read again at the next look, not kept as a failure.
      scan.catch(() => { if (this.scans.get(source) === scan) this.scans.delete(source); });
    }
    return scan;
  }
  /** A path as the page shows it, with your home folder as `~`. */
  private shown(path: string) {
    const home = this.homes.find(home => path === home || path.startsWith(home + sep));
    return home ? `~${path.slice(home.length)}` : path;
  }
  /** pi-optchat's warnings name the files it read: the page is told which conversation it was, and of any other file only where
   * it is under your home. */
  private told(warnings: string[], conversations: Conversation[]) {
    return warnings.map(warning => {
      const of = conversations.find(c => warning.startsWith(c.file));
      return of ? `“${of.title}”${warning.slice(of.file.length).replace(/^:(\d+):/, ', line $1:')}` : warning.split(' ').map(word => this.shown(word)).join(' ');
    });
  }
  async found({ source, fresh }: Params<'importScan'>): Promise<Result<'importScan'>> {
    const { conversations, warnings, note } = await this.scan(source, fresh);
    const found = conversations.map(({ id, title, project, date, size }): Found => ({ id, title, project: this.shown(project), date, size }));
    return { found, warnings: this.told(warnings, conversations), ...note && { note } };
  }
  /** A ChatGPT export, a piece at a time. It is kept where the app keeps its own files, under one name, and the scan of the one
   * before it is forgotten. */
  receive({ name, offset, data }: Params<'importUpload'>): Result<'importUpload'> {
    const bytes = Buffer.from(data, 'base64');
    // pi-optchat reads a ZIP by its name, and anything else as conversations.json.
    const path = join(this.upload, name.toLowerCase().endsWith('.zip') ? 'export.zip' : 'conversations.json');
    if (offset === 0) {
      rmSync(this.upload, { recursive: true, force: true });
      mkdirSync(this.upload, { recursive: true, mode: 0o700 });
      this.scans.delete('chatgpt');
      writeFileSync(path, bytes, { mode: 0o600 });
    } else {
      if (path !== this.exported || statSync(path).size !== offset) throw new Error('The export arrived out of order. Choose it again.');
      appendFileSync(path, bytes);
    }
    this.exported = path;
    return { received: offset + bytes.length };
  }
  /** The conversations picked, as the scan has them: one that is not in it (any more) is refused, not skipped. */
  private async picked(picked: Params<'importPreview'>['picked']) {
    const sources = [...new Set(picked.map(pick => pick.source))];
    const scans = new Map(await Promise.all(sources.map(async source => [source, new Map((await this.scan(source)).conversations.map(c => [c.id, c]))] as const)));
    return picked.map(({ source, id }): Conversation => {
      const found = scans.get(source)?.get(id);
      if (!found) throw new Error(`A conversation picked is no longer where it was found (${source} ${id}). Scan again.`);
      return found;
    });
  }
  /** What the picked conversations would bring. A newer preview of the same profile cuts the one before short: it reads every
   * conversation, and the page asks again at every tick of a box. */
  async preview({ profile, picked }: Params<'importPreview'>): Promise<Result<'importPreview'>> {
    this.previews.get(profile)?.abort();
    const cut = new AbortController();
    this.previews.set(profile, cut);
    try {
      const conversations = await this.picked(picked), preview = await previewImport(profileDirectory(this.home, profile), conversations, cut.signal);
      return { ...preview, warnings: this.told(preview.warnings, conversations) };
    }
    finally { if (this.previews.get(profile) === cut) this.previews.delete(profile); }
  }
  async start({ profile, picked, mode }: Params<'importStart'>): Promise<Result<'importStart'>> {
    const conversations = await this.picked(picked), directory = profileDirectory(this.home, profile);
    await this.owned(profile);
    const chatgpt = conversations.some(c => c.source === 'chatgpt') && this.exported;
    return startImport(directory, { conversations, mode, ...chatgpt && { chatgpt } });
  }
  async control({ profile, action }: Params<'importControl'>): Promise<Result<'importControl'>> {
    // Resuming needs the Pi that runs it; discarding and pausing do not start one.
    if (action === 'resume') await this.owned(profile);
    return controlImport(profileDirectory(this.home, profile), action);
  }
  status({ profile }: Params<'importStatus'>): Promise<Result<'importStatus'>> { return readImport(profileDirectory(this.home, profile)); }
}
