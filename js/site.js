const CMS_API_BASE_URL = window.location.origin;
let cmsCloudinaryCloudName = "";

function newSubmissionKey() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return [...crypto.getRandomValues(new Uint8Array(16))]
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

function cmsApiUrl(path) {
    return `${CMS_API_BASE_URL.replace(/\/$/, "")}/api/cms${path}`;
}

function normalizeCmsImagePath(value, cloudName = cmsCloudinaryCloudName) {
    if (typeof value !== "string") return "";
    if (/^\/(?:images|uploads)\/[A-Za-z0-9._/-]+$/.test(value) &&
        !value.includes("..") && !value.includes("//") &&
        /\.(?:png|jpe?g|gif|webp)$/i.test(value)) {
        return value;
    }
    try {
        const url = new URL(value);
        return url.protocol === "https:" &&
            url.hostname === "res.cloudinary.com" &&
            !url.username && !url.password && !url.port && !url.search && !url.hash &&
            /^[a-z0-9][a-z0-9_-]{0,63}$/.test(cloudName) &&
            url.pathname.startsWith(`/${cloudName}/image/upload/`) &&
            /^\/[A-Za-z0-9._/-]+\.(?:png|jpe?g|webp)$/i.test(url.pathname) &&
            !url.pathname.includes("..") && !url.pathname.includes("//")
            ? value
            : "";
    } catch {
        return "";
    }
}

function cmsElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function projectCard(project, featured) {
    const column = cmsElement("div", featured ? "col-lg-4 col-md-6" : "col-lg-4 col-md-6 project-card animate-card");
    if (!featured) {
        column.dataset.city = project.category || "";
        column.dataset.location = [project.location_label, project.location]
            .filter(Boolean)
            .join(" ");
    }

    const card = cmsElement("div", "luxury-card");
    if (project.card_image) {
        const imageWrapper = cmsElement("div", "card-img-wrapper");
        const image = cmsElement("img");
        image.src = normalizeCmsImagePath(project.card_image);
        image.alt = project.name;
        imageWrapper.append(image);
        card.append(imageWrapper);
    }

    const content = cmsElement("div", "p-4");
    const labels = cmsElement("div", "d-flex justify-content-between align-items-center mb-3");
    labels.append(
        cmsElement("span", "badge bg-light text-dark text-uppercase", project.location_label),
        cmsElement("span", "text-gold small", project.location)
    );
    const heading = cmsElement("h4", "mb-3", project.name);
    const action = cmsElement("div", "d-flex justify-content-end align-items-center");
    const link = cmsElement("a", featured ? "btn btn-sm btn-luxury" : "btn btn-luxury btn-sm", featured ? "Know More" : "Explore");
    link.href = project.page_path;
    action.append(link);

    content.append(labels, heading);
    if (project.summary) content.append(cmsElement("p", featured ? "text-muted small mb-4" : "text-muted small mb-4", project.summary));
    if (!featured) content.append(cmsElement("hr", "border-light"));
    content.append(action);
    card.append(content);
    column.append(card);
    return column;
}

function updateProjectDetail(project) {
    document.title = project.page_title || `${project.name} | RAJ REAL ESTATE`;
    const description = document.querySelector('meta[name="description"]');
    if (description && project.seo_description) description.content = project.seo_description;
    document.body.dataset.projectName = project.name;

    const title = document.querySelector("main h1, body > section h1");
    if (title) title.textContent = project.name;
    const banner = title?.closest("section");
    const locationLabel = banner?.querySelector(".text-gold");
    if (locationLabel && (project.banner_label || project.location_label)) {
        locationLabel.textContent = project.banner_label || project.location_label;
    }

    const descriptionHeading = [...document.querySelectorAll("h3")].find(element =>
        element.textContent.trim().toLowerCase() === "project description"
    ) || document.querySelector("#villa h3");
    const descriptionText = descriptionHeading?.nextElementSibling;
    if (descriptionText?.tagName === "P" && project.description) {
        descriptionText.textContent = project.description;
    }

    const galleryHeading = [...document.querySelectorAll("h3, h4")].find(element =>
        element.textContent.trim().toLowerCase().includes("gallery")
    );
    const galleryGrid = galleryHeading?.nextElementSibling;
    if (galleryGrid?.classList.contains("row") &&
        document.body.dataset.cmsDynamicProject !== "true") {
        const columns = [...galleryGrid.children];
        project.gallery.forEach((imagePath, index) => {
            let column = columns[index];
            if (!column) {
                column = cmsElement("div", "col-md-3 col-6");
                const wrapper = cmsElement("div", "gallery-wrapper border");
                wrapper.style.cursor = "pointer";
                wrapper.style.overflow = "hidden";
                wrapper.style.height = "120px";
                wrapper.dataset.bsToggle = "modal";
                wrapper.dataset.bsTarget = "#galleryModal";
                const image = cmsElement("img", "w-100 h-100");
                image.style.objectFit = "cover";
                wrapper.append(image);
                column.append(wrapper);
                galleryGrid.append(column);
                columns.push(column);
            }

            const image = column.querySelector("img");
            if (!image) return;
            const source = normalizeCmsImagePath(imagePath);
            if (!source) return;
            image.src = source;
            image.alt = `${project.name} gallery image ${index + 1}`;
            const wrapper = image.closest(".gallery-wrapper");
            if (wrapper) wrapper.onclick = () => window.setModalImage?.(source);
        });
        columns.slice(project.gallery.length).forEach(column => column.remove());
        if (galleryHeading) galleryHeading.hidden = project.gallery.length === 0;
        galleryGrid.hidden = project.gallery.length === 0;
    }

    const layoutImage = [...document.querySelectorAll("img")].find(image =>
        image.alt.toLowerCase().includes("layout map")
    );
    if (layoutImage && project.layout_image) {
        const source = normalizeCmsImagePath(project.layout_image);
        if (source) layoutImage.src = source;
        const wrapper = layoutImage.closest(".gallery-wrapper");
        if (wrapper && source) wrapper.onclick = () => window.setModalImage?.(source);
    }

    const amenitiesHeading = [...document.querySelectorAll("h3, h4")].find(element =>
        /amenit/i.test(element.textContent)
    );
    const amenitiesGrid = amenitiesHeading?.nextElementSibling;
    if (amenitiesGrid?.classList.contains("row") && project.amenities.length) {
        amenitiesGrid.replaceChildren(...project.amenities.map(amenity => {
            const column = cmsElement("div", "col-md-4 col-6");
            const card = cmsElement("div", "amenity-card");
            const icon = cmsElement("i");
            icon.className = `bi ${amenity.icon}`;
            card.append(icon, cmsElement("h6", "mb-0", amenity.label));
            column.append(card);
            return column;
        }));
    }

    const videoLink = [...document.querySelectorAll('a[href*="youtube.com"], a[href*="youtu.be"]')][0];
    if (videoLink && project.video_url) videoLink.href = project.video_url;

    document.querySelectorAll('input[name="projectName"]').forEach(input => {
        input.value = project.name;
    });
}

function applyPageMetadata(page) {
    document.title = page.seo_title || page.title;
    const description = document.querySelector('meta[name="description"]');
    if (description && page.seo_description) description.content = page.seo_description;

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.content = page.seo_title || page.title;
    const ogDescription = document.querySelector('meta[property="og:description"]');
    if (ogDescription && page.seo_description) ogDescription.content = page.seo_description;

    Object.entries(page.content || {}).forEach(([key, value]) => {
        document.querySelectorAll(`[data-cms-field="${CSS.escape(key)}"]`).forEach(element => {
            element.textContent = value;
        });
        document.querySelectorAll(`img[data-cms-image="${CSS.escape(key)}"]`).forEach(image => {
            if (value) image.src = normalizeCmsImagePath(value);
        });
    });
}

function applySharedContactSettings(settings) {
    const labels = {
        officeAddress: "",
        phone: "Office Desk: ",
        whatsapp: "WhatsApp: ",
        email: "",
        businessHours: ""
    };
    document.querySelectorAll("[data-cms-setting]").forEach(element => {
        const key = element.dataset.cmsSetting;
        if (settings[key]) element.textContent = `${labels[key] || ""}${settings[key]}`;
    });

    document.querySelectorAll(".luxury-footer p").forEach(paragraph => {
        const icon = paragraph.querySelector("i");
        const iconClass = icon?.className || "";
        let value = "";
        let label = "";
        if (iconClass.includes("bi-geo-alt")) value = settings.officeAddress || "";
        else if (iconClass.includes("bi-telephone")) {
            value = settings.phone || "";
            label = "Phone: ";
        } else if (iconClass.includes("bi-whatsapp")) {
            value = settings.whatsapp || "";
            label = "WhatsApp: ";
        } else if (iconClass.includes("bi-envelope")) {
            value = settings.email || "";
            label = "Email: ";
        }
        if (!value) return;
        paragraph.replaceChildren(icon, document.createTextNode(` ${label}${value}`));
    });

    const phone = (settings.phone || "").replace(/[^\d+]/g, "");
    const whatsapp = (settings.whatsapp || "").replace(/\D/g, "");
    document.querySelectorAll('.sticky-contact-bar a[href^="tel:"]').forEach(link => {
        if (phone) link.href = `tel:${phone}`;
    });
    document.querySelectorAll(".sticky-contact-bar .sticky-whatsapp").forEach(link => {
        if (whatsapp) link.href = `https://wa.me/${whatsapp}`;
    });
}

async function initializeCmsPublicContent() {
    const isDynamicProject = document.body.dataset.cmsDynamicProject === "true";
    const isProjectsPage = ["/projects", "/projects/jaipur", "/projects/navi-mumbai"]
        .includes(window.location.pathname);
    const projectPath = isProjectsPage
        ? null
        : window.location.pathname.match(/^\/projects\/([a-z0-9-]+)(?:\.html)?$/i);

    if (isDynamicProject && projectPath) {
        const response = await fetch(cmsApiUrl(`/public/projects/${encodeURIComponent(projectPath[1])}`));
        if (!response.ok) throw new Error("Project content is unavailable.");
        const result = await response.json();
        cmsCloudinaryCloudName = result.cloudinaryCloudName || "";
        const { project } = result;
        const container = document.getElementById("cmsProjectContent");
        container.replaceChildren();

        const hero = cmsElement("section", "py-5 bg-dark text-light");
        const heroContent = cmsElement("div", "container py-5 text-center");
        heroContent.append(
            cmsElement("span", "text-gold text-uppercase fw-bold mb-3 d-inline-block", project.banner_label || project.location_label),
            cmsElement("h1", "display-4 text-uppercase text-white mb-3", project.name),
            cmsElement("p", "lead text-light", project.summary)
        );
        hero.append(heroContent);

        const details = cmsElement("section", "py-5");
        const content = cmsElement("div", "container");
        content.append(cmsElement("p", "text-muted", project.location));
        const description = project.description || project.summary;
        if (description) content.append(cmsElement("p", "lead", description));
        if (project.card_image) {
            const cover = cmsElement("img", "img-fluid mb-4");
            cover.src = normalizeCmsImagePath(project.card_image);
            cover.alt = project.name;
            content.append(cover);
        }
        if (project.gallery.length) {
            content.append(cmsElement("h2", "text-uppercase mb-4", "Project Gallery"));
            const gallery = cmsElement("div", "row g-3 mb-5");
            project.gallery.forEach((source, index) => {
                const column = cmsElement("div", "col-md-3 col-6");
                const image = cmsElement("img", "img-fluid w-100");
                image.src = normalizeCmsImagePath(source);
                image.alt = `${project.name} gallery image ${index + 1}`;
                column.append(image);
                gallery.append(column);
            });
            content.append(gallery);
        }
        if (project.layout_image || project.map_image) {
            const layout = cmsElement("img", "img-fluid d-block mx-auto mb-5");
            layout.src = normalizeCmsImagePath(project.layout_image || project.map_image);
            layout.alt = "Project layout";
            content.append(cmsElement("h2", "text-uppercase mb-4", "Site Layout"), layout);
        }
        if (project.amenities.length) {
            content.append(cmsElement("h2", "text-uppercase mb-4", "Amenities"));
            const amenities = cmsElement("div", "row g-3 mb-5");
            project.amenities.forEach(amenity => {
                const column = cmsElement("div", "col-md-4 col-6");
                const card = cmsElement("div", "amenity-card");
                const icon = cmsElement("i");
                icon.className = `bi ${amenity.icon}`;
                card.append(icon, cmsElement("h6", "mb-0", amenity.label));
                column.append(card);
                amenities.append(column);
            });
            content.append(amenities);
        }
        if (project.video_url) {
            const videoLink = cmsElement("a", "btn btn-luxury", "Watch project tour");
            videoLink.href = project.video_url;
            videoLink.target = "_blank";
            videoLink.rel = "noopener noreferrer";
            content.append(videoLink);
        }
        details.append(content);
        const enquirySection = cmsElement("section", "py-5 bg-light");
        const enquiryContainer = cmsElement("div", "container");
        const enquiryCard = cmsElement("div", "p-4 p-md-5 bg-white border shadow-sm");
        enquiryCard.append(
            cmsElement("h2", "text-uppercase mb-3", "Project Enquiry"),
            cmsElement("p", "text-muted small", "Submit your details to request a callback.")
        );
        const enquiryForm = cmsElement("form", "sheet-form");
        enquiryForm.dataset.sourceForm = `${project.name} Enquiries`;
        for (const [name, value] of [
            ["formType", enquiryForm.dataset.sourceForm],
            ["projectName", project.name]
        ]) {
            const hidden = cmsElement("input");
            hidden.type = "hidden";
            hidden.name = name;
            hidden.value = value;
            enquiryForm.append(hidden);
        }
        for (const [name, type, placeholder] of [
            ["name", "text", "Full Name"],
            ["phone", "tel", "Contact No."],
            ["email", "email", "Email Address"]
        ]) {
            const field = cmsElement("input", "form-control rounded-0");
            field.type = type;
            field.name = name;
            field.placeholder = placeholder;
            field.required = true;
            const wrapper = cmsElement("div", "mb-3");
            wrapper.append(field);
            enquiryForm.append(wrapper);
        }
        const submitButton = cmsElement(
            "button",
            "btn btn-luxury w-100 py-3 text-uppercase",
            "Request Callback"
        );
        submitButton.type = "submit";
        enquiryForm.append(submitButton);
        enquiryCard.append(enquiryForm);
        enquiryContainer.append(enquiryCard);
        enquirySection.append(enquiryContainer);
        container.append(hero, details, enquirySection);
        updateProjectDetail(project);
        return;
    }

    const isBlogPage = window.location.pathname === "/blog.html" ||
        window.location.pathname === "/blog-post.html" ||
        window.location.pathname === "/blog" ||
        window.location.pathname === "/blog/" ||
        /^\/blog\/[a-z0-9-]+$/i.test(window.location.pathname);
    const isProjectDetail = Boolean(projectPath);
    const pageSlug = isProjectsPage
        ? "projects"
        : window.location.pathname.replace(/^\/|\.html$/g, "") || "index";
    const [pageResponse, settingsResponse] = await Promise.all([
        isBlogPage || isProjectDetail ? Promise.resolve(null) :
            fetch(cmsApiUrl(`/public/pages/${encodeURIComponent(pageSlug)}`)),
        fetch(cmsApiUrl("/public/settings"))
    ]);

    if (pageResponse?.ok) {
        const result = await pageResponse.json();
        cmsCloudinaryCloudName = result.cloudinaryCloudName || "";
        const { page } = result;
        applyPageMetadata(page);
    }
    if (settingsResponse.ok) {
        const { settings } = await settingsResponse.json();
        applySharedContactSettings(settings);
    }

    const projectsResponse = await fetch(cmsApiUrl("/public/projects"));
    if (!projectsResponse.ok) throw new Error("Published projects are unavailable.");
    const projectResult = await projectsResponse.json();
    cmsCloudinaryCloudName = projectResult.cloudinaryCloudName || "";
    const { projects } = projectResult;

    if (isProjectsPage) {
        const grid = document.getElementById("projectsGrid");
        if (grid) {
            grid.replaceChildren(...projects.map(project => projectCard(project, false)));
            window.dispatchEvent(new Event("cms:projects-updated"));
        }
    }

    const featuredHeading = [...document.querySelectorAll("h2")].find(element =>
        element.textContent.trim() === "Featured Listings"
    );
    const featuredRow = featuredHeading?.closest("section")?.querySelector(".row.g-4");
    if (featuredRow) {
        const featuredProjects = projects.filter(project => project.featured);
        if (featuredProjects.length) {
            featuredRow.replaceChildren(...featuredProjects.map(project => projectCard(project, true)));
        }
    }

    if (projectPath) {
        const response = await fetch(cmsApiUrl(`/public/projects/${encodeURIComponent(projectPath[1])}`));
        if (!response.ok) {
            document.body.replaceChildren(cmsElement("main", "container py-5", "This project is not available."));
            return;
        }
        const result = await response.json();
        cmsCloudinaryCloudName = result.cloudinaryCloudName || "";
        const { project } = result;
        updateProjectDetail(project);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initializeCmsPublicContent().catch(error => {
        console.error("CMS content could not be loaded; the static page content remains visible.", error);
    });

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
        const navLinks = navbar.querySelectorAll(".navbar-nav .nav-link, .navbar-nav .dropdown-item");
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

    const careerForm = document.getElementById("careerForm");
    if (careerForm) {
        careerForm.addEventListener("submit", async event => {
            event.preventDefault();
            if (careerForm.dataset.submitting === "true" || !careerForm.reportValidity()) return;

            const submitButton = careerForm.querySelector('button[type="submit"]');
            const originalButtonText = submitButton.textContent;
            let feedback = careerForm.querySelector(".form-feedback");
            if (!feedback) {
                feedback = document.createElement("div");
                feedback.className = "form-feedback mt-3 alert";
                feedback.setAttribute("role", "status");
                feedback.setAttribute("aria-live", "polite");
                careerForm.append(feedback);
            }

            const fieldValue = name =>
                careerForm.querySelector(`[name="${name}"]`)?.value?.trim() || "";
            const payload = {
                name: fieldValue("name"),
                phone: fieldValue("phone"),
                email: fieldValue("email"),
                address: fieldValue("address"),
                qualification: fieldValue("qualification"),
                experience: fieldValue("experience"),
                appliedPosition: fieldValue("appliedPosition"),
                resumeUrl: fieldValue("resumeUrl"),
                coverLetter: fieldValue("coverLetter")
            };

            careerForm.dataset.submissionKey ||= newSubmissionKey();
            careerForm.dataset.submitting = "true";
            submitButton.disabled = true;
            submitButton.textContent = "Submitting...";
            feedback.className = "form-feedback mt-3 alert alert-info";
            feedback.textContent = "Submitting your application...";

            try {
                const response = await fetch(`${CMS_API_BASE_URL.replace(/\/$/, "")}/api/career`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Idempotency-Key": careerForm.dataset.submissionKey
                    },
                    body: JSON.stringify(payload)
                });
                let result;
                try {
                    result = await response.json();
                } catch {
                    throw new Error(`The server returned an invalid response (HTTP ${response.status}).`);
                }
                if (!response.ok || result.success !== true) {
                    throw new Error(result.error || `The application could not be submitted (HTTP ${response.status}).`);
                }

                careerForm.reset();
                delete careerForm.dataset.submissionKey;
                feedback.className = "form-feedback mt-3 alert alert-success";
                feedback.textContent = result.sheets?.status === "sent"
                    ? "Thank you. Your application has been saved and sent to our team."
                    : "Thank you. Your application has been saved; spreadsheet sync is pending.";
            } catch (error) {
                feedback.className = "form-feedback mt-3 alert alert-danger";
                feedback.textContent = error instanceof TypeError
                    ? "We could not reach the server. Check your connection and try again."
                    : error.message;
            } finally {
                careerForm.dataset.submitting = "false";
                submitButton.disabled = false;
                submitButton.textContent = originalButtonText;
            }
        });
    }

document.addEventListener("submit", async event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches(".sheet-form") ||
        form.id === "careerForm" ||
        !form.querySelector('[name="name"]') ||
        !form.querySelector('[name="phone"]')) {
        return;
    }

    event.preventDefault();
    if (form.dataset.submitting === "true" || !form.reportValidity()) return;

        const submitButtons = [...form.querySelectorAll('button[type="submit"], input[type="submit"]')];
        const originalButtonContent = submitButtons.map(button => button.innerHTML);
        const thankYou = form.querySelector(".thank-you-message");
        if (thankYou) thankYou.style.display = "none";
        let feedback = form.querySelector(".form-feedback");
        if (!feedback) {
            feedback = document.createElement("div");
            feedback.className = "form-feedback mt-3 alert";
            feedback.setAttribute("role", "status");
            feedback.setAttribute("aria-live", "polite");
            form.append(feedback);
        }
        feedback.className = "form-feedback mt-3 alert alert-info";
        feedback.textContent = "Submitting your enquiry...";
        form.dataset.submitting = "true";
        submitButtons.forEach(button => {
            button.disabled = true;
            if (button.tagName === "BUTTON") button.textContent = "Submitting...";
        });

        const value = name => form.querySelector(`[name="${name}"]`)?.value?.trim() || "";
        const payload = {
            name: value("name"),
            phone: value("phone"),
            email: value("email"),
            message: value("message"),
            projectName: value("projectName") || document.body.dataset.projectName || "",
            sourceForm: value("formType") || form.dataset.sourceForm || "Website enquiry",
            sourcePage: window.location.pathname
        };

        form.dataset.submissionKey ||= newSubmissionKey();
        try {
            const response = await fetch(`${CMS_API_BASE_URL.replace(/\/$/, "")}/api/inquiry`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Idempotency-Key": form.dataset.submissionKey
                },
                body: JSON.stringify(payload)
            });
            let result;
            try {
                result = await response.json();
            } catch {
                throw new Error(`The server returned an invalid response (HTTP ${response.status}).`);
            }
            if (!response.ok || result.success !== true) {
                throw new Error(result.error || `The enquiry could not be saved (HTTP ${response.status}).`);
            }

            form.reset();
            delete form.dataset.submissionKey;
            feedback.className = "form-feedback mt-3 alert alert-success";
            feedback.textContent = result.sheets?.status === "sent"
                ? "Thank you. Your enquiry has been saved and sent to our team."
                : "Thank you. Your enquiry has been saved; spreadsheet sync is pending.";
        } catch (error) {
            feedback.className = "form-feedback mt-3 alert alert-danger";
            feedback.textContent = error instanceof TypeError
                ? "We could not reach the server. Check your connection and try again."
                : error.message;
        } finally {
            form.dataset.submitting = "false";
            submitButtons.forEach((button, index) => {
                button.disabled = false;
                button.innerHTML = originalButtonContent[index];
            });
        }
});
});
