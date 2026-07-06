const UNLOCK_TTL_MS = 15 * 60 * 1000

let unlockedKey = null
let unlockedAt = 0

const VAULT_STORAGE_KEY = "vault"

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function bytesToBase64(bytes) {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBytes(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function deriveAesKeyFromPassword({ password, salt, iterations }) {
  const material = await crypto.subtle.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveKey"])
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

async function encryptJson({ key, value }) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = textEncoder.encode(JSON.stringify(value))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext))
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) }
}

async function decryptJson({ key, ivBase64, ciphertextBase64 }) {
  const iv = base64ToBytes(ivBase64)
  const ciphertext = base64ToBytes(ciphertextBase64)
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext))
  return JSON.parse(textDecoder.decode(plaintext))
}

async function getVaultRecord() {
  const result = await chrome.storage.local.get([VAULT_STORAGE_KEY])
  return result[VAULT_STORAGE_KEY] ?? null
}

async function setVaultRecord(record) {
  await chrome.storage.local.set({ [VAULT_STORAGE_KEY]: record })
}

async function createNewVault({ masterPassword, iterations = 210000 }) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveAesKeyFromPassword({ password: masterPassword, salt, iterations })
  const encrypted = await encryptJson({ key, value: { entries: [] } })

  const record = {
    kdf: { salt: bytesToBase64(salt), iterations },
    enc: encrypted,
    meta: { createdAt: Date.now(), updatedAt: Date.now() }
  }

  await setVaultRecord(record)
  return { record, key }
}

async function unlockExistingVault({ record, masterPassword }) {
  const salt = base64ToBytes(record.kdf.salt)
  const iterations = record.kdf.iterations
  const key = await deriveAesKeyFromPassword({ password: masterPassword, salt, iterations })
  await decryptJson({ key, ivBase64: record.enc.iv, ciphertextBase64: record.enc.ciphertext })
  return key
}

async function readVaultData({ record, key }) {
  return decryptJson({ key, ivBase64: record.enc.iv, ciphertextBase64: record.enc.ciphertext })
}

async function writeVaultData({ record, key, data }) {
  const encrypted = await encryptJson({ key, value: data })
  const nextRecord = {
    ...record,
    enc: encrypted,
    meta: { ...record.meta, updatedAt: Date.now() }
  }
  await setVaultRecord(nextRecord)
  return nextRecord
}

function generateId() {
  if (crypto.randomUUID) return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function now() {
  return Date.now()
}

function getUnlockedUntil() {
  if (!unlockedKey) return 0
  return unlockedAt + UNLOCK_TTL_MS
}

function isUnlocked() {
  if (!unlockedKey) return false
  if (now() > getUnlockedUntil()) {
    unlockedKey = null
    unlockedAt = 0
    return false
  }
  return true
}

function requireUnlocked() {
  if (!isUnlocked()) {
    const err = new Error("LOCKED")
    err.code = "LOCKED"
    throw err
  }
  unlockedAt = now()
  return unlockedKey
}

function normalizeUrl(url) {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function isUrlMatch(entryUrl, currentUrl) {
  if (!entryUrl || !currentUrl) return false

  const current = normalizeUrl(currentUrl)
  if (!current) return false

  const entry = normalizeUrl(entryUrl)
  if (!entry) return currentUrl.includes(entryUrl)

  if (entry.hostname === current.hostname) return true
  if (current.hostname.endsWith(`.${entry.hostname}`)) return true
  return false
}

async function getStatus() {
  const record = await getVaultRecord()
  return {
    hasVault: Boolean(record),
    locked: !isUnlocked(),
    unlockedUntil: getUnlockedUntil()
  }
}

async function getEntries() {
  const key = requireUnlocked()
  const record = await getVaultRecord()
  if (!record) return []
  const data = await readVaultData({ record, key })
  return Array.isArray(data.entries) ? data.entries : []
}

async function upsertEntry({ entry }) {
  const key = requireUnlocked()
  const record = await getVaultRecord()
  if (!record) throw new Error("NO_VAULT")
  const data = await readVaultData({ record, key })
  const entries = Array.isArray(data.entries) ? data.entries : []

  const nextEntry = {
    id: entry.id ?? generateId(),
    name: String(entry.name ?? "").trim() || "Untitled",
    url: String(entry.url ?? "").trim(),
    username: String(entry.username ?? "").trim(),
    password: String(entry.password ?? ""),
    updatedAt: now(),
    createdAt: entry.createdAt ?? now()
  }

  const idx = entries.findIndex((e) => e.id === nextEntry.id)
  const nextEntries = idx >= 0 ? entries.map((e) => (e.id === nextEntry.id ? nextEntry : e)) : [nextEntry, ...entries]

  const nextRecord = await writeVaultData({ record, key, data: { ...data, entries: nextEntries } })
  return { entry: nextEntry, updatedAt: nextRecord.meta.updatedAt }
}

async function deleteEntry({ id }) {
  const key = requireUnlocked()
  const record = await getVaultRecord()
  if (!record) throw new Error("NO_VAULT")
  const data = await readVaultData({ record, key })
  const entries = Array.isArray(data.entries) ? data.entries : []
  const nextEntries = entries.filter((e) => e.id !== id)
  await writeVaultData({ record, key, data: { ...data, entries: nextEntries } })
  return { ok: true }
}

async function findMatches({ url }) {
  const entries = await getEntries()
  return entries.filter((e) => isUrlMatch(e.url, url))
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    try {
      if (message?.type === "status") return await getStatus()

      if (message?.type === "initVault") {
        const masterPassword = String(message.masterPassword ?? "")
        if (masterPassword.length < 6) throw new Error("MASTER_PASSWORD_TOO_SHORT")
        const existing = await getVaultRecord()
        if (existing) throw new Error("VAULT_ALREADY_EXISTS")
        const { key } = await createNewVault({ masterPassword })
        unlockedKey = key
        unlockedAt = now()
        return await getStatus()
      }

      if (message?.type === "unlock") {
        const record = await getVaultRecord()
        if (!record) throw new Error("NO_VAULT")
        const masterPassword = String(message.masterPassword ?? "")
        const key = await unlockExistingVault({ record, masterPassword })
        unlockedKey = key
        unlockedAt = now()
        return await getStatus()
      }

      if (message?.type === "lock") {
        unlockedKey = null
        unlockedAt = 0
        return await getStatus()
      }

      if (message?.type === "getEntries") return { entries: await getEntries() }
      if (message?.type === "upsertEntry") return await upsertEntry({ entry: message.entry ?? {} })
      if (message?.type === "deleteEntry") return await deleteEntry({ id: message.id })
      if (message?.type === "findMatches") return { entries: await findMatches({ url: message.url }) }

      throw new Error("UNKNOWN_MESSAGE")
    } catch (e) {
      return { error: { message: e?.message ?? String(e), code: e?.code } }
    }
  }

  run().then(sendResponse)
  return true
})
