// CONFIGURATIONS - REPLACE THESE WITH YOUR OWN API ENDPOINTS
const CONFIG = {
    // 1. Google Sheets Web App URL (Deploy google-apps-script.js as a Web App in script.google.com and paste URL here)
    GOOGLE_SHEET_API_URL: "https://script.google.com/macros/s/AKfycbzXXXXXXXXXXXXX/exec",
    
    // 2. Cloudinary Unsigned Upload Configuration for Career page resume uploads
    CLOUDINARY_URL: "https://api.cloudinary.com/v1_1/YOUR_CLOUD_NAME/upload",
    CLOUDINARY_UPLOAD_PRESET: "YOUR_UNSIGNED_PRESET"
};

document.addEventListener("DOMContentLoaded", () => {
    // 1. STICKY NAVBAR SCROLL
    const navbar = document.querySelector(".navbar-custom");
    if (navbar) {
        window.addEventListener("scroll", () => {
            if (window.scrollY > 50) {
                navbar.classList.add("scrolled");
            } else {
                navbar.classList.remove("scrolled");
            }
        });
    }

    // 1.5. MOBILE SIDEBAR DRAWER GENERATION & TOGGLING
    const toggler = document.querySelector(".navbar-toggler");
    if (navbar && toggler) {
        // Create Sidebar Drawer elements dynamically to avoid editing all HTML files
        const logoImg = navbar.querySelector(".navbar-brand img");
        const logoSrc = logoImg ? logoImg.getAttribute("src") : "images/logo.png";
        
        // Build Drawer HTML
        const drawer = document.createElement("div");
        drawer.className = "mobile-sidebar-drawer";
        drawer.innerHTML = `
            <button class="mobile-sidebar-close" aria-label="Close menu">&times;</button>
            <div class="mobile-sidebar-header">
                <img src="${logoSrc}" alt="Raj Real Estate Logo">
            </div>
            <ul class="mobile-sidebar-nav"></ul>
        `;
        
        const overlay = document.createElement("div");
        overlay.className = "mobile-sidebar-overlay";
        
        document.body.appendChild(drawer);
        document.body.appendChild(overlay);
        
        const sidebarNav = drawer.querySelector(".mobile-sidebar-nav");
        const closeBtn = drawer.querySelector(".mobile-sidebar-close");
        
        // Clone links from navbar to mobile sidebar
        const navLinks = navbar.querySelectorAll(".navbar-nav .nav-link");
        navLinks.forEach(link => {
            const li = document.createElement("li");
            const clonedLink = link.cloneNode(true);
            clonedLink.className = "nav-link" + (link.classList.contains("active") ? " active" : "");
            li.appendChild(clonedLink);
            sidebarNav.appendChild(li);
        });
        
        // Toggle Sidebar Function
        const toggleSidebar = (show) => {
            if (show) {
                drawer.classList.add("active");
                overlay.classList.add("active");
                document.body.style.overflow = "hidden";
            } else {
                drawer.classList.remove("active");
                overlay.classList.remove("active");
                document.body.style.overflow = "";
            }
        };
        
        // Listeners
        toggler.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleSidebar(true);
        });
        
        closeBtn.addEventListener("click", () => toggleSidebar(false));
        overlay.addEventListener("click", () => toggleSidebar(false));
    }

    // 2. COUNTER ANIMATION
    const counters = document.querySelectorAll(".counter-value");
    if (counters.length > 0) {
        const runCounters = () => {
            counters.forEach(counter => {
                const target = +counter.getAttribute("data-target");
                let count = 0;
                const speed = target / 50;
                const updateCount = () => {
                    if (count < target) {
                        count = Math.ceil(count + speed);
                        counter.innerText = count > target ? target : count;
                        setTimeout(updateCount, 30);
                    } else {
                        counter.innerText = target;
                    }
                };
                updateCount();
            });
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    runCounters();
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.5 });

        const counterSection = document.querySelector(".counter-section");
        if (counterSection) {
            observer.observe(counterSection);
        }
    }

    // 3. SMOOTH REVEAL SCROLLING (IntersectionObserver)
    const revealElements = document.querySelectorAll(".reveal");
    if (revealElements.length > 0) {
        const revealObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add("active");
                    revealObserver.unobserve(entry.target); // Reveal once
                }
            });
        }, {
            threshold: 0.1,
            rootMargin: "0px 0px -50px 0px"
        });

        revealElements.forEach(el => {
            revealObserver.observe(el);
        });
    }

    // 4. IMPROVED POPUP ADVERTISEMENT
    // const popupOverlay = document.getElementById("adPopupOverlay");
    // const popupContent = document.querySelector(".ad-popup-content");
    // if (popupOverlay && popupContent) {
    //     const adShown = sessionStorage.getItem("adShown");
    //     if (!adShown) {
    //         popupOverlay.style.display = "flex";

    //         // Slideshow setup
    //         const slides = document.querySelectorAll(".popup-slide");
    //         const projects = [
    //             "projects/neelkanth-nagar.html",
    //             "projects/riyasat-bliss.html",
    //             "projects/aerocrystal.html",
    //             "projects/riyasat-paradise-ii.html",
    //             "projects/riyasat-ecopark.html",
    //             "projects/happy-aerocity.html",
    //             "projects/heritage.html",
    //             "projects/the-riyasat-sankalp.html",
    //             "projects/riyasat-royalcrest.html",
    //             "projects/riyasat-montera.html"
    //         ];

    //         let activeIndex = 0;

    //         if (slides.length > 1) {
    //             setInterval(() => {
    //                 slides[activeIndex].classList.remove("active");
    //                 activeIndex = (activeIndex + 1) % slides.length;
    //                 slides[activeIndex].classList.add("active");
    //             }, 2000);
    //         }

    //         // Close button 5s delay
    //         setTimeout(() => {
    //             const closeBtn = document.getElementById("adPopupClose");
    //             if (closeBtn) {
    //                 closeBtn.style.display = "flex";
    //             }
    //         }, 5000);

    //         // One-click redirect on the entire popup (excluding close button)
    //         popupContent.addEventListener("click", (e) => {
    //             if (e.target.id === "adPopupClose") return;

    //             // Open the page of the currently visible project
    //             window.location.href = projects[activeIndex];
    //         });
    //     }

    //     const closeBtn = document.getElementById("adPopupClose");
    //     if (closeBtn) {
    //         closeBtn.addEventListener("click", (e) => {
    //             e.stopPropagation(); // Stop click from bubbling to popupContent redirect
    //             popupOverlay.style.display = "none";
    //             sessionStorage.setItem("adShown", "true");
    //         });
    //     }
    // }

    // 5. FORM SUBMISSION
    const forms = document.querySelectorAll(".sheet-form");
    
    forms.forEach(form => {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
    
            const submitBtn = form.querySelector('button[type="submit"]');
            const originalBtnText = submitBtn.innerHTML;
    
            submitBtn.disabled = true;
            submitBtn.innerHTML =
                `<span class="spinner-border spinner-border-sm me-2" role="status"></span>Saving...`;
    
            let feedback = form.querySelector(".form-feedback");
    
            if (!feedback) {
                feedback = document.createElement("div");
                feedback.className = "form-feedback mt-3 alert d-none";
                form.appendChild(feedback);
            }
    
            feedback.className = "form-feedback mt-3 alert alert-info";
            feedback.innerText = "Submitting...";
    
            try {
                const formData = new FormData(form);
                const dataObj = {};
    
                formData.forEach((value, key) => {
                    // Don't send the actual file object as JSON
                    if (!(value instanceof File)) {
                        dataObj[key] = value;
                    }
                });
    
                // Add project name if present on the page
                if (document.body.getAttribute("data-project-name")) {
                    dataObj.projectName =
                        document.body.getAttribute("data-project-name");
                }
    
                // Add source page
                dataObj.sourcePage =
                    window.location.pathname.split("/").pop() || "index.html";
    
                // Render backend URL
                const BACKEND_URL =
                    "https://raj-real-estate.onrender.com";
    
                // Decide whether this is a career or inquiry form
                const isCareer =
                    window.location.pathname.toLowerCase().includes("career");
    
                const url = isCareer
                    ? `${BACKEND_URL}/api/career`
                    : `${BACKEND_URL}/api/inquiry`;
    
                // Submit to Render backend
                const response = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(dataObj)
                });
    
                const result = await response.json();
    
                if (!response.ok || !result.success) {
                    throw new Error(
                        result.error || "Submission failed."
                    );
                }
    
                feedback.className =
                    "form-feedback mt-3 alert alert-success";
                feedback.innerText =
                    "Success! Your submission has been recorded.";
    
                form.reset();
    
                console.log("Form submitted successfully:", result);
    
            } catch (err) {
                console.error("Form submission error:", err);
    
                feedback.className =
                    "form-feedback mt-3 alert alert-danger";
    
                feedback.innerText =
                    "Error submitting form. Please try again.";
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnText;
            }
        });
    });
