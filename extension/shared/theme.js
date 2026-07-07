const THEME_STORAGE_KEY = "themePreference"

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve))
}

function storageSet(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve))
}

const THEME_VALUES = ["auto", "light", "dark"]

function normalizeThemePreference(value) {
  const v = String(value ?? "").trim().toLowerCase()
  return THEME_VALUES.includes(v) ? v : "auto"
}

async function getThemePreference() {
  const result = await storageGet([THEME_STORAGE_KEY])
  return normalizeThemePreference(result?.[THEME_STORAGE_KEY])
}

async function setThemePreference(pref) {
  const next = normalizeThemePreference(pref)
  await storageSet({ [THEME_STORAGE_KEY]: next })
  applyThemePreference(next)
  return next
}

function applyThemePreference(pref) {
  const next = normalizeThemePreference(pref)
  document.documentElement.dataset.theme = next
  return next
}

function nextThemePreference(current) {
  const cur = normalizeThemePreference(current)
  const idx = THEME_VALUES.indexOf(cur)
  return THEME_VALUES[(idx + 1) % THEME_VALUES.length]
}

function themeLabel(pref) {
  const p = normalizeThemePreference(pref)
  if (p === "light") return { short: "L", long: "Light" }
  if (p === "dark") return { short: "D", long: "Dark" }
  return { short: "A", long: "System" }
}

function applyThemeButtonState(buttonEl, pref) {
  const label = themeLabel(pref)
  buttonEl.textContent = label.short
  buttonEl.setAttribute("title", `Theme: ${label.long}`)
  buttonEl.setAttribute("aria-label", `Theme: ${label.long}`)
}

async function initTheme({ buttonEl, buttonEls, onChange } = {}) {
  let current = await getThemePreference()
  current = applyThemePreference(current)

  const buttons = []
  if (buttonEl) buttons.push(buttonEl)
  if (Array.isArray(buttonEls)) buttons.push(...buttonEls.filter(Boolean))

  for (const btn of buttons) applyThemeButtonState(btn, current)

  for (const btn of buttons) {
    btn.addEventListener("click", async (e) => {
      e.preventDefault()
      e.stopPropagation()
      const next = nextThemePreference(current)
      current = await setThemePreference(next)
      for (const b of buttons) applyThemeButtonState(b, current)
      if (onChange) onChange(current)
    })
  }

  return {
    get: () => current,
    set: async (pref) => {
      current = await setThemePreference(pref)
      for (const b of buttons) applyThemeButtonState(b, current)
      if (onChange) onChange(current)
      return current
    }
  }
}

export { THEME_STORAGE_KEY, THEME_VALUES, applyThemePreference, getThemePreference, initTheme, nextThemePreference, normalizeThemePreference, setThemePreference }
