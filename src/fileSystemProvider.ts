import * as path from "path";
import * as vscode from "vscode";
import { IContext } from "./extension";

let _ankiFs: AnkiFS;
let _initialised = false;

const getAnkiFS = (): AnkiFS => {
  if (_initialised !== true) {
    throw new Error("Trying to access an uninitialised file system!");
  }

  return _ankiFs;
};

export class File implements vscode.FileStat {
  type: vscode.FileType;
  ctime: number;
  mtime: number;
  size: number;

  name: string;
  data?: Uint8Array;

  constructor(name: string) {
    this.type = vscode.FileType.File;
    this.ctime = Date.now();
    this.mtime = Date.now();
    this.size = 0;
    this.name = name;
  }
}

export class Directory implements vscode.FileStat {
  type: vscode.FileType;
  ctime: number;
  mtime: number;
  size: number;

  name: string;
  entries: Map<string, File | Directory>;

  constructor(name: string) {
    this.type = vscode.FileType.Directory;
    this.ctime = Date.now();
    this.mtime = Date.now();
    this.size = 0;
    this.name = name;
    this.entries = new Map();
  }
}

export type Entry = File | Directory;

export class AnkiFS implements vscode.FileSystemProvider {
  root = new Directory("");

  stat(uri: vscode.Uri): vscode.FileStat {
    return this._lookup(uri, false);
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    const entry = this._lookupAsDirectory(uri, false);
    const result: [string, vscode.FileType][] = [];
    for (const [name, child] of entry.entries) {
      result.push([name, child.type]);
    }
    return result;
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const data = this._lookupAsFile(uri, false).data;
    if (data) {
      return data;
    }
    throw vscode.FileSystemError.FileNotFound();
  }

  writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): void {}

  rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean }
  ): void {}

  delete(uri: vscode.Uri): void {}

  createDirectory(uri: vscode.Uri): void {
    const basename = path.posix.basename(uri.path);
    const dirname = uri.with({ path: path.posix.dirname(uri.path) });
    const parent = this._lookupAsDirectory(dirname, false);

    const entry = new Directory(basename);
    parent.entries.set(entry.name, entry);
    parent.mtime = Date.now();
    parent.size += 1;

    this._fireSoon(
      { type: vscode.FileChangeType.Changed, uri: dirname },
      { type: vscode.FileChangeType.Created, uri }
    );
  }

  private _lookup(uri: vscode.Uri, silent: false): Entry;
  private _lookup(uri: vscode.Uri, silent: boolean): Entry | undefined;
  private _lookup(uri: vscode.Uri, silent: boolean): Entry | undefined {
    const parts = uri.path.split("/");
    let entry: Entry = this.root;
    for (const part of parts) {
      if (!part) {
        continue;
      }
      let child: Entry | undefined;
      if (entry instanceof Directory) {
        child = entry.entries.get(part);
      }
      if (!child) {
        if (!silent) {
          throw vscode.FileSystemError.FileNotFound(uri);
        } else {
          return undefined;
        }
      }
      entry = child;
    }
    return entry;
  }

  private _lookupAsDirectory(uri: vscode.Uri, silent: boolean): Directory {
    const entry = this._lookup(uri, silent);
    if (entry instanceof Directory) {
      return entry;
    }
    throw vscode.FileSystemError.FileNotADirectory(uri);
  }

  private _lookupAsFile(uri: vscode.Uri, silent: boolean): File {
    const entry = this._lookup(uri, silent);
    if (entry instanceof File) {
      return entry;
    }
    throw vscode.FileSystemError.FileIsADirectory(uri);
  }

  // --- manage file events

  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private _bufferedEvents: vscode.FileChangeEvent[] = [];
  private _fireSoonHandle?: NodeJS.Timer;

  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this
    ._emitter.event;

  watch(_resource: vscode.Uri): vscode.Disposable {
    // ignore, fires for all changes...
    return new vscode.Disposable(() => {});
  }

  private _fireSoon(...events: vscode.FileChangeEvent[]): void {
    this._bufferedEvents.push(...events);

    if (this._fireSoonHandle) {
      clearTimeout(this._fireSoonHandle);
    }

    this._fireSoonHandle = setTimeout(() => {
      this._emitter.fire(this._bufferedEvents);
      this._bufferedEvents.length = 0;
    }, 5);
  }
}

export const initFilesystem = (ctx: IContext) => {
  _ankiFs = new AnkiFS();
  _initialised = true;

  ctx.context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("anki", _ankiFs, {
      isCaseSensitive: true,
    })
  );

  ctx.getAnkiFS = getAnkiFS;
};