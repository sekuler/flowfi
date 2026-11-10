import { useEffect } from "react";

// Landing sections below the fold slide up softly as they scroll into view.
const TARGETS = [
  ".ff-eco-title",
  ".ff-eco-panel",
  ".ff-why > h2",
  ".ff-why-sub",
  ".ff-why-card",
  ".ff-sec-head",
  ".ff-safe-item",
  ".ff-faq-item",
  ".ff-show > *",
  ".ff-cta > h2",
  ".ff-cta > p",
  ".ff-cta > .ff-cta-btns",
].join(",");

const CSS = `
.ff-rv { opacity: 0; transform: translateY(28px); }
.ff-rv-in { opacity: 1; transform: none; transition: opacity .7s ease-out, transform .7s cubic-bezier(.2,.7,.2,1); transition-delay: var(--ff-rv-delay, 0s); }
`;

export default function LandingReveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    // Only hide what is still below the screen, so nothing already visible blinks.
    const els = Array.from(document.querySelectorAll<HTMLElement>(TARGETS)).filter(
      (el) => el.getBoundingClientRect().top > window.innerHeight
    );
    // Cards sitting side by side come in one after another.
    const seen = new Map<Element, number>();
    els.forEach((el) => {
      const parent = el.parentElement;
      const i = parent ? seen.get(parent) ?? 0 : 0;
      if (parent) seen.set(parent, i + 1);
      el.style.setProperty("--ff-rv-delay", `${Math.min(i, 4) * 0.12}s`);
      el.classList.add("ff-rv");
    });
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const el = e.target as HTMLElement;
          el.classList.add("ff-rv-in");
          io.unobserve(el);
          // Once shown, step aside so the element's own hover effects run at full speed.
          const done = (ev: TransitionEvent) => {
            if (ev.target !== el || ev.propertyName !== "transform") return;
            el.removeEventListener("transitionend", done);
            el.classList.remove("ff-rv", "ff-rv-in");
          };
          el.addEventListener("transitionend", done);
        });
      },
      { rootMargin: "0px 0px -8% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      els.forEach((el) => el.classList.remove("ff-rv", "ff-rv-in"));
    };
  }, []);

  return <style>{CSS}</style>;
}
