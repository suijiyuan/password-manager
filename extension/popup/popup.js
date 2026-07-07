import { initTheme } from "../shared/theme.js"

function queryActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs?.[0] ?? null))
  })
}

function setHidden(el, hidden) {
  el.classList.toggle("hidden", Boolean(hidden))
}

function $(id) {
  return document.getElementById(id)
}

const VAULT_STORAGE_KEY = "vault"
const SESSION_KEY_STORAGE_KEY = "sessionKey"
const KDF_ITERATIONS = 210000

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
    true,
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

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve))
}

function storageSet(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve))
}

function sessionAvailable() {
  return Boolean(chrome?.storage?.session)
}

function sessionGet(keys) {
  if (!sessionAvailable()) return Promise.resolve({})
  return new Promise((resolve) => chrome.storage.session.get(keys, resolve))
}

function sessionSet(value) {
  if (!sessionAvailable()) return Promise.resolve()
  return new Promise((resolve) => chrome.storage.session.set(value, resolve))
}

function sessionRemove(keys) {
  if (!sessionAvailable()) return Promise.resolve()
  return new Promise((resolve) => chrome.storage.session.remove(keys, resolve))
}

async function getVaultRecord() {
  const result = await storageGet([VAULT_STORAGE_KEY])
  return result[VAULT_STORAGE_KEY] ?? null
}

async function setVaultRecord(record) {
  await storageSet({ [VAULT_STORAGE_KEY]: record })
}

async function createNewVault({ masterPassword }) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveAesKeyFromPassword({ password: masterPassword, salt, iterations: KDF_ITERATIONS })
  const enc = await encryptJson({ key, value: { entries: [] } })
  const record = {
    kdf: { salt: bytesToBase64(salt), iterations: KDF_ITERATIONS },
    enc,
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
  const enc = await encryptJson({ key, value: data })
  const next = {
    ...record,
    enc,
    meta: { ...record.meta, updatedAt: Date.now() }
  }
  await setVaultRecord(next)
  return next
}

async function exportAesKeyRawBase64(key) {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key))
  return bytesToBase64(raw)
}

async function importAesKeyFromRawBase64(base64) {
  const raw = base64ToBytes(base64)
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
}

async function persistSessionKey(key) {
  const raw = await exportAesKeyRawBase64(key)
  await sessionSet({ [SESSION_KEY_STORAGE_KEY]: raw })
}

async function loadSessionKey() {
  const result = await sessionGet([SESSION_KEY_STORAGE_KEY])
  const raw = result?.[SESSION_KEY_STORAGE_KEY]
  if (!raw) return null
  try {
    return await importAesKeyFromRawBase64(raw)
  } catch {
    await sessionRemove([SESSION_KEY_STORAGE_KEY])
    return null
  }
}

async function clearSessionKey() {
  await sessionRemove([SESSION_KEY_STORAGE_KEY])
}

function generateId() {
  if (crypto.randomUUID) return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
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

const viewCreate = $("view-create")
const viewUnlock = $("view-unlock")
const viewVault = $("view-vault")

const createMaster = $("create-master")
const createMaster2 = $("create-master2")
const createError = $("create-error")
const btnCreate = $("btn-create")

const unlockMaster = $("unlock-master")
const unlockError = $("unlock-error")
const btnUnlock = $("btn-unlock")

const btnAdd = $("btn-add")
const btnImport = $("btn-import")
const btnExport = $("btn-export")
const btnLock = $("btn-lock")
const vaultError = $("vault-error")
const searchInput = $("search")
const siteBlock = $("site-block")
const siteList = $("site-list")
const allList = $("all-list")
const fileImport = $("file-import")

const modal = $("modal")
const modalBackdrop = $("modal-backdrop")
const modalClose = $("modal-close")
const modalTitle = $("modal-title")
const modalError = $("modal-error")
const entryName = $("entry-name")
const entryUrl = $("entry-url")
const entryUsername = $("entry-username")
const entryPassword = $("entry-password")
const btnSave = $("btn-save")
const toastEl = $("toast")

let status = null
let allEntries = []
let siteEntries = []
let editingEntryId = null
let toastTimer = null
let unlockedKey = null
let vaultRecord = null

function showView(name) {
  setHidden(viewCreate, name !== "create")
  setHidden(viewUnlock, name !== "unlock")
  setHidden(viewVault, name !== "vault")
}

function showError(el, message) {
  if (!message) {
    setHidden(el, true)
    el.textContent = ""
    return
  }
  el.textContent = message
  setHidden(el, false)
}

function escapeText(s) {
  return String(s ?? "")
}

function toast(message) {
  if (!toastEl) return
  if (toastTimer) clearTimeout(toastTimer)
  toastEl.textContent = String(message ?? "")
  setHidden(toastEl, false)
  toastTimer = setTimeout(() => setHidden(toastEl, true), 1200)
}

function themeName(pref) {
  if (pref === "light") return "浅色"
  if (pref === "dark") return "深色"
  return "跟随系统"
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(new Error("READ_FAILED"))
    reader.readAsText(file)
  })
}

function parseTime(value, fallbackMs) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const ms = Date.parse(value)
    if (Number.isFinite(ms)) return ms
  }
  return fallbackMs
}

function normalizeImportedEntry(raw, nowMs) {
  const id = raw?.id ? String(raw.id) : generateId()
  const createdAt = parseTime(raw?.createdAt, nowMs)
  const updatedAt = parseTime(raw?.updatedAt, nowMs)
  return {
    id,
    name: String(raw?.name ?? "").trim() || "Untitled",
    url: String(raw?.url ?? "").trim(),
    username: String(raw?.username ?? "").trim(),
    password: String(raw?.password ?? ""),
    createdAt,
    updatedAt
  }
}

async function copyText(label, value) {
  try {
    await navigator.clipboard.writeText(String(value ?? ""))
    toast(`${label}已复制`)
  } catch {
    toast(`${label}复制失败`)
  }
}

async function refreshStatus() {
  vaultRecord = await getVaultRecord()
  if (!unlockedKey) unlockedKey = await loadSessionKey()
  status = {
    hasVault: Boolean(vaultRecord),
    locked: !unlockedKey
  }
  return status
}

async function loadVault() {
  showError(vaultError, "")
  if (!unlockedKey) {
    await refreshStatus()
    showView("unlock")
    return
  }
  const record = await getVaultRecord()
  if (!record) {
    unlockedKey = null
    await refreshStatus()
    showView("create")
    return
  }
  vaultRecord = record
  try {
    const data = await readVaultData({ record, key: unlockedKey })
    allEntries = Array.isArray(data.entries) ? data.entries : []
  } catch {
    unlockedKey = null
    await clearSessionKey()
    await refreshStatus()
    showView("unlock")
    return
  }
  await loadSiteMatches()
  render()
}

async function loadSiteMatches() {
  const tab = await queryActiveTab()
  if (!tab?.url) {
    siteEntries = []
    return
  }
  siteEntries = allEntries.filter((e) => isUrlMatch(e.url, tab.url))
}

function filteredEntries(entries) {
  const q = String(searchInput.value ?? "").trim().toLowerCase()
  if (!q) return entries
  return entries.filter((e) => {
    const hay = `${e.name ?? ""} ${e.url ?? ""} ${e.username ?? ""}`.toLowerCase()
    return hay.includes(q)
  })
}

function buildItem(entry, { includeFill }) {
  const el = document.createElement("div")
  el.className = "item"

  const main = document.createElement("div")
  main.className = "item-main"

  const name = document.createElement("div")
  name.className = "item-name"
  name.textContent = escapeText(entry.name)

  const sub = document.createElement("div")
  sub.className = "item-sub"
  sub.textContent = escapeText(entry.username || entry.url || "")

  main.appendChild(name)
  main.appendChild(sub)

  const actions = document.createElement("div")
  actions.className = "item-actions"

  const btnCopyU = document.createElement("button")
  btnCopyU.className = "icon-btn"
  btnCopyU.textContent = "U"
  btnCopyU.addEventListener("click", async () => {
    await copyText("用户名", entry.username)
  })

  const btnCopyP = document.createElement("button")
  btnCopyP.className = "icon-btn"
  btnCopyP.textContent = "P"
  btnCopyP.addEventListener("click", async () => {
    await copyText("密码", entry.password)
  })

  actions.appendChild(btnCopyU)
  actions.appendChild(btnCopyP)

  const btnEdit = document.createElement("button")
  btnEdit.className = "icon-btn"
  btnEdit.textContent = "✎"
  btnEdit.addEventListener("click", () => openModal(entry))
  actions.appendChild(btnEdit)

  const btnDel = document.createElement("button")
  btnDel.className = "icon-btn"
  btnDel.textContent = "×"
  btnDel.addEventListener("click", async () => {
    const ok = confirm("Delete this item?")
    if (!ok) return
    if (!unlockedKey) {
      toast("请先解锁")
      await bootstrap()
      return
    }
    const record = await getVaultRecord()
    if (!record) {
      unlockedKey = null
      await bootstrap()
      return
    }
    try {
      const data = await readVaultData({ record, key: unlockedKey })
      const entries = Array.isArray(data.entries) ? data.entries : []
      const nextEntries = entries.filter((e) => e.id !== entry.id)
      vaultRecord = await writeVaultData({ record, key: unlockedKey, data: { ...data, entries: nextEntries } })
      await loadVault()
    } catch {
      toast("删除失败")
    }
  })
  actions.appendChild(btnDel)

  el.appendChild(main)
  el.appendChild(actions)
  return el
}

function renderList(container, entries, opts) {
  container.textContent = ""
  const list = filteredEntries(entries)
  for (const entry of list) container.appendChild(buildItem(entry, opts))
  if (!list.length) {
    const empty = document.createElement("div")
    empty.className = "item"
    const t = document.createElement("div")
    t.className = "item-sub"
    t.textContent = "No items"
    empty.appendChild(t)
    container.appendChild(empty)
  }
}

function render() {
  setHidden(siteBlock, !siteEntries.length)
  if (siteEntries.length) renderList(siteList, siteEntries, { includeFill: false })
  renderList(allList, allEntries, { includeFill: false })
}

function openModal(entry) {
  editingEntryId = entry?.id ?? null
  modalTitle.textContent = editingEntryId ? "Edit Item" : "Add Item"
  showError(modalError, "")
  entryName.value = entry?.name ?? ""
  entryUrl.value = entry?.url ?? ""
  entryUsername.value = entry?.username ?? ""
  entryPassword.value = entry?.password ?? ""
  setHidden(modal, false)
  setTimeout(() => entryName?.focus?.(), 0)
}

async function openModalWithTabDefaults() {
  const tab = await queryActiveTab()
  let url = ""
  if (tab?.url) {
    try {
      const u = new URL(tab.url)
      url = `${u.origin}/`
    } catch {}
  }
  openModal({ url })
}

function closeModal() {
  setHidden(modal, true)
  editingEntryId = null
}

async function handleSave() {
  showError(modalError, "")
  if (!unlockedKey) {
    showError(modalError, "请先解锁")
    await refreshStatus()
    setHidden(modal, true)
    editingEntryId = null
    showView("unlock")
    return
  }
  const entry = {
    id: editingEntryId,
    name: String(entryName.value ?? "").trim(),
    url: String(entryUrl.value ?? "").trim(),
    username: String(entryUsername.value ?? "").trim(),
    password: String(entryPassword.value ?? "")
  }
  if (!entry.password) {
    showError(modalError, "Password is required.")
    return
  }
  const record = await getVaultRecord()
  if (!record) {
    unlockedKey = null
    await refreshStatus()
    showView("create")
    return
  }
  try {
    const data = await readVaultData({ record, key: unlockedKey })
    const entries = Array.isArray(data.entries) ? data.entries : []
    const nextEntry = {
      id: entry.id ?? generateId(),
      name: String(entry.name ?? "").trim() || "Untitled",
      url: String(entry.url ?? "").trim(),
      username: String(entry.username ?? "").trim(),
      password: String(entry.password ?? ""),
      updatedAt: Date.now(),
      createdAt: entry.createdAt ?? Date.now()
    }
    const idx = entries.findIndex((e) => e.id === nextEntry.id)
    const nextEntries = idx >= 0 ? entries.map((e) => (e.id === nextEntry.id ? nextEntry : e)) : [nextEntry, ...entries]
    vaultRecord = await writeVaultData({ record, key: unlockedKey, data: { ...data, entries: nextEntries } })
    closeModal()
    await loadVault()
  } catch {
    showError(modalError, "保存失败")
  }
}

btnCreate.addEventListener("click", async () => {
  showError(createError, "")
  const p1 = String(createMaster.value ?? "")
  const p2 = String(createMaster2.value ?? "")
  if (p1.length < 6) {
    showError(createError, "Master password must be at least 6 characters.")
    return
  }
  if (p1 !== p2) {
    showError(createError, "Passwords do not match.")
    return
  }
  const existing = await getVaultRecord()
  if (existing) {
    showError(createError, "Vault already exists.")
    return
  }
  try {
    const { record, key } = await createNewVault({ masterPassword: p1 })
    vaultRecord = record
    unlockedKey = key
    await persistSessionKey(key)
    await bootstrap()
  } catch {
    showError(createError, "Create failed.")
  }
})

btnUnlock.addEventListener("click", async () => {
  showError(unlockError, "")
  const p = String(unlockMaster.value ?? "")
  const record = await getVaultRecord()
  if (!record) {
    showError(unlockError, "No vault.")
    await bootstrap()
    return
  }
  try {
    const key = await unlockExistingVault({ record, masterPassword: p })
    vaultRecord = record
    unlockedKey = key
    await persistSessionKey(key)
    await bootstrap()
  } catch {
    showError(unlockError, "主密码错误")
  } finally {
    unlockMaster.value = ""
  }
})

btnLock.addEventListener("click", async () => {
  unlockedKey = null
  await clearSessionKey()
  unlockMaster.value = ""
  await bootstrap()
})

btnAdd.addEventListener("click", async () => {
  await openModalWithTabDefaults()
})

btnImport.addEventListener("click", async () => {
  if (!unlockedKey) {
    toast("请先解锁")
    await bootstrap()
    return
  }
  fileImport.value = ""
  fileImport.click()
})

fileImport.addEventListener("change", async () => {
  const file = fileImport.files?.[0]
  if (!file) return

  if (!unlockedKey) {
    toast("请先解锁")
    await bootstrap()
    return
  }

  const record = await getVaultRecord()
  if (!record) {
    unlockedKey = null
    await clearSessionKey()
    await bootstrap()
    return
  }

  let parsed = null
  try {
    const text = await readFileAsText(file)
    parsed = JSON.parse(text)
  } catch {
    toast("导入文件无效")
    return
  }

  const importedEntries = Array.isArray(parsed?.entries) ? parsed.entries : null
  if (!importedEntries) {
    toast("导入文件格式不正确")
    return
  }

  try {
    const nowMs = Date.now()
    const data = await readVaultData({ record, key: unlockedKey })
    const currentEntries = Array.isArray(data.entries) ? data.entries : []
    const byId = new Map(currentEntries.map((e) => [e.id, e]))

    let total = 0
    let overwrite = 0
    let create = 0
    for (const raw of importedEntries) {
      const entry = normalizeImportedEntry(raw, nowMs)
      if (!entry.password) continue
      total += 1
      if (byId.has(entry.id)) overwrite += 1
      else create += 1
      byId.set(entry.id, entry)
    }

    if (!total) {
      toast("没有可导入的条目")
      return
    }

    const ok = confirm(`将导入 ${total} 条、覆盖 ${overwrite} 条、新增 ${create} 条`)
    if (!ok) return

    const merged = Array.from(byId.values()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    vaultRecord = await writeVaultData({ record, key: unlockedKey, data: { ...data, entries: merged } })
    toast("已导入")
    await loadVault()
  } catch {
    toast("导入失败")
  }
})

btnExport.addEventListener("click", async () => {
  if (!unlockedKey) {
    toast("请先解锁")
    await bootstrap()
    return
  }
  const record = await getVaultRecord()
  if (!record) {
    unlockedKey = null
    await clearSessionKey()
    await bootstrap()
    return
  }
  try {
    const data = await readVaultData({ record, key: unlockedKey })
    const d = new Date()
    const pad = (n) => String(n).padStart(2, "0")
    const filename = `vault-export-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`
    const entries = (Array.isArray(data.entries) ? data.entries : []).map((e) => {
      const out = { ...e }
      if (typeof e?.createdAt === "number") {
        out.createdAt = new Date(e.createdAt).toISOString()
      }
      if (typeof e?.updatedAt === "number") {
        out.updatedAt = new Date(e.updatedAt).toISOString()
      }
      return out
    })
    downloadJson(filename, { entries })
    toast("已导出")
  } catch {
    toast("导出失败")
  }
})

modalClose.addEventListener("click", (e) => {
  e.preventDefault()
  e.stopPropagation()
  closeModal()
})
modalBackdrop.addEventListener("click", (e) => {
  e.preventDefault()
  e.stopPropagation()
  closeModal()
})
btnSave.addEventListener("click", handleSave)

searchInput.addEventListener("input", () => render())

window.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && viewUnlock && !viewUnlock.classList.contains("hidden")) {
    const active = document.activeElement
    if (active === unlockMaster) {
      e.preventDefault()
      btnUnlock.click()
      return
    }
  }

  if (e.key !== "Escape") return
  if (modal.classList.contains("hidden")) return
  e.preventDefault()
  closeModal()
})

async function bootstrap() {
  await refreshStatus()
  if (!status?.hasVault) {
    setHidden(modal, true)
    editingEntryId = null
    showView("create")
    return
  }
  if (status?.locked) {
    setHidden(modal, true)
    editingEntryId = null
    showView("unlock")
    return
  }
  showView("vault")
  await loadVault()
}

async function start() {
  const themeButtons = Array.from(document.querySelectorAll("[data-theme-toggle]"))
  await initTheme({
    buttonEls: themeButtons,
    onChange: (pref) => {
      toast(`主题：${themeName(pref)}`)
    }
  })
  await bootstrap()
}

start()
