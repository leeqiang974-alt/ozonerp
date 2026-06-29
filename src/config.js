import fs from "node:fs";
import path from "node:path";

export const OZON_API_BASE = "https://api-seller.ozon.ru";
export const LOCAL_API_FILE = path.resolve("data", "ozonapi.txt");
export const DEFAULT_API_FILE = "D:\\Desktop\\api\\ozonapi.txt";
export const LEGACY_API_FILE = "D:\\Desktop\\ozonapi.txt";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function maskSecret(value = "") {
  if (!value) return "";
  if (value.length <= 10) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function resolveApiFile(filePath = process.env.OZON_API_FILE) {
  const candidates = [filePath, LOCAL_API_FILE, DEFAULT_API_FILE, LEGACY_API_FILE].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0] || DEFAULT_API_FILE;
}

export function loadStores(filePath = process.env.OZON_API_FILE) {
  filePath = resolveApiFile(filePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`API credential file not found: ${filePath}`);
  }

  const lines = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const stores = [];
  let pendingName = "";
  let pendingClientId = "";
  let pendingProfile = "";

  for (const line of lines) {
    const nameMatch = line.match(/^店铺名称[:：]\s*(.+)$/);
    const idMatch = line.match(/^id[:：]\s*(\d+)$/i);
    const keyMatch = line.match(/^key[:：]\s*([0-9a-f-]{36})/i);
    const uuid = line.split(/\s+/).find((part) => uuidPattern.test(part));

    if (/newapi|外部使用|个人使用/i.test(line)) {
      pendingProfile = line.includes("外部使用")
        ? "外部使用"
        : line.includes("个人使用")
          ? "个人使用"
          : "newapi";
      continue;
    }

    if (nameMatch) {
      pendingName = nameMatch[1].trim();
      continue;
    }

    if (idMatch) {
      pendingClientId = idMatch[1];
      continue;
    }

    if (keyMatch && pendingName && pendingClientId) {
      stores.push({
        id: `${pendingClientId}-${stores.length + 1}`,
        name: pendingProfile ? `${pendingName}（${pendingProfile}）` : pendingName,
        clientId: pendingClientId,
        apiKey: keyMatch[1],
      });
      pendingName = "";
      pendingClientId = "";
      pendingProfile = "";
      continue;
    }

    if (!pendingName && uuid) {
      continue;
    }

    if (!pendingName) {
      pendingName = line;
      continue;
    }

    if (!pendingClientId && /^\d+$/.test(line)) {
      pendingClientId = line;
      continue;
    }

    if (uuid && pendingName && pendingClientId) {
      stores.push({
        id: `${pendingClientId}-${stores.length + 1}`,
        name: pendingProfile ? `${pendingName}（${pendingProfile}）` : pendingName,
        clientId: pendingClientId,
        apiKey: uuid,
      });
      pendingName = "";
      pendingClientId = "";
      pendingProfile = "";
    }
  }

  return stores;
}

export function publicStore(store) {
  return {
    id: store.id,
    name: store.name,
    clientId: store.clientId,
    apiKey: maskSecret(store.apiKey),
  };
}

export function getStore(storeId) {
  const stores = loadStores();
  const store = stores.find((item) => item.id === storeId || item.clientId === storeId);
  if (!store) {
    const known = stores.map((item) => `${item.name}(${item.clientId})`).join(", ");
    throw new Error(`Store not found. Known stores: ${known}`);
  }
  return store;
}
