import { base64ToBytes, decryptJson, deriveAesKeyFromPassword, encryptJson, bytesToBase64 } from "./crypto.js"

const VAULT_STORAGE_KEY = "vault"

export async function getVaultRecord() {
  const result = await chrome.storage.local.get([VAULT_STORAGE_KEY])
  return result[VAULT_STORAGE_KEY] ?? null
}

export async function setVaultRecord(record) {
  await chrome.storage.local.set({ [VAULT_STORAGE_KEY]: record })
}

export async function createNewVault({ masterPassword, iterations = 210000 }) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveAesKeyFromPassword({ password: masterPassword, salt, iterations })
  const encrypted = await encryptJson({ key, value: { entries: [] } })

  const record = {
    kdf: {
      salt: bytesToBase64(salt),
      iterations
    },
    enc: encrypted,
    meta: {
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  }

  await setVaultRecord(record)
  return { record, key }
}

export async function unlockExistingVault({ record, masterPassword }) {
  const salt = base64ToBytes(record.kdf.salt)
  const iterations = record.kdf.iterations
  const key = await deriveAesKeyFromPassword({ password: masterPassword, salt, iterations })
  await decryptJson({
    key,
    ivBase64: record.enc.iv,
    ciphertextBase64: record.enc.ciphertext
  })
  return key
}

export async function readVaultData({ record, key }) {
  return decryptJson({
    key,
    ivBase64: record.enc.iv,
    ciphertextBase64: record.enc.ciphertext
  })
}

export async function writeVaultData({ record, key, data }) {
  const encrypted = await encryptJson({ key, value: data })
  const nextRecord = {
    ...record,
    enc: encrypted,
    meta: {
      ...record.meta,
      updatedAt: Date.now()
    }
  }
  await setVaultRecord(nextRecord)
  return nextRecord
}

