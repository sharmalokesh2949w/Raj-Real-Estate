document.addEventListener("DOMContentLoaded", () => {
    const hero = document.querySelector(".home-hero");
    if (!hero) return;

    const slides = [...hero.querySelectorAll(".home-hero__slide")];
    const indicators = [...hero.querySelectorAll("[data-hero-slide-to]")];
    const title = document.getElementById("homeHeroTitle");
    const description = document.getElementById("homeHeroDescription");
    const eyebrow = document.getElementById("homeHeroEyebrow");
    const current = document.getElementById("homeHeroCurrent");
    const explore = document.getElementById("homeHeroExplore");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const interval = 6500;
    let activeIndex = 0;
    let timer;
    let interactionPaused = false;
    let temporarilyPaused = false;

    function showSlide(index) {
        activeIndex = (index + slides.length) % slides.length;
        const slide = slides[activeIndex];

        slides.forEach((item, itemIndex) => {
            const active = itemIndex === activeIndex;
            item.classList.toggle("is-active", active);
            item.setAttribute("aria-hidden", String(!active));
        });
        indicators.forEach((indicator, itemIndex) => {
            const active = itemIndex === activeIndex;
            indicator.classList.toggle("is-active", active);
            indicator.setAttribute("aria-pressed", String(active));
        });

        title.textContent = slide.dataset.projectName;
        description.textContent = slide.dataset.projectCopy;
        explore.href = "/projects";
        explore.setAttribute("aria-label", "Explore all projects");
        current.textContent = String(activeIndex + 1).padStart(2, "0");
        eyebrow.textContent = `FEATURED PROJECT / ${String(activeIndex + 1).padStart(2, "0")}`;

        const copy = hero.querySelector(".home-hero__copy");
        copy.classList.remove("home-hero__copy");
        void copy.offsetWidth;
        copy.classList.add("home-hero__copy");
    }

    function stopTimer() {
        window.clearInterval(timer);
        timer = undefined;
    }

    function startTimer() {
        stopTimer();
        if (reducedMotion.matches || interactionPaused || temporarilyPaused) return;
        timer = window.setInterval(() => showSlide(activeIndex + 1), interval);
    }

    hero.querySelectorAll("[data-hero-direction]").forEach(button => {
        button.addEventListener("click", () => {
            interactionPaused = true;
            showSlide(activeIndex + Number(button.dataset.heroDirection));
            stopTimer();
        });
    });

    indicators.forEach(button => {
        button.addEventListener("click", () => {
            interactionPaused = true;
            showSlide(Number(button.dataset.heroSlideTo));
            stopTimer();
        });
    });

    hero.addEventListener("pointerenter", () => {
        temporarilyPaused = true;
        stopTimer();
    });
    hero.addEventListener("pointerleave", () => {
        temporarilyPaused = false;
        startTimer();
    });
    hero.addEventListener("focusin", () => {
        temporarilyPaused = true;
        stopTimer();
    });
    hero.addEventListener("focusout", event => {
        if (!hero.contains(event.relatedTarget)) {
            temporarilyPaused = false;
            startTimer();
        }
    });
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) stopTimer();
        else startTimer();
    });
    reducedMotion.addEventListener?.("change", startTimer);

    showSlide(0);
    startTimer();
});
