import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "erp-sequence.json");
const PREFIX = "SKUlq";

export async function nextParentSku() {
  const state = await loadState();
  const value = Number(state.nextParentSku || 1);
  const parentSku = `${PREFIX}${String(value).padStart(5, "0")}`;
  state.nextParentSku = value + 1;
  state.updatedAt = new Date().toISOString();
  await saveState(state);
  return { parentSku, next: state.nextParentSku, updatedAt: state.updatedAt };
}

export async function reserveParentSkus(count = 1) {
  const amount = Math.max(1, Math.min(200, Number(count || 1)));
  const state = await loadState();
  const start = Number(state.nextParentSku || 1);
  const parentSkus = Array.from({ length: amount }, (_, index) => `${PREFIX}${String(start + index).padStart(5, "0")}`);
  state.nextParentSku = start + amount;
  state.updatedAt = new Date().toISOString();
  await saveState(state);
  return { parentSkus, start, next: state.nextParentSku, updatedAt: state.updatedAt };
}

async function loadState() {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    return { nextParentSku: 1, updatedAt: "" };
  }
}

async function saveState(state) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(state, null, 2), "utf8");
}
