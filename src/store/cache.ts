import type { ActiveRunSnapshot, LevelJson, PlayerState } from '../types/level';

/**
 * 大件缓存（方案 §二 M8）：IndexedDB 存关卡 JSON + GLB blob + 玩家存档。
 * - 关卡与 GLB 都按 levelId 存：重开同一关零积分重跑。
 * - Lux3D 产物 URL 仅 2 小时有效，所以先落 blob 再进 Three.js。
 * - 浏览器禁用 IndexedDB 时自动退回内存（本局还能玩，只是不能复用）。
 * - 玩家存档与设置走 localStorage（小件、同步读），Key 只存 localStorage。
 */

const DB_NAME = 'gemwright';
const DB_VERSION = 2;
const LEVEL_STORE = 'levels';
const MODEL_STORE = 'models';
const LIBRARY_STORE = 'library';
export const PROFILE_STORAGE_KEY = 'gemwright.profile.v1';
export const ACTIVE_RUN_KEY = 'gemwright.run.v1';
export const TUTORIAL_DONE_KEY = 'gemwright.tutorial.v1';

interface ModelRecord {
  key: string;
  levelId: string;
  itemId: string;
  blob: Blob;
  createdAt: number;
}

/**
 * 归档模型：关卡结算后从 `models` 迁到这里，既释放关卡缓存，又保留可下载原件。
 * `models` 只服务当前关卡 / 续玩；`library` 是玩家可浏览、下载、手动清理的生成列表。
 */
export interface LibrarySummary {
  key: string;
  levelId: string;
  itemId: string;
  name: string;
  creator: string;
  authentic: boolean;
  worldName: string;
  savedAt: number;
  size: number;
}

interface LibraryRecord extends LibrarySummary {
  blob: Blob;
}

export interface CachedLevelSummary {
  id: string;
  createdAt: number;
  seedGenre: string;
  difficulty: number;
}

export type ModelMap = Record<string, Blob | null>;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务被中止'));
  });
}

export class GameCache {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private readonly memoryLevels = new Map<string, LevelJson>();
  private readonly memoryModels = new Map<string, ModelRecord>();
  private readonly memoryLibrary = new Map<string, LibraryRecord>();
  private memoryOnly = false;

  constructor(private readonly factory: IDBFactory | null) {}

  private open(): Promise<IDBDatabase | null> {
    const factory = this.factory;
    if (this.memoryOnly || !factory) return Promise.resolve(null);
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
        let request: IDBOpenDBRequest;
        try {
          request = factory.open(DB_NAME, DB_VERSION);
        } catch {
          this.memoryOnly = true;
          resolve(null);
          return;
        }
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(LEVEL_STORE)) {
            db.createObjectStore(LEVEL_STORE, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(MODEL_STORE)) {
            db.createObjectStore(MODEL_STORE, { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains(LIBRARY_STORE)) {
            db.createObjectStore(LIBRARY_STORE, { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          this.memoryOnly = true;
          resolve(null);
        };
      });
    }
    return this.dbPromise;
  }

  async saveLevel(level: LevelJson): Promise<void> {
    this.memoryLevels.set(level.id, level);
    const db = await this.open();
    if (!db) return;
    const tx = db.transaction(LEVEL_STORE, 'readwrite');
    tx.objectStore(LEVEL_STORE).put(level);
    await transactionDone(tx);
  }

  async getLevel(levelId: string): Promise<LevelJson | null> {
    const db = await this.open();
    if (!db) return this.memoryLevels.get(levelId) ?? null;
    const tx = db.transaction(LEVEL_STORE, 'readonly');
    const result = await requestToPromise<LevelJson | undefined>(
      tx.objectStore(LEVEL_STORE).get(levelId),
    );
    return result ?? this.memoryLevels.get(levelId) ?? null;
  }

  async listLevels(limit = 20): Promise<CachedLevelSummary[]> {
    const db = await this.open();
    if (!db) {
      return [...this.memoryLevels.values()]
        .map((level) => ({
          id: level.id,
          createdAt: level.createdAt,
          seedGenre: level.seedGenre,
          difficulty: level.difficulty,
        }))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    }
    const tx = db.transaction(LEVEL_STORE, 'readonly');
    const all = await requestToPromise<LevelJson[]>(tx.objectStore(LEVEL_STORE).getAll());
    return all
      .map((level) => ({
        id: level.id,
        createdAt: level.createdAt,
        seedGenre: level.seedGenre,
        difficulty: level.difficulty,
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  async saveModel(levelId: string, itemId: string, blob: Blob): Promise<void> {
    const record: ModelRecord = {
      key: `${levelId}:${itemId}`,
      levelId,
      itemId,
      blob,
      createdAt: Date.now(),
    };
    this.memoryModels.set(record.key, record);
    const db = await this.open();
    if (!db) return;
    const tx = db.transaction(MODEL_STORE, 'readwrite');
    tx.objectStore(MODEL_STORE).put(record);
    await transactionDone(tx);
  }

  async getModel(levelId: string, itemId: string): Promise<Blob | null> {
    const key = `${levelId}:${itemId}`;
    const db = await this.open();
    if (!db) return this.memoryModels.get(key)?.blob ?? null;
    const tx = db.transaction(MODEL_STORE, 'readonly');
    const record = await requestToPromise<ModelRecord | undefined>(
      tx.objectStore(MODEL_STORE).get(key),
    );
    return record?.blob ?? this.memoryModels.get(key)?.blob ?? null;
  }

  async deleteLevel(levelId: string): Promise<void> {
    this.memoryLevels.delete(levelId);
    for (const key of [...this.memoryModels.keys()]) {
      if (key.startsWith(`${levelId}:`)) this.memoryModels.delete(key);
    }
    const db = await this.open();
    if (!db) return;
    const tx = db.transaction([LEVEL_STORE, MODEL_STORE], 'readwrite');
    tx.objectStore(LEVEL_STORE).delete(levelId);
    const index = tx.objectStore(MODEL_STORE);
    const range = IDBKeyRange.bound(`${levelId}:`, `${levelId}:~`);
    const cursorRequest = index.openCursor(range);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    await transactionDone(tx);
  }

  /** 把当前关卡里真实生成出的 GLB 写入长期归档（跳过 null / 占位模型）。 */
  async archiveModels(level: LevelJson, models: ModelMap): Promise<number> {
    const savedAt = Date.now();
    const records: LibraryRecord[] = [];
    for (const stall of level.stalls) {
      const blob = models[stall.itemId];
      if (!blob) continue;
      const creator =
        level.creators.find((entry) => entry.id === stall.creatorId)?.name ?? '未知创作人';
      records.push({
        key: `${level.id}:${stall.itemId}`,
        levelId: level.id,
        itemId: stall.itemId,
        name: stall.item.name,
        creator,
        authentic: stall.item.isAuthentic,
        worldName: level.world.name,
        savedAt,
        size: blob.size,
        blob,
      });
    }
    if (records.length === 0) return 0;
    for (const record of records) this.memoryLibrary.set(record.key, record);
    const db = await this.open();
    if (!db) return records.length;
    const tx = db.transaction(LIBRARY_STORE, 'readwrite');
    for (const record of records) tx.objectStore(LIBRARY_STORE).put(record);
    await transactionDone(tx);
    return records.length;
  }

  async listLibrary(): Promise<LibrarySummary[]> {
    const db = await this.open();
    const records = db
      ? await requestToPromise<LibraryRecord[]>(
          db.transaction(LIBRARY_STORE, 'readonly').objectStore(LIBRARY_STORE).getAll(),
        )
      : [...this.memoryLibrary.values()];
    return records
      .map(({ blob: _blob, ...summary }) => summary)
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  async getLibraryModel(key: string): Promise<Blob | null> {
    const db = await this.open();
    if (!db) return this.memoryLibrary.get(key)?.blob ?? null;
    const record = await requestToPromise<LibraryRecord | undefined>(
      db.transaction(LIBRARY_STORE, 'readonly').objectStore(LIBRARY_STORE).get(key),
    );
    return record?.blob ?? this.memoryLibrary.get(key)?.blob ?? null;
  }

  async deleteLibraryModel(key: string): Promise<void> {
    this.memoryLibrary.delete(key);
    const db = await this.open();
    if (!db) return;
    const tx = db.transaction(LIBRARY_STORE, 'readwrite');
    tx.objectStore(LIBRARY_STORE).delete(key);
    await transactionDone(tx);
  }

  async clearLibrary(): Promise<void> {
    this.memoryLibrary.clear();
    const db = await this.open();
    if (!db) return;
    const tx = db.transaction(LIBRARY_STORE, 'readwrite');
    tx.objectStore(LIBRARY_STORE).clear();
    await transactionDone(tx);
  }

  async clear(): Promise<void> {
    this.memoryLevels.clear();
    this.memoryModels.clear();
    this.memoryLibrary.clear();
    const db = await this.open();
    if (!db) return;
    const tx = db.transaction([LEVEL_STORE, MODEL_STORE, LIBRARY_STORE], 'readwrite');
    tx.objectStore(LEVEL_STORE).clear();
    tx.objectStore(MODEL_STORE).clear();
    tx.objectStore(LIBRARY_STORE).clear();
    await transactionDone(tx);
  }
}

function createFactory(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    return null;
  }
}

export const gameCache = new GameCache(createFactory());

/* ------------------------------------------------------------------ */
/* 玩家存档（localStorage，小件）                                        */
/* ------------------------------------------------------------------ */

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadProfile(): PlayerState | null {
  const raw = storage()?.getItem(PROFILE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<PlayerState>;
    const funds = Number(data.funds);
    const xp = Number(data.xp);
    const level = Number(data.level);
    if (!Number.isFinite(funds) || !Number.isFinite(xp) || !Number.isFinite(level)) return null;
    return { funds: Math.max(0, funds), xp: Math.max(0, xp), level: Math.max(1, level) };
  } catch {
    return null;
  }
}

export function saveProfile(profile: PlayerState): void {
  storage()?.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

export function clearProfile(): void {
  storage()?.removeItem(PROFILE_STORAGE_KEY);
}

/* ------------------------------------------------------------------ */
/* 刷新续玩（active run）与教学完成标记                                  */
/* ------------------------------------------------------------------ */

function isActiveRunSnapshot(value: unknown): value is ActiveRunSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ActiveRunSnapshot>;
  if (record.version !== 1) return false;
  if (!record.level || typeof record.level.id !== 'string') return false;
  if (!record.runtime || typeof record.runtime !== 'object') return false;
  if (!record.runtime.items || typeof record.runtime.items !== 'object') return false;
  if (typeof record.player?.funds !== 'number') return false;
  return true;
}

export function saveActiveRun(snapshot: ActiveRunSnapshot): void {
  try {
    storage()?.setItem(ACTIVE_RUN_KEY, JSON.stringify(snapshot));
  } catch {
    // 配额满 / 隐私模式：续玩是增强项，失败不影响当前这局。
  }
}

export function loadActiveRun(): ActiveRunSnapshot | null {
  const raw = storage()?.getItem(ACTIVE_RUN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isActiveRunSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearActiveRun(): void {
  try {
    storage()?.removeItem(ACTIVE_RUN_KEY);
  } catch {
    // ignore
  }
}

export function isTutorialCompleted(): boolean {
  try {
    return storage()?.getItem(TUTORIAL_DONE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTutorialCompleted(): void {
  try {
    storage()?.setItem(TUTORIAL_DONE_KEY, '1');
  } catch {
    // ignore
  }
}
