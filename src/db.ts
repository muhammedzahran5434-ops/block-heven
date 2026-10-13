export type BlockAction = "mine" | "place";

export type PlayerProfile = {
  id: string;
  username: string;
  usernameKey: string;
  passwordHash: string;
  salt: string;
  createdAt: number;
  level: number;
  xp: number;
  blocksMined: number;
  blocksPlaced: number;
};

export type StoredWorld<TBlock extends string = string> = {
  userId: string;
  seed: number;
  changes: Array<[string, TBlock | null]>;
  updatedAt: number;
};

type SessionRecord = {
  key: "current";
  userId: string;
};

const DATABASE_NAME = "blockhaven-player-data";
const DATABASE_VERSION = 1;

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const database = request.result;
      const users = database.createObjectStore("users", { keyPath: "id" });
      users.createIndex("usernameKey", "usernameKey", { unique: true });
      database.createObjectStore("worlds", { keyPath: "userId" });
      database.createObjectStore("session", { keyPath: "key" });
    };
  });
}

function requestValue<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Database transaction was cancelled."));
  });
}

function bytesToBase64(bytes: Uint8Array) {
  let value = "";
  bytes.forEach((byte) => {
    value += String.fromCharCode(byte);
  });
  return btoa(value);
}

function base64ToBytes(value: string) {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64ToBytes(salt),
      iterations: 120_000,
    },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

function publicProfile(profile: PlayerProfile) {
  return { ...profile, passwordHash: "", salt: "" };
}

export function xpForNextLevel(level: number) {
  return 75 + level * 25;
}

export async function createAccount(username: string, password: string) {
  const cleanUsername = username.trim();
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(cleanUsername)) {
    throw new Error("Username must be 3-16 letters, numbers, or underscores.");
  }
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");

  const database = await openDatabase();
  const lookupTransaction = database.transaction("users", "readonly");
  const existing = await requestValue(
    lookupTransaction.objectStore("users").index("usernameKey").get(cleanUsername.toLowerCase()),
  );
  if (existing) {
    database.close();
    throw new Error("That username is already being used on this device.");
  }

  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = bytesToBase64(saltBytes);
  const profile: PlayerProfile = {
    id: crypto.randomUUID(),
    username: cleanUsername,
    usernameKey: cleanUsername.toLowerCase(),
    passwordHash: await hashPassword(password, salt),
    salt,
    createdAt: Date.now(),
    level: 1,
    xp: 0,
    blocksMined: 0,
    blocksPlaced: 0,
  };

  const transaction = database.transaction(["users", "session"], "readwrite");
  transaction.objectStore("users").add(profile);
  transaction.objectStore("session").put({ key: "current", userId: profile.id } satisfies SessionRecord);
  await transactionDone(transaction);
  database.close();
  return publicProfile(profile);
}

export async function signIn(username: string, password: string) {
  const database = await openDatabase();
  const transaction = database.transaction("users", "readonly");
  const profile = (await requestValue(
    transaction.objectStore("users").index("usernameKey").get(username.trim().toLowerCase()),
  )) as PlayerProfile | undefined;

  if (!profile || (await hashPassword(password, profile.salt)) !== profile.passwordHash) {
    database.close();
    throw new Error("Username or password is incorrect.");
  }

  const sessionTransaction = database.transaction("session", "readwrite");
  sessionTransaction.objectStore("session").put({ key: "current", userId: profile.id } satisfies SessionRecord);
  await transactionDone(sessionTransaction);
  database.close();
  return publicProfile(profile);
}

export async function restoreSession() {
  const database = await openDatabase();
  const sessionTransaction = database.transaction("session", "readonly");
  const session = (await requestValue(
    sessionTransaction.objectStore("session").get("current"),
  )) as SessionRecord | undefined;
  if (!session) {
    database.close();
    return null;
  }

  const userTransaction = database.transaction("users", "readonly");
  const profile = (await requestValue(
    userTransaction.objectStore("users").get(session.userId),
  )) as PlayerProfile | undefined;
  database.close();
  return profile ? publicProfile(profile) : null;
}

export async function signOut() {
  const database = await openDatabase();
  const transaction = database.transaction("session", "readwrite");
  transaction.objectStore("session").delete("current");
  await transactionDone(transaction);
  database.close();
}

export async function loadWorld<TBlock extends string>(userId: string) {
  const database = await openDatabase();
  const transaction = database.transaction("worlds", "readonly");
  const world = (await requestValue(
    transaction.objectStore("worlds").get(userId),
  )) as StoredWorld<TBlock> | undefined;
  database.close();
  return world ?? null;
}

export async function saveWorld<TBlock extends string>(world: StoredWorld<TBlock>) {
  const database = await openDatabase();
  const transaction = database.transaction("worlds", "readwrite");
  transaction.objectStore("worlds").put(world);
  await transactionDone(transaction);
  database.close();
}

export async function addProgress(userId: string, action: BlockAction) {
  const database = await openDatabase();
  const transaction = database.transaction("users", "readwrite");
  const store = transaction.objectStore("users");
  const profile = (await requestValue(store.get(userId))) as PlayerProfile | undefined;
  if (!profile) {
    transaction.abort();
    database.close();
    throw new Error("Player account was not found.");
  }

  const startingLevel = profile.level;
  profile.xp += action === "mine" ? 18 : 6;
  if (action === "mine") profile.blocksMined += 1;
  else profile.blocksPlaced += 1;

  while (profile.xp >= xpForNextLevel(profile.level)) {
    profile.xp -= xpForNextLevel(profile.level);
    profile.level += 1;
  }

  store.put(profile);
  await transactionDone(transaction);
  database.close();
  return {
    profile: publicProfile(profile),
    leveledUp: profile.level > startingLevel,
    reward: action === "mine" ? 18 : 6,
  };
}