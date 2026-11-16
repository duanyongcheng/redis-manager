const root = document.documentElement;
const toggle = document.querySelector(".theme-toggle");
const themeMeta = document.querySelector('meta[name="theme-color"]');
const STORAGE_KEY = "rm-site-scheme";
const THEME_COLOR = { light: "#fbfbfc", dark: "#101417" };

function applyScheme(scheme) {
  root.dataset.scheme = scheme;

  if (themeMeta) {
    themeMeta.setAttribute("content", THEME_COLOR[scheme] ?? THEME_COLOR.light);
  }

  for (const image of document.querySelectorAll("img[data-light][data-dark]")) {
    const next = scheme === "dark" ? image.dataset.dark : image.dataset.light;
    if (next && image.getAttribute("src") !== next) {
      image.setAttribute("src", next);
    }
  }

  if (toggle) {
    toggle.setAttribute("aria-pressed", String(scheme === "dark"));
    toggle.setAttribute("aria-label", scheme === "dark" ? "切换到浅色配色" : "切换到深色配色");
    toggle.setAttribute("title", scheme === "dark" ? "切换到浅色配色" : "切换到深色配色");
  }
}

function readStoredScheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

applyScheme(readStoredScheme());

toggle?.addEventListener("click", () => {
  const next = root.dataset.scheme === "dark" ? "light" : "dark";
  applyScheme(next);

  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* Storage can be unavailable in private contexts; the scheme still applies. */
  }
});

// Mark the nav item for the section currently under the top bar.
const navLinks = [...document.querySelectorAll(".nav a[href^='#']")];
const sections = navLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

let ticking = false;

function updateCurrentSection() {
  ticking = false;
  if (!sections.length) return;

  const offset = 96;
  let current = null;

  for (const section of sections) {
    if (section.getBoundingClientRect().top <= offset) current = section;
  }

  for (const link of navLinks) {
    if (current && link.getAttribute("href") === `#${current.id}`) {
      link.setAttribute("aria-current", "true");
    } else {
      link.removeAttribute("aria-current");
    }
  }
}

function scheduleUpdate() {
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(updateCurrentSection);
  }
}

if (sections.length) {
  updateCurrentSection();
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);
}
