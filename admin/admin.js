const API_ROOT = "/api/cms";
const state = {
    admin: null,
    projectPage: 1,
    projectPages: 1,
    searchTimer: null,
    inquiryPage: 1,
    inquiryPages: 1,
    inquirySearchTimer: null
};
const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById("projectModal"));

function notify(message, error = false) {
    const element = document.getElementById("notification");
    element.textContent = message;
    element.classList.toggle("error", error);
    element.classList.remove("d-none");
    window.clearTimeout(notify.timeout);
    notify.timeout = window.setTimeout(() => element.classList.add("d-none"), 5000);
}

function showLogin(message = "") {
    state.admin = null;
    document.getElementById("adminApp").classList.add("d-none");
    document.getElementById("loginScreen").classList.remove("d-none");
    document.getElementById("loginError").textContent = message;
}

function showAdmin(admin) {
    state.admin = admin;
    document.getElementById("loginScreen").classList.add("d-none");
    document.getElementById("adminApp").classList.remove("d-none");
    document.getElementById("adminEmail").textContent = admin.email;
}

async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData)) {
        headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${API_ROOT}${path}`, {
        credentials: "same-origin",
        ...options,
        headers
    });
    let payload = null;
    if (response.status !== 204 &&
        response.headers.get("content-type")?.includes("application/json")) {
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }
    }

    if (!response.ok) {
        if (response.status === 401 && !path.startsWith("/auth/login")) {
            showLogin("Your session ended. Sign in again to continue.");
        }
        if (response.status === 405 && path.startsWith("/auth/")) {
            throw new Error("This CMS page is being served by Live Server or another static server, which cannot handle sign-in. Stop Live Server, run `npm start` in the project folder, and open http://localhost:5000/admin/.");
        }
        throw new Error(payload?.error ||
            `The CMS server returned an unexpected response (HTTP ${response.status}). Verify that this page is served by the CMS application.`);
    }
    if (response.status !== 204 && payload === null) {
        throw new Error("The CMS server returned an invalid response. Verify that the CMS application is running.");
    }
    return payload;
}

function statusPill(status) {
    const pill = document.createElement("span");
    pill.className = `status-pill status-${status}`;
    pill.textContent = status;
    return pill;
}

function tableMessage(tbody, columns, message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columns;
    cell.className = "empty-state";
    cell.textContent = message;
    row.append(cell);
    tbody.replaceChildren(row);
}

function setView(name) {
    document.querySelectorAll(".view-section").forEach(section => {
        section.classList.toggle("d-none", section.id !== `view-${name}`);
    });
    document.querySelectorAll("[data-view]").forEach(button => {
        button.classList.toggle("active", button.dataset.view === name && button.classList.contains("nav-link"));
    });
    const heading = {
        dashboard: "Dashboard",
        inquiries: "Enquiries",
        projects: "Projects",
        blog: "Blog posts",
        pages: "Page SEO",
        settings: "Contact settings"
    }[name];
    const pageHeading = document.getElementById("pageHeading");
    pageHeading.textContent = heading;
    pageHeading.hidden = ["inquiries", "projects", "blog", "pages", "settings"].includes(name);
    document.getElementById("sidebar").classList.remove("open");

    if (name === "dashboard") loadDashboard();
    if (name === "inquiries") loadInquiries();
    if (name === "projects") loadProjects();
    if (name === "blog") loadBlogPosts();
    if (name === "pages") loadPages();
    if (name === "settings") loadSettings();
}

async function loadDashboard() {
    const cards = document.getElementById("dashboardCards");
    cards.replaceChildren(Object.assign(document.createElement("div"), {
        className: "col-12 stat-card loading-placeholder",
        textContent: "Loading content summary..."
    }));
    try {
        const { projects, pages, blog, inquiries } = await request("/admin/summary");
        const values = [
            ["Published projects", projects.published || 0, "Visible on the public portfolio"],
            ["Draft projects", projects.draft || 0, "Not shown to public visitors"],
            ["Managed pages", pages.published || 0, "Page metadata and publication controls"],
            ["Published articles", blog.published || 0, `${blog.draft || 0} unpublished drafts`],
            ["Enquiries", Object.values(inquiries || {}).reduce((total, count) => total + count, 0), `${inquiries?.new || 0} new`]
        ];
        cards.replaceChildren(...values.map(([label, count, note]) => {
            const column = document.createElement("div");
            column.className = "col-md-3";
            const card = document.createElement("div");
            card.className = "stat-card";
            const title = document.createElement("span");
            title.className = "stat-label";
            title.textContent = label;
            const value = document.createElement("strong");
            value.className = "stat-value";
            value.textContent = count;
            const detail = document.createElement("span");
            detail.className = "stat-note";
            detail.textContent = note;
            card.append(title, value, detail);
            column.append(card);
            return column;
        }));
    } catch (error) {
        cards.replaceChildren(Object.assign(document.createElement("div"), {
            className: "col-12 empty-state",
            textContent: error.message
        }));
    }
}

async function loadInquiries() {
    const rows = document.getElementById("inquiryRows");
    tableMessage(rows, 4, "Loading enquiries...");
    const query = new URLSearchParams({
        page: String(state.inquiryPage),
        status: document.getElementById("inquiryStatusFilter").value,
        search: document.getElementById("inquirySearch").value.trim()
    });
    try {
        const result = await request(`/admin/inquiries?${query}`);
        state.inquiryPage = result.page;
        state.inquiryPages = Math.max(1, result.pages);
        document.getElementById("inquiryPaginationLabel").textContent =
            `${result.total} enquiries · Page ${result.page} of ${result.pages}`;
        document.getElementById("inquiriesPrevious").disabled = result.page <= 1;
        document.getElementById("inquiriesNext").disabled = result.page >= result.pages;

        if (!result.inquiries.length) {
            tableMessage(rows, 4, "No enquiries match this filter.");
            return;
        }

        rows.replaceChildren(...result.inquiries.map(inquiry => {
            const row = document.createElement("tr");
            const contact = document.createElement("td");
            const identity = document.createElement("div");
            const name = document.createElement("strong");
            name.textContent = inquiry.name;
            const phone = document.createElement("div");
            phone.textContent = inquiry.phone;
            identity.append(name, phone);
            const budget = document.createElement("small");
            budget.className = "d-block text-secondary";
            budget.textContent = `Budget: ${inquiry.budget || "Not provided"}`;
            identity.append(budget);
            if (inquiry.email) {
                const email = document.createElement("div");
                email.textContent = inquiry.email;
                identity.append(email);
            }
            if (inquiry.message && inquiry.message !== `Budget: ${inquiry.budget}`) {
                const message = document.createElement("small");
                message.className = "d-block text-secondary mt-1";
                message.textContent = inquiry.message;
                identity.append(message);
            }
            contact.append(identity);

            const source = document.createElement("td");
            const project = document.createElement("strong");
            project.textContent = inquiry.project_name || "General enquiry";
            const sourceLabel = document.createElement("small");
            sourceLabel.className = "d-block text-secondary";
            sourceLabel.textContent = `${inquiry.source_form} · ${inquiry.source_page}`;
            source.append(project, sourceLabel);

            const received = document.createElement("td");
            received.textContent = new Date(inquiry.submitted_at).toLocaleString();

            const statusCell = document.createElement("td");
            const status = document.createElement("select");
            status.className = "form-select form-select-sm";
            status.setAttribute("aria-label", `Status for enquiry from ${inquiry.name}`);
            for (const [value, label] of [["new", "New"], ["contacted", "Contacted"], ["closed", "Closed"]]) {
                const option = document.createElement("option");
                option.value = value;
                option.textContent = label;
                status.append(option);
            }
            status.value = inquiry.status;
            status.addEventListener("change", async () => {
                status.disabled = true;
                try {
                    await request(`/admin/inquiries/${inquiry.id}/status`, {
                        method: "PATCH",
                        body: JSON.stringify({ status: status.value })
                    });
                    notify("Enquiry status updated.");
                    await Promise.all([loadInquiries(), loadDashboard()]);
                } catch (error) {
                    notify(error.message, true);
                    await loadInquiries();
                }
            });
            statusCell.append(status);
            row.append(contact, source, received, statusCell);
            return row;
        }));
    } catch (error) {
        tableMessage(rows, 4, error.message);
        document.getElementById("inquiryPaginationLabel").textContent = "Could not load enquiries.";
    }
}

async function loadProjects() {
    const rows = document.getElementById("projectRows");
    tableMessage(rows, 5, "Loading projects...");
    const query = new URLSearchParams({
        page: String(state.projectPage),
        status: document.getElementById("projectStatus").value,
        search: document.getElementById("projectSearch").value.trim()
    });
    try {
        const result = await request(`/admin/projects?${query}`);
        state.projectPages = Math.max(1, result.pages);
        document.getElementById("projectPaginationLabel").textContent =
            result.total ? `Page ${result.page} of ${result.pages} · ${result.total} projects` : "No projects";
        document.getElementById("projectsPrevious").disabled = result.page <= 1;
        document.getElementById("projectsNext").disabled = result.page >= result.pages;

        if (!result.projects.length) {
            tableMessage(rows, 5, "No projects match this filter.");
            return;
        }

        rows.replaceChildren(...result.projects.map(project => {
            const row = document.createElement("tr");
            const projectCell = document.createElement("td");
            const identity = document.createElement("div");
            identity.className = "project-cell";
            if (project.card_image) {
                const image = document.createElement("img");
                image.className = "project-thumb";
                image.src = project.card_image;
                image.alt = "";
                identity.append(image);
            }
            const name = document.createElement("div");
            const strong = document.createElement("strong");
            strong.textContent = project.name;
            const slug = document.createElement("small");
            slug.textContent = project.page_path;
            name.append(strong, slug);
            identity.append(name);
            projectCell.append(identity);

            const location = document.createElement("td");
            location.textContent = [project.location_label, project.location].filter(Boolean).join(" · ") || "Not set";
            const status = document.createElement("td");
            status.append(statusPill(project.status));
            const updated = document.createElement("td");
            updated.textContent = new Date(project.updated_at).toLocaleDateString();
            const actions = document.createElement("td");
            actions.className = "text-end";
            const edit = document.createElement("button");
            edit.className = "btn btn-sm btn-outline-secondary";
            edit.type = "button";
            edit.textContent = "Edit";
            edit.addEventListener("click", () => openProject(project.slug));
            actions.append(edit);
            row.append(projectCell, location, status, updated, actions);
            return row;
        }));
    } catch (error) {
        tableMessage(rows, 5, error.message);
    }
}

async function loadBlogPosts() {
    const rows = document.getElementById("blogRows");
    tableMessage(rows, 5, "Loading posts...");
    try {
        const { posts } = await request("/admin/blog");
        if (!posts.length) {
            tableMessage(rows, 5, "No blog posts yet. Create the first post to get started.");
            return;
        }
        rows.replaceChildren(...posts.map(post => {
            const row = document.createElement("tr");
            const articleCell = document.createElement("td");
            const identity = document.createElement("div");
            identity.className = "project-cell";
            const image = document.createElement("img");
            image.className = "project-thumb";
            image.src = post.featured_image;
            image.alt = "";
            const name = document.createElement("div");
            const title = document.createElement("strong");
            title.textContent = post.title;
            const slug = document.createElement("small");
            slug.textContent = post.slug;
            name.append(title, slug);
            identity.append(image, name);
            articleCell.append(identity);

            const category = document.createElement("td");
            category.textContent = post.category;
            const date = document.createElement("td");
            date.textContent = post.published_at;
            const status = document.createElement("td");
            status.append(statusPill(post.status));
            const actions = document.createElement("td");
            actions.className = "blog-actions-cell";
            const edit = document.createElement("button");
            edit.className = "btn btn-sm blog-action blog-action-edit";
            edit.type = "button";
            edit.textContent = "Edit";
            edit.setAttribute("aria-label", `Edit ${post.title}`);
            edit.addEventListener("click", () => fillBlogForm(post));
            const toggle = document.createElement("button");
            toggle.className = `btn btn-sm blog-action ${post.status === "published" ? "blog-action-unpublish" : "blog-action-publish"}`;
            toggle.type = "button";
            toggle.textContent = post.status === "published" ? "Unpublish" : "Publish";
            toggle.setAttribute("aria-label", `${toggle.textContent} ${post.title}`);
            toggle.addEventListener("click", () => updateBlogStatus(post, toggle));
            const remove = document.createElement("button");
            remove.className = "btn btn-sm blog-action blog-action-delete";
            remove.type = "button";
            remove.textContent = "Delete";
            remove.setAttribute("aria-label", `Delete ${post.title}`);
            remove.addEventListener("click", () => deleteBlogPost(post, remove));
            actions.append(edit, toggle, remove);
            row.append(articleCell, category, date, status, actions);
            return row;
        }));
    } catch (error) {
        tableMessage(rows, 5, error.message);
    }
}

function fillBlogForm(post = null) {
    const form = document.getElementById("blogForm");
    form.reset();
    document.getElementById("blogOriginalSlug").value = post?.slug || "";
    document.getElementById("blogTitle").value = post?.title || "";
    document.getElementById("blogSlug").value = post?.slug || "";
    document.getElementById("blogCategory").value = post?.category || "";
    document.getElementById("blogPublishedAt").value = post?.published_at || new Date().toISOString().slice(0, 10);
    document.getElementById("blogExcerpt").value = post?.excerpt || "";
    document.getElementById("blogContent").value = post?.content || "";
    document.getElementById("blogFeaturedImage").value = post?.featured_image || "";
    document.getElementById("blogStatus").value = post?.status || "draft";
    document.getElementById("blogFormHeading").textContent = post ? "Edit post" : "New post";
    form.classList.remove("d-none");
    form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function blogFormPayload(status = document.getElementById("blogStatus").value) {
    return {
        slug: document.getElementById("blogSlug").value,
        title: document.getElementById("blogTitle").value,
        category: document.getElementById("blogCategory").value,
        publishedAt: document.getElementById("blogPublishedAt").value,
        excerpt: document.getElementById("blogExcerpt").value,
        content: document.getElementById("blogContent").value,
        featuredImage: document.getElementById("blogFeaturedImage").value,
        status
    };
}

async function updateBlogStatus(post, button) {
    const status = post.status === "published" ? "draft" : "published";
    button.disabled = true;
    button.textContent = status === "published" ? "Publishing..." : "Unpublishing...";
    try {
        await request(`/admin/blog/${encodeURIComponent(post.slug)}`, {
            method: "PUT",
            body: JSON.stringify({
                slug: post.slug,
                title: post.title,
                excerpt: post.excerpt,
                content: post.content,
                category: post.category,
                featuredImage: post.featured_image,
                publishedAt: post.published_at,
                status
            })
        });
        notify(status === "published" ? "Post published." : "Post unpublished.");
        await Promise.all([loadBlogPosts(), loadDashboard()]);
    } catch (error) {
        notify(error.message, true);
    } finally {
        button.disabled = false;
    }
}

async function deleteBlogPost(post, button) {
    if (!window.confirm(`Permanently delete "${post.title}"? This cannot be undone.`)) return;
    button.disabled = true;
    button.textContent = "Deleting...";
    try {
        await request(`/admin/blog/${encodeURIComponent(post.slug)}`, { method: "DELETE" });
        notify("Post deleted.");
        if (document.getElementById("blogOriginalSlug").value === post.slug) {
            document.getElementById("blogForm").classList.add("d-none");
        }
        await Promise.all([loadBlogPosts(), loadDashboard()]);
    } catch (error) {
        notify(error.message, true);
    } finally {
        button.disabled = false;
    }
}

function slugFromName(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function fillProjectForm(project = {}) {
    const form = document.getElementById("projectForm");
    form.reset();
    document.getElementById("projectSlug").value = project.slug || "";
    document.getElementById("projectUrl").value = project.slug || "";
    document.getElementById("projectUrl").readOnly = Boolean(project.slug);
    document.getElementById("projectName").value = project.name || "";
    document.getElementById("projectCategory").value = project.category || "jaipur";
    document.getElementById("projectLocationLabel").value = project.location_label || "";
    document.getElementById("projectBannerLabel").value = project.banner_label || "";
    document.getElementById("projectLocation").value = project.location || "";
    document.getElementById("projectSummary").value = project.summary || "";
    document.getElementById("projectDescription").value = project.description || "";
    document.getElementById("projectPageTitle").value = project.page_title || "";
    document.getElementById("projectSeoDescription").value = project.seo_description || "";
    document.getElementById("projectCardImage").value = project.card_image || "";
    document.getElementById("projectGallery").value = (project.gallery || []).join("\n");
    document.getElementById("projectLayout").value = project.layout_image || "";
    document.getElementById("projectMap").value = project.map_image || "";
    document.getElementById("projectAmenities").value = (project.amenities || [])
        .map(amenity => `${amenity.label} | ${amenity.icon}`)
        .join("\n");
    document.getElementById("projectVideo").value = project.video_url || "";
    document.getElementById("projectOrder").value = project.sort_order || 0;
    document.getElementById("projectFeatured").checked = Boolean(project.featured);
    document.getElementById("projectPublishStatus").value = project.status || "draft";
    document.getElementById("projectModalTitle").textContent = project.slug ? "Edit project" : "New project";
    document.getElementById("deleteProjectButton").classList.toggle("d-none", !project.slug || project.status === "deleted");

    const preview = document.getElementById("previewProjectButton");
    preview.classList.toggle("d-none", project.status !== "published");
    preview.href = project.page_path || "#";
}

async function openProject(slug) {
    try {
        const { project } = await request(`/admin/projects/${encodeURIComponent(slug)}`);
        fillProjectForm(project);
        modal.show();
    } catch (error) {
        notify(error.message, true);
    }
}

function projectPayload() {
    const amenities = document.getElementById("projectAmenities").value
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const [label, icon = "bi-check-circle"] = line.split("|").map(part => part.trim());
            return { label, icon };
        });
    return {
        slug: document.getElementById("projectUrl").value.trim(),
        name: document.getElementById("projectName").value.trim(),
        category: document.getElementById("projectCategory").value,
        locationLabel: document.getElementById("projectLocationLabel").value.trim(),
        bannerLabel: document.getElementById("projectBannerLabel").value.trim(),
        location: document.getElementById("projectLocation").value.trim(),
        summary: document.getElementById("projectSummary").value.trim(),
        description: document.getElementById("projectDescription").value.trim(),
        pageTitle: document.getElementById("projectPageTitle").value.trim(),
        seoDescription: document.getElementById("projectSeoDescription").value.trim(),
        cardImage: document.getElementById("projectCardImage").value.trim(),
        gallery: document.getElementById("projectGallery").value.split(/\r?\n/).map(line => line.trim()).filter(Boolean),
        layoutImage: document.getElementById("projectLayout").value.trim(),
        mapImage: document.getElementById("projectMap").value.trim(),
        amenities,
        videoUrl: document.getElementById("projectVideo").value.trim(),
        featured: document.getElementById("projectFeatured").checked,
        sortOrder: Number(document.getElementById("projectOrder").value),
        status: document.getElementById("projectPublishStatus").value
    };
}

async function loadPages() {
    const rows = document.getElementById("pageRows");
    tableMessage(rows, 4, "Loading pages...");
    try {
        const { pages } = await request("/admin/pages");
        rows.replaceChildren(...pages.map(page => {
            const row = document.createElement("tr");
            const label = document.createElement("td");
            label.textContent = page.label;
            const path = document.createElement("td");
            path.textContent = page.path;
            const status = document.createElement("td");
            status.append(statusPill(page.status));
            const action = document.createElement("td");
            action.className = "text-end";
            const edit = document.createElement("button");
            edit.className = "btn btn-sm btn-outline-secondary";
            edit.type = "button";
            edit.textContent = "Edit SEO";
            edit.addEventListener("click", () => {
                document.getElementById("pageSlug").value = page.slug;
                document.getElementById("pageFormHeading").textContent = page.label;
                document.getElementById("pageSeoTitle").value = page.seo_title || "";
                document.getElementById("pageSeoDescription").value = page.seo_description || "";
                document.getElementById("pageStatus").value = page.status;
                const contentFields = document.getElementById("pageContentFields");
                contentFields.replaceChildren(...Object.entries(page.content || {}).map(([key, value]) => {
                    const wrapper = document.createElement("div");
                    wrapper.className = "col-12";
                    const label = document.createElement("label");
                    label.className = "form-label";
                    const input = document.createElement("textarea");
                    input.className = "form-control";
                    input.rows = String((value || "").length > 180 ? 4 : 2);
                    input.maxLength = key.toLowerCase().includes("image") ? 500 : 10000;
                    input.value = value;
                    input.dataset.pageContentKey = key;
                    label.textContent = key.replace(/([A-Z])/g, " $1").replace(/^./, letter => letter.toUpperCase());
                    label.htmlFor = `page-content-${key}`;
                    input.id = label.htmlFor;
                    wrapper.append(label, input);
                    return wrapper;
                }));
                document.getElementById("pageForm").classList.remove("d-none");
                document.getElementById("pageForm").scrollIntoView({ behavior: "smooth", block: "start" });
            });
            action.append(edit);
            row.append(label, path, status, action);
            return row;
        }));
        if (!pages.length) tableMessage(rows, 4, "No pages are available.");
    } catch (error) {
        tableMessage(rows, 4, error.message);
    }
}

async function loadSettings() {
    try {
        const { settings } = await request("/admin/settings");
        document.getElementById("officeAddress").value = settings.officeAddress || "";
        document.getElementById("contactPhone").value = settings.phone || "";
        document.getElementById("contactWhatsapp").value = settings.whatsapp || "";
        document.getElementById("contactEmail").value = settings.email || "";
        document.getElementById("businessHours").value = settings.businessHours || "";
    } catch (error) {
        notify(error.message, true);
    }
}

document.querySelectorAll("[data-view]").forEach(button => {
    button.addEventListener("click", () => setView(button.dataset.view));
});

document.getElementById("inquiryStatusFilter").addEventListener("change", () => {
    state.inquiryPage = 1;
    loadInquiries();
});
document.getElementById("inquirySearch").addEventListener("input", () => {
    window.clearTimeout(state.inquirySearchTimer);
    state.inquirySearchTimer = window.setTimeout(() => {
        state.inquiryPage = 1;
        loadInquiries();
    }, 250);
});
document.getElementById("inquiriesPrevious").addEventListener("click", () => {
    state.inquiryPage = Math.max(1, state.inquiryPage - 1);
    loadInquiries();
});
document.getElementById("inquiriesNext").addEventListener("click", () => {
    state.inquiryPage = Math.min(state.inquiryPages, state.inquiryPage + 1);
    loadInquiries();
});

document.getElementById("loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    const errorElement = document.getElementById("loginError");
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    errorElement.textContent = "";
    try {
        const { admin } = await request("/auth/login", {
            method: "POST",
            body: JSON.stringify({
                email: document.getElementById("loginEmail").value,
                password: document.getElementById("loginPassword").value
            })
        });
        document.getElementById("loginPassword").value = "";
        showAdmin(admin);
        setView("dashboard");
    } catch (error) {
        errorElement.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

document.getElementById("logoutButton").addEventListener("click", async () => {
    try {
        await request("/auth/logout", { method: "POST" });
    } catch (error) {
        notify(error.message, true);
    } finally {
        showLogin();
    }
});

document.getElementById("newProjectButton").addEventListener("click", () => {
    fillProjectForm();
    modal.show();
});

document.getElementById("newBlogPostButton").addEventListener("click", () => fillBlogForm());
document.getElementById("cancelBlogEditButton").addEventListener("click", () => {
    document.getElementById("blogForm").classList.add("d-none");
});
document.getElementById("blogForm").addEventListener("submit", async event => {
    event.preventDefault();
    const originalSlug = document.getElementById("blogOriginalSlug").value;
    const button = document.getElementById("saveBlogPostButton");
    button.disabled = true;
    button.textContent = "Saving...";
    try {
        await request(originalSlug
            ? `/admin/blog/${encodeURIComponent(originalSlug)}`
            : "/admin/blog", {
            method: originalSlug ? "PUT" : "POST",
            body: JSON.stringify(blogFormPayload())
        });
        document.getElementById("blogForm").classList.add("d-none");
        notify("Post saved.");
        await Promise.all([loadBlogPosts(), loadDashboard()]);
    } catch (error) {
        notify(error.message, true);
    } finally {
        button.disabled = false;
        button.textContent = "Save post";
    }
});

document.getElementById("uploadBlogImageButton").addEventListener("click", async event => {
    const file = document.getElementById("blogUpload").files[0];
    if (!file) {
        notify("Choose an image before uploading.", true);
        return;
    }

    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Uploading...";
    try {
        const formData = new FormData();
        formData.append("image", file);
        const { image } = await request("/admin/uploads", { method: "POST", body: formData });
        document.getElementById("blogFeaturedImage").value = image.url;
        document.getElementById("blogUpload").value = "";
        notify("Featured image uploaded to persistent CMS storage.");
    } catch (error) {
        notify(error.message, true);
    } finally {
        button.disabled = false;
        button.textContent = "Upload";
    }
});

document.getElementById("projectName").addEventListener("input", event => {
    if (!document.getElementById("projectSlug").value) {
        document.getElementById("projectUrl").value = slugFromName(event.target.value);
    }
});

document.getElementById("projectForm").addEventListener("submit", async event => {
    event.preventDefault();
    const button = document.getElementById("saveProjectButton");
    button.disabled = true;
    button.textContent = "Saving...";
    try {
        const slug = document.getElementById("projectSlug").value;
        const endpoint = slug
            ? `/admin/projects/${encodeURIComponent(slug)}`
            : "/admin/projects";
        const { project } = await request(endpoint, {
            method: slug ? "PUT" : "POST",
            body: JSON.stringify(projectPayload())
        });
        modal.hide();
        notify("Project saved.");
        state.projectPage = 1;
        await Promise.all([loadProjects(), loadDashboard()]);
        if (project.status === "published") {
            document.getElementById("previewProjectButton").href = project.page_path;
        }
    } catch (error) {
        notify(error.message, true);
    } finally {
        button.disabled = false;
        button.textContent = "Save project";
    }
});

document.getElementById("deleteProjectButton").addEventListener("click", async () => {
    const slug = document.getElementById("projectSlug").value;
    if (!slug || !window.confirm("Delete this project from the public portfolio? It can be restored by editing it later.")) return;
    try {
        await request(`/admin/projects/${encodeURIComponent(slug)}`, { method: "DELETE" });
        modal.hide();
        notify("Project deleted from the public portfolio.");
        await Promise.all([loadProjects(), loadDashboard()]);
    } catch (error) {
        notify(error.message, true);
    }
});

document.getElementById("uploadImageButton").addEventListener("click", async event => {
    const file = document.getElementById("projectUpload").files[0];
    if (!file) {
        notify("Choose an image before uploading.", true);
        return;
    }

    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Uploading...";
    try {
        const formData = new FormData();
        formData.append("image", file);
        const { image } = await request("/admin/uploads", { method: "POST", body: formData });
        const cardImage = document.getElementById("projectCardImage");
        const gallery = document.getElementById("projectGallery");
        if (!document.getElementById("addUploadToGallery").checked || !cardImage.value) {
            cardImage.value = image.url;
        }
        if (document.getElementById("addUploadToGallery").checked) {
            const paths = gallery.value.split(/\r?\n/).map(path => path.trim()).filter(Boolean);
            paths.push(image.url);
            gallery.value = paths.join("\n");
        }
        document.getElementById("projectUpload").value = "";
        notify("Image uploaded to persistent CMS storage.");
    } catch (error) {
        notify(error.message, true);
    } finally {
        button.disabled = false;
        button.textContent = "Upload image";
    }
});

document.getElementById("projectSearch").addEventListener("input", () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
        state.projectPage = 1;
        loadProjects();
    }, 250);
});
document.getElementById("projectStatus").addEventListener("change", () => {
    state.projectPage = 1;
    loadProjects();
});
document.getElementById("projectsPrevious").addEventListener("click", () => {
    if (state.projectPage > 1) {
        state.projectPage -= 1;
        loadProjects();
    }
});
document.getElementById("projectsNext").addEventListener("click", () => {
    if (state.projectPage < state.projectPages) {
        state.projectPage += 1;
        loadProjects();
    }
});

document.getElementById("pageForm").addEventListener("submit", async event => {
    event.preventDefault();
    try {
        const slug = document.getElementById("pageSlug").value;
        await request(`/admin/pages/${encodeURIComponent(slug)}`, {
            method: "PUT",
            body: JSON.stringify({
                seoTitle: document.getElementById("pageSeoTitle").value,
                seoDescription: document.getElementById("pageSeoDescription").value,
                status: document.getElementById("pageStatus").value,
                content: Object.fromEntries([...document.querySelectorAll("[data-page-content-key]")]
                    .map(input => [input.dataset.pageContentKey, input.value]))
            })
        });
        notify("Page settings saved.");
        document.getElementById("pageForm").classList.add("d-none");
        await Promise.all([loadPages(), loadDashboard()]);
    } catch (error) {
        notify(error.message, true);
    }
});

document.getElementById("settingsForm").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
        await request("/admin/settings", {
            method: "PUT",
            body: JSON.stringify({
                officeAddress: document.getElementById("officeAddress").value,
                phone: document.getElementById("contactPhone").value,
                whatsapp: document.getElementById("contactWhatsapp").value,
                email: document.getElementById("contactEmail").value,
                businessHours: document.getElementById("businessHours").value
            })
        });
        notify("Contact details saved.");
    } catch (error) {
        notify(error.message, true);
    } finally {
        button.disabled = false;
    }
});

document.getElementById("sidebarToggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
});

request("/auth/session")
    .then(({ admin }) => {
        showAdmin(admin);
        setView("dashboard");
    })
    .catch(() => showLogin());
