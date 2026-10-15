/** Reversible scroll reveals. Never remount content or touch form state. */
export function useImmersiveMotion() {
  onMounted(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let observer: IntersectionObserver | undefined;
    const seen = new Set<Element>();
    const reveal = () => {
      if (!observer) return;
      seen.forEach((element) => {
        if (element.isConnected) return;
        observer!.unobserve(element);
        seen.delete(element);
      });
      document.querySelectorAll('#content .panel, #content .hero, #content .guided-path').forEach((element) => {
        if (seen.has(element)) return;
        seen.add(element);
        element.classList.add('reveal-ready');
        observer!.observe(element);
      });
    };
    observer = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting, boundingClientRect }) => {
        // Keep the exit direction until re-entry: panels return from the edge
        // through which they left, including when the user scrolls back up.
        if (!isIntersecting) {
          (target as HTMLElement).style.setProperty('--reveal-offset', boundingClientRect.bottom <= 0 ? '-28px' : '28px');
        }
        target.classList.toggle('is-revealed', isIntersecting || preference.matches);
      });
    }, { threshold: 0, rootMargin: '0px' });
    const mutations = new MutationObserver(reveal);
    mutations.observe(document.body, { childList: true, subtree: true });
    const reduce = () => {
      if (preference.matches) document.querySelectorAll('.reveal-ready').forEach((el) => el.classList.add('is-revealed'));
      else {
        seen.forEach((element) => {
          observer!.unobserve(element);
          observer!.observe(element);
        });
        reveal();
      }
    };
    preference.addEventListener('change', reduce);
    reveal();
    onUnmounted(() => {
      observer?.disconnect();
      mutations.disconnect();
      preference.removeEventListener('change', reduce);
    });
  });
}
