const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function bytesToBase64(bytes) {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function base64ToBytes(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function deriveAesKeyFromPassword({
  password,
  salt,
  iterations
}) {
  const material = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  )

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

export async function encryptJson({ key, value }) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = textEncoder.encode(JSON.stringify(value))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext)
  )

  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext)
  }
}

export async function decryptJson({ key, ivBase64, ciphertextBase64 }) {
  const iv = base64ToBytes(ivBase64)
  const ciphertext = base64ToBytes(ciphertextBase64)
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext)
  )

  return JSON.parse(textDecoder.decode(plaintext))
}

